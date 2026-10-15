from datetime import datetime, timedelta, timezone

from app import db as dbm
from app.models import Machine, Sample
from app.services.alerts import evaluate_machine
from app.services.retention import run_retention


def mk_sample(ts, **vals):
    base = {"cpu_percent": 10.0, "mem_percent": 30.0, "mem_total_bytes": 128e9, "mem_available_bytes": 90e9,
            "unified_percent": 30.0, "unified_total_bytes": 128e9, "unified_available_bytes": 90e9,
            "gpu_util_percent": 3.0, "disk_percent": 40.0, "disk_free_bytes": 2e12, "psi_memory_some_avg10": 0.0}
    base.update(vals)
    quality = {k: "unsupported" for k, v in base.items() if v is None}
    return {"ts": ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "interval_s": 15, "values": base, "quality": quality}


def batch(uid, samples):
    return {"schema_version": 1, "agent_version": "1.0.0", "machine_uid": uid,
            "system": {"hostname": "spark-01", "driver_version": "580.1"}, "samples": samples}


def make_machine(admin, name="spark-01"):
    r = admin.post("/api/v1/machines", json={"name": name, "hostname": name})
    assert r.status_code == 201
    return r.json()


def feed(client, token, uid, start, n, step=15, **vals):
    out = None
    for i in range(0, n, 400):
        samples = [mk_sample(start + timedelta(seconds=step * j), **vals) for j in range(i, min(n, i + 400))]
        out = client.post("/api/v1/ingest", json=batch(uid, samples), headers={"Authorization": f"Bearer {token}"})
        assert out.status_code == 202, out.text
    return out


def test_auth_boundaries(client, admin):
    m = make_machine(admin)
    tok = m["token"]
    anon = client.__class__(client.app)
    # token de agente não acessa dados administrativos
    assert anon.get("/api/v1/machines", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    assert anon.get("/api/v1/overview").status_code == 401
    # token inválido não envia dados
    r = anon.post("/api/v1/ingest", json=batch("u", []), headers={"Authorization": "Bearer ceia_agt_nope"})
    assert r.status_code == 401
    assert anon.post("/api/v1/ingest", json=batch("u", [])).status_code == 401
    # login errado
    assert anon.post("/api/v1/auth/login", json={"username": "admin", "password": "x"}).status_code == 401


def test_ingest_idempotent_and_persisted(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=10)
    s = [mk_sample(now + timedelta(seconds=15 * i)) for i in range(10)]
    h = {"Authorization": f"Bearer {m['token']}"}
    r1 = client.post("/api/v1/ingest", json=batch("uid-A", s), headers=h)
    assert r1.json()["accepted"] == 10
    r2 = client.post("/api/v1/ingest", json=batch("uid-A", s), headers=h)  # reenvio
    assert r2.json() == {"accepted": 0, "duplicates": 10, "rejected": 0, "errors": []}
    with dbm.SessionLocal() as db:
        assert db.query(Sample).count() == 10
    # uid diferente com o mesmo token é rejeitado
    assert client.post("/api/v1/ingest", json=batch("uid-B", s), headers=h).status_code == 409


def test_validation_rejects_bad_samples(client, admin):
    m = make_machine(admin)
    h = {"Authorization": f"Bearer {m['token']}"}
    old = datetime.now(timezone.utc) - timedelta(days=400)
    r = client.post("/api/v1/ingest", json=batch("u", [mk_sample(old)]), headers=h)
    assert r.json()["rejected"] == 1
    bad = batch("u", [{"ts": "2026-01-01T00:00:00", "values": {}}])  # sem fuso
    assert client.post("/api/v1/ingest", json=bad, headers=h).status_code == 422
    wrong = batch("u", []); wrong["schema_version"] = 99
    assert client.post("/api/v1/ingest", json=wrong, headers=h).status_code == 422
    # fora de ordem é aceito
    now = datetime.now(timezone.utc) - timedelta(minutes=5)
    s = [mk_sample(now + timedelta(seconds=30)), mk_sample(now)]
    assert client.post("/api/v1/ingest", json=batch("u", s), headers=h).json()["accepted"] == 2


def test_na_never_becomes_zero(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc) - timedelta(hours=6)
    feed(client, m["token"], "u", now, 1400, gpu_util_percent=None)
    mid = m["id"]
    s = admin.get(f"/api/v1/machines/{mid}/summary?range=6h").json()
    g = s["metrics"]["gpu_util_percent"]
    assert g["available"] is False
    assert s["classification"]["key"] != "subutilizada"
    assert "Utilização de GPU indisponível" in " ".join(s["classification"]["caveats"])
    csvtxt = admin.get(f"/api/v1/export/samples?machine_id={mid}&range=6h").text.splitlines()
    cols = csvtxt[0].split(",")
    gi = cols.index("gpu_util_percent")
    assert csvtxt[1].split(",")[gi] == ""  # vazio, não 0


def test_underutilized_with_enough_data(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc)
    feed(client, m["token"], "u", now - timedelta(hours=20), 20 * 240 - 5)  # ~100% de 20h
    s = admin.get(f"/api/v1/machines/{m['id']}/summary?range=24h").json()
    # 20h/24h = 83% de cobertura
    c = s["classification"]
    assert c["key"] == "subutilizada", c
    assert any("GPU" in r for r in c["reasons"])
    assert c["headroom_gb"] is not None


def test_low_gpu_but_full_memory_not_recommended(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc)
    feed(client, m["token"], "u", now - timedelta(hours=20), 20 * 240 - 5, unified_percent=96.0, mem_percent=96.0)
    c = admin.get(f"/api/v1/machines/{m['id']}/summary?range=24h").json()["classification"]
    assert c["key"] == "pressao" and not c["eligible"]
    cap = admin.get("/api/v1/analysis/capacity").json()
    assert cap["machines"][0]["result"]["key"] == "pressao" and "disclaimer" in cap


def test_insufficient_coverage(client, admin):
    m = make_machine(admin)
    feed(client, m["token"], "u", datetime.now(timezone.utc) - timedelta(hours=2), 40)
    c = admin.get(f"/api/v1/machines/{m['id']}/summary?range=7d").json()["classification"]
    assert c["key"] == "insuficiente"


def test_gaps_are_explicit(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc) - timedelta(hours=3)
    feed(client, m["token"], "u", now, 120)  # 30 min
    feed(client, m["token"], "u", now + timedelta(hours=2), 60)  # buraco de ~1,5 h
    r = admin.get(f"/api/v1/machines/{m['id']}/metrics?metrics=gpu_util_percent&range=6h&bucket=60").json()
    assert r["gaps"], "lacuna deve aparecer"
    assert any(p["gpu_util_percent"] is None for p in r["points"])  # linha quebrada, não zero


def test_time_weighted_vs_simple_mean(client, admin):
    m = make_machine(admin)
    h = {"Authorization": f"Bearer {m['token']}"}
    now = datetime.now(timezone.utc) - timedelta(hours=1)
    a = mk_sample(now, gpu_util_percent=100.0); a["interval_s"] = 100
    b = mk_sample(now + timedelta(minutes=10), gpu_util_percent=0.0); b["interval_s"] = 10
    client.post("/api/v1/ingest", json=batch("u", [a, b]), headers=h)
    g = admin.get(f"/api/v1/machines/{m['id']}/summary?range=6h").json()["metrics"]["gpu_util_percent"]
    assert g["mean"] == 50.0 and abs(g["wmean"] - 100 * 100 / 110) < 0.1


def test_status_and_alert_lifecycle(client, admin):
    m = make_machine(admin)
    now = datetime.now(timezone.utc)
    feed(client, m["token"], "u", now - timedelta(minutes=30), 120, mem_available_bytes=4e9)  # ~3% livre
    with dbm.SessionLocal() as db:
        mach = db.get(Machine, m["id"])
        evaluate_machine(db, mach)
        evaluate_machine(db, mach)  # deduplicação
    al = admin.get("/api/v1/alerts?status=open").json()["items"]
    rules = [a["rule"] for a in al]
    assert rules.count("memoria_disponivel_baixa") == 1
    # simula silêncio do agente: sem comunicação
    with dbm.SessionLocal() as db:
        mach = db.get(Machine, m["id"])
        mach.last_seen = now - timedelta(minutes=30)
        db.commit()
        evaluate_machine(db, mach)
    al = admin.get("/api/v1/alerts?status=open").json()["items"]
    assert "sem_comunicacao" in [a["rule"] for a in al]
    assert admin.get(f"/api/v1/machines/{m['id']}").json()["status"] == "sem_comunicacao"
    # recuperação
    feed(client, m["token"], "u", datetime.now(timezone.utc) - timedelta(minutes=2), 8)
    with dbm.SessionLocal() as db:
        evaluate_machine(db, db.get(Machine, m["id"]))
    open_rules = [a["rule"] for a in admin.get("/api/v1/alerts?status=open").json()["items"]]
    assert "sem_comunicacao" not in open_rules
    resolved = admin.get("/api/v1/alerts?status=resolved").json()["items"]
    assert any(a["rule"] == "sem_comunicacao" and a["resolved_at"] for a in resolved)


def test_token_rotation_and_revocation(client, admin):
    m = make_machine(admin)
    old = m["token"]
    new = admin.post(f"/api/v1/machines/{m['id']}/token").json()["token"]
    h = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731
    assert client.post("/api/v1/ingest", json=batch("u", []), headers=h(old)).status_code == 401
    assert client.post("/api/v1/ingest", json=batch("u", []), headers=h(new)).status_code == 202
    admin.delete(f"/api/v1/machines/{m['id']}/token")
    assert client.post("/api/v1/ingest", json=batch("u", []), headers=h(new)).status_code == 401


def test_retention_rolls_up_not_silent(client, admin, monkeypatch):
    m = make_machine(admin)
    now = datetime.now(timezone.utc)
    feed(client, m["token"], "u", now - timedelta(days=5), 240)
    monkeypatch.setenv("RAW_RETENTION_DAYS", "1")
    from app.config import get_settings
    get_settings.cache_clear()
    with dbm.SessionLocal() as db:
        res = run_retention(db, now)
        assert res["rolled_up_samples"] == 240 and db.query(Sample).count() == 0
    ev = admin.get("/api/v1/alerts?status=resolved").json()["items"]
    assert any(a["rule"] == "retencao" for a in ev)
    # histórico longo ainda responde via rollups
    r = admin.get(f"/api/v1/machines/{m['id']}/metrics?metrics=cpu_percent&range=7d").json()
    assert any(p["cpu_percent"] is not None for p in r["points"])


def test_projects_and_allocations(client, admin):
    m = make_machine(admin)
    p1 = admin.post("/api/v1/projects", json={"name": "Visão", "priority": "alta"}).json()
    p2 = admin.post("/api/v1/projects", json={"name": "NLP"}).json()
    for p, k in ((p1, "principal"), (p2, "compartilhada")):
        assert admin.post("/api/v1/allocations", json={"machine_id": m["id"], "project_id": p["id"], "kind": k}).status_code == 201
    ov = admin.get("/api/v1/allocations/overview").json()
    assert ov[0]["simultaneous"] and len(ov[0]["projects"]) == 2


def test_settings_validation(client, admin):
    r = admin.put("/api/v1/settings/classification", json={"under_gpu_mean": 20})
    assert r.status_code == 200 and r.json()["under_gpu_mean"] == 20
    assert admin.put("/api/v1/settings/classification", json={"under_gpu_mean": "x"}).status_code == 422
    assert admin.get("/api/v1/branding").json()["name"]


def test_overview_empty_install(client, admin):
    r = admin.get("/api/v1/overview").json()
    assert r["totals"]["machines"] == 0 and r["totals"]["gpu_avg_now"] is None


def test_stream_requires_admin(client):
    assert client.get("/api/v1/stream").status_code == 401


def test_broadcaster_delivers_to_subscribers():
    import asyncio
    from app.broadcast import Broadcaster

    async def run():
        b = Broadcaster(max_queue=1)
        b.bind(asyncio.get_running_loop())
        q = b.subscribe()
        b.publish("sample", {"machine_id": 1})
        b.publish("sample", {"machine_id": 2})  # fila cheia: descartado sem bloquear
        await asyncio.sleep(0)
        msg = q.get_nowait()
        assert msg.startswith("event: sample\n") and '"machine_id": 1' in msg and q.empty()
        b.unsubscribe(q)
        b.publish("sample", {})
        assert not b.subscribers

    asyncio.run(run())


def test_delete_machine_removes_history(client, admin):
    from datetime import datetime, timezone
    r = admin.post("/api/v1/machines", json={"name": "apagar-me"}).json()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {"schema_version": 1, "agent_version": "t", "machine_uid": "u", "system": {},
            "samples": [{"ts": ts, "interval_s": 15, "values": {"cpu_percent": 1.0}, "quality": {}}]}
    assert client.post("/api/v1/ingest", json=body, headers={"Authorization": f"Bearer {r['token']}"}).status_code == 202
    assert admin.delete(f"/api/v1/machines/{r['id']}").status_code == 200
    assert admin.get(f"/api/v1/machines/{r['id']}").status_code == 404
    assert client.post("/api/v1/ingest", json=body, headers={"Authorization": f"Bearer {r['token']}"}).status_code == 401
    from app.db import SessionLocal
    from app.models import Sample
    with SessionLocal() as db:
        assert db.query(Sample).filter_by(machine_id=r["id"]).count() == 0


def test_rename_machine(client, admin):
    a = admin.post("/api/v1/machines", json={"name": "a"}).json()
    admin.post("/api/v1/machines", json={"name": "b"})
    r = admin.patch(f"/api/v1/machines/{a['id']}", json={"name": "  Spark 01  "})
    assert r.status_code == 200 and r.json()["name"] == "Spark 01"
    assert admin.patch(f"/api/v1/machines/{a['id']}", json={"name": "b"}).status_code == 409
    assert admin.patch(f"/api/v1/machines/{a['id']}", json={"name": "   "}).status_code == 422


def test_process_ranking(client, admin):
    from datetime import datetime, timedelta, timezone
    m = admin.post("/api/v1/machines", json={"name": "proc"}).json()
    now = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=5)
    samples = []
    for i in range(4):
        procs = [{"pid": 10, "name": "python", "user": "ana", "cmd": "python train.py", "cpu_percent": 400.0,
                  "mem_bytes": 1e9, "gpu_util_percent": 90.0, "gpu_mem_bytes": None},
                 {"pid": 20, "name": "ffmpeg", "user": "bob", "cpu_percent": 800.0, "mem_bytes": 2e8,
                  "gpu_util_percent": None, "gpu_mem_bytes": None},
                 {"pid": "lixo", "name": "x"}]
        samples.append({"ts": (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ"), "interval_s": 15,
                        "values": {"cpu_percent": 50.0}, "quality": {}, "extra": {"processes": procs}})
    body = {"schema_version": 1, "agent_version": "t", "machine_uid": "u-proc", "system": {}, "samples": samples}
    h = {"Authorization": f"Bearer {m['token']}"}
    assert client.post("/api/v1/ingest", json=body, headers=h).status_code == 202
    assert client.post("/api/v1/ingest", json=body, headers=h).json()["duplicates"] == 4  # reenvio não duplica processos
    r = admin.get(f"/api/v1/machines/{m['id']}/processes?range=1h&sort=cpu").json()["processes"]
    assert [p["name"] for p in r] == ["ffmpeg", "python"]
    assert abs(r[0]["cpu_core_hours"] - 8 * 60 / 3600) < 1e-9 and r[0]["gpu_avg"] is None  # N/A não vira zero
    g = admin.get(f"/api/v1/machines/{m['id']}/processes?range=1h&sort=gpu").json()["processes"]
    assert g[0]["name"] == "python" and g[0]["gpu_max"] == 90.0 and g[0]["cmd_example"] == "python train.py"
    assert admin.get(f"/api/v1/machines/{m['id']}/processes?sort=x").status_code == 422
