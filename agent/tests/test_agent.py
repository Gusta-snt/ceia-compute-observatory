import json
import threading
import httpx
import pytest

from ceia_agent.buffer import Buffer
from ceia_agent.config import Config
from ceia_agent.metrics import GpuCollector, Sample, SystemCollector, parse_meminfo, parse_psi, parse_smi_value
from ceia_agent.sender import Sender, backoff_delay
from ceia_agent.main import Agent


@pytest.mark.parametrize("raw,val,st", [
    ("[N/A]", None, "unsupported"), ("N/A", None, "unsupported"), ("[Not Supported]", None, "unsupported"),
    ("0", 0.0, "ok"), ("37", 37.0, "ok"), ("12.50", 12.5, "ok"), ("", None, "unsupported"), ("garbage", None, "unavailable"),
])
def test_parse_smi(raw, val, st):
    assert parse_smi_value(raw) == (val, st)


def test_gpu_na_never_zero():
    smi = lambda: "[N/A], 41, [N/A], 2411, [N/A], [N/A], [N/A], NVIDIA GB10, 580.95"  # noqa: E731
    s = Sample()
    s.put("mem_total_bytes", 128 * 1024**3, "proc_meminfo")
    s.put("mem_used_bytes", 40 * 1024**3, "proc_meminfo")
    s.put("mem_available_bytes", 88 * 1024**3, "proc_meminfo")
    s.put("mem_percent", 31.25, "proc_meminfo")
    GpuCollector(smi=smi, use_nvml=False).collect(s)
    assert s.values["gpu_util_percent"] is None and s.quality["gpu_util_percent"] == "unsupported"
    assert s.values["gpu_temp_c"] == 41 and s.quality["gpu_temp_c"] == "ok"
    assert s.values["gpu_mem_total_bytes"] is None  # não é VRAM dedicada
    assert s.values["unified_total_bytes"] == 128 * 1024**3
    assert s.extra["driver_version"] == "580.95"


def test_gpu_real_zero_is_ok():
    s = Sample()
    GpuCollector(smi=lambda: "0, 30, 5.2, 300, 0, 0, 0, X, 1", use_nvml=False).collect(s)
    assert s.values["gpu_util_percent"] == 0.0 and s.quality["gpu_util_percent"] == "ok"


def test_gpu_no_smi():
    s = Sample()
    GpuCollector(smi=lambda: None, use_nvml=False).collect(s)
    assert s.values["gpu_util_percent"] is None and s.quality["gpu_util_percent"] == "unavailable"


def test_parse_meminfo_psi():
    mi = parse_meminfo("MemTotal:  1000 kB\nMemAvailable: 400 kB\nHugePages_Total: 0\n")
    assert mi["MemTotal"] == 1000 * 1024 and mi["HugePages_Total"] == 0
    psi = parse_psi("some avg10=1.50 avg60=0.20 avg300=0.00 total=5\nfull avg10=0.10 avg60=0.00 avg300=0.00 total=1\n")
    assert psi["some_avg10"] == 1.5 and psi["full_avg10"] == 0.1
    assert parse_psi(None) is None


def test_system_collector_rates():
    t = [0.0]
    c = SystemCollector(clock=lambda: t[0])
    s1 = Sample(); c.collect(s1)
    assert s1.values["disk_read_bps"] is None  # sem taxa na 1ª amostra, não zero
    t[0] = 15.0
    s2 = Sample(); c.collect(s2)
    assert s2.values["cpu_percent"] is not None
    assert 0 <= s2.values["cpu_percent"] <= 100


def test_buffer_policies():
    b = Buffer(":memory:", max_samples=3, drop_policy="oldest")
    for i in range(5):
        b.add({"ts": f"2026-01-01T00:00:0{i}Z"})
    assert [s["ts"][-3:-1] for s in b.peek(10)] == ["02", "03", "04"] and b.dropped == 2
    b2 = Buffer(":memory:", max_samples=2, drop_policy="newest")
    assert b2.add({"ts": "a"}) and b2.add({"ts": "b"}) and not b2.add({"ts": "c"})
    assert b.add({"ts": "2026-01-01T00:00:04Z"}) and b.count() == 3  # duplicata não infla


def test_buffer_persists(tmp_path):
    p = str(tmp_path / "b.db")
    b = Buffer(p); b.add({"ts": "x"}); b.close()
    assert Buffer(p).count() == 1


def test_backoff_bounds():
    assert all(1 <= backoff_delay(1) <= 2 for _ in range(50))
    assert all(backoff_delay(20) <= 300 for _ in range(50))


def _sender(handler, buf):
    return Sender("http://central", "tok", "uid-1", buf, transport=httpx.MockTransport(handler))


def test_outage_then_recovery():
    buf = Buffer(":memory:")
    for i in range(5):
        buf.add({"ts": f"2026-01-01T00:00:0{i}.000Z"})
    state = {"up": False, "bodies": []}

    def handler(req):
        if not state["up"]:
            raise httpx.ConnectError("down")
        state["bodies"].append(json.loads(req.content))
        assert req.headers["authorization"] == "Bearer tok"
        return httpx.Response(202, json={"accepted": 5})

    s = _sender(handler, buf)
    assert s.flush_once() == 0 and s.failures == 1 and buf.count() == 5  # nada descartado
    state["up"] = True
    assert s.flush_once() == 5 and buf.count() == 0 and s.failures == 0
    assert state["bodies"][0]["machine_uid"] == "uid-1" and state["bodies"][0]["schema_version"] == 1


def test_server_5xx_keeps_data_4xx_drops():
    buf = Buffer(":memory:"); buf.add({"ts": "a"})
    assert _sender(lambda r: httpx.Response(503), buf).flush_once() == 0 and buf.count() == 1
    assert _sender(lambda r: httpx.Response(401), buf).flush_once() == 0 and buf.count() == 1  # 401 mantém dados
    assert _sender(lambda r: httpx.Response(422, text="bad"), buf).flush_once() == 0 and buf.count() == 0


def test_agent_timestamps_monotonic(tmp_path):
    cfg = Config(central_api_url="http://x", agent_token="t", buffer_path=":memory:", state_dir=str(tmp_path))
    a = Agent(cfg)
    ts = [a._next_ts() for _ in range(50)]
    assert ts == sorted(ts) and len(set(ts)) == 50 and all(t.endswith("Z") for t in ts)


def test_config_validate(tmp_path):
    f = tmp_path / "a.env"
    f.write_text("CENTRAL_API_URL=https://c.example/\nAGENT_TOKEN=abc\nCOLLECTION_INTERVAL_SECONDS=30\n")
    c = Config.load(str(f))
    assert c.central_api_url == "https://c.example" and c.interval == 30 and c.validate() == []
    assert Config().validate()


def test_config_accepts_plain_http():
    assert Config(central_api_url="http://203.0.113.10", agent_token="t", buffer_path=":memory:").validate() == []


def test_env_file_tolerates_inline_comments(tmp_path):
    f = tmp_path / "a.env"
    f.write_text('CENTRAL_API_URL=http://c.example   # central\nAGENT_TOKEN="tok#1"\nBUFFER_MAX_SAMPLES=200000  # ~34 dias\n')
    c = Config.load(str(f))
    assert c.central_api_url == "http://c.example" and c.agent_token == "tok#1" and c.buffer_max_samples == 200000


def test_parse_smi_procs_na_is_none():
    from ceia_agent.metrics import parse_smi_procs
    apps = "1234, 2048\n5678, [N/A]\n"
    pmon = "# gpu pid type sm mem enc dec command\n# Idx # C/G % % % % name\n    0 1234 C 87 10 - - python\n    0 999 C - - - - x\n"
    r = parse_smi_procs(apps, pmon)
    assert r[1234] == {"gpu_util_percent": 87.0, "gpu_mem_bytes": 2048 * 1024 * 1024}
    assert r[5678]["gpu_mem_bytes"] is None and r[999]["gpu_util_percent"] is None


def test_process_collector_ranks_and_includes_gpu(tmp_path):
    import os
    from ceia_agent.metrics import ProcessCollector, Sample
    me = os.getpid()
    pc = ProcessCollector(top_n=3, smi=lambda: (f"{me}, 512\n", f"    0 {me} C 55 1 - - py\n"))
    pc.collect(Sample())  # prime
    s = Sample()
    pc.collect(s)
    procs = s.extra["processes"]
    assert len(procs) <= 4
    mine = next(p for p in procs if p["pid"] == me)
    assert mine["gpu_util_percent"] == 55.0 and mine["gpu_mem_bytes"] == 512 * 1024 * 1024 and mine["user"]
