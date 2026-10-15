"""Coletores de métricas.

Cada métrica é registrada com um valor (float | None), um estado de qualidade e a fonte:

  ok           valor medido (inclusive 0 real)
  unsupported  hardware/driver reporta N/A ou Not Supported
  unavailable  fonte inexistente ou temporariamente ausente
  error        a coleta falhou

Valores indisponíveis NUNCA são convertidos em zero.
"""
from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

import psutil

log = logging.getLogger("ceia_agent.metrics")

PSEUDO_FS = {
    "tmpfs", "devtmpfs", "squashfs", "overlay", "proc", "sysfs", "cgroup", "cgroup2", "devpts",
    "efivarfs", "securityfs", "debugfs", "tracefs", "fusectl", "configfs", "pstore", "bpf",
    "autofs", "mqueue", "hugetlbfs", "ramfs", "nsfs", "binfmt_misc", "fuse.lxcfs",
}
NA_TOKENS = {"n/a", "[n/a]", "not supported", "[not supported]", "unknown error", "[unknown error]", "", "-"}


class Sample:
    """Acumula métricas escalares com qualidade e fonte."""

    def __init__(self) -> None:
        self.values: dict[str, float | None] = {}
        self.quality: dict[str, str] = {}
        self.sources: dict[str, str] = {}
        self.extra: dict[str, Any] = {}

    def put(self, name: str, value: float | int | None, source: str, status: str | None = None) -> None:
        if value is None:
            status = status or "unavailable"
        else:
            status = status or "ok"
        self.values[name] = None if value is None else float(value)
        self.quality[name] = status
        self.sources[name] = source


def parse_smi_value(raw: str | None) -> tuple[float | None, str]:
    """Converte um campo do nvidia-smi. Retorna (valor, status)."""
    if raw is None:
        return None, "unavailable"
    s = raw.strip()
    low = s.lower()
    if low in NA_TOKENS or "not supported" in low or low.startswith("[n/a"):
        return None, "unsupported"
    m = re.match(r"^-?\d+(\.\d+)?", s)
    if not m:
        return None, "unavailable"
    return float(m.group(0)), "ok"


# ---------------------------------------------------------------- sistema ----

def read_proc(path: str) -> str | None:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def parse_meminfo(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].endswith(":"):
            out[parts[0][:-1]] = int(parts[1]) * 1024 if len(parts) > 2 and parts[2] == "kB" else int(parts[1])
    return out


def parse_psi(text: str | None) -> dict[str, float] | None:
    """Formato: 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0'."""
    if not text:
        return None
    out: dict[str, float] = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        kind = parts[0]
        for kv in parts[1:]:
            if "=" in kv:
                k, v = kv.split("=", 1)
                try:
                    out[f"{kind}_{k}"] = float(v)
                except ValueError:
                    pass
    return out or None


class SystemCollector:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._last_t: float | None = None
        self._last_disk: Any = None
        self._last_net: Any = None
        psutil.cpu_percent(percpu=True)  # prime

    def collect(self, s: Sample) -> None:
        now = self._clock()
        dt = (now - self._last_t) if self._last_t is not None else None
        self._cpu(s)
        self._mem(s)
        self._psi(s)
        self._disk_io(s, dt)
        self._net(s, dt)
        self._filesystems(s)
        try:
            s.put("uptime_seconds", time.time() - psutil.boot_time(), "psutil")
        except Exception:
            s.put("uptime_seconds", None, "psutil", "error")
        self._last_t = now

    def _cpu(self, s: Sample) -> None:
        try:
            per = psutil.cpu_percent(percpu=True)
            s.put("cpu_percent", sum(per) / len(per) if per else None, "psutil")
            s.put("cpu_cores", len(per), "psutil")
            s.extra["cpu_per_core"] = per
            l1, l5, l15 = os.getloadavg()
            s.put("load_1", l1, "os.getloadavg")
            s.put("load_5", l5, "os.getloadavg")
            s.put("load_15", l15, "os.getloadavg")
        except Exception as e:  # pragma: no cover
            log.warning("falha na coleta de CPU: %s", e)
            s.put("cpu_percent", None, "psutil", "error")

    def _mem(self, s: Sample) -> None:
        text = read_proc("/proc/meminfo")
        try:
            if text:
                mi = parse_meminfo(text)
                total = mi["MemTotal"]
                avail = mi.get("MemAvailable", mi.get("MemFree", 0))
                used = total - avail
                src = "proc_meminfo"
                s.put("mem_total_bytes", total, src)
                s.put("mem_available_bytes", avail, src)
                s.put("mem_used_bytes", used, src)
                s.put("mem_percent", 100.0 * used / total, src)
                s.put("mem_cached_bytes", mi.get("Cached"), src)
                s.put("mem_buffers_bytes", mi.get("Buffers"), src)
                s.put("swap_used_bytes", mi.get("SwapTotal", 0) - mi.get("SwapFree", 0) if "SwapTotal" in mi else None, src)
            else:
                vm = psutil.virtual_memory()
                src = "psutil"
                s.put("mem_total_bytes", vm.total, src)
                s.put("mem_available_bytes", vm.available, src)
                s.put("mem_used_bytes", vm.total - vm.available, src)
                s.put("mem_percent", 100.0 * (vm.total - vm.available) / vm.total, src)
                s.put("mem_cached_bytes", getattr(vm, "cached", None), src)
                s.put("mem_buffers_bytes", getattr(vm, "buffers", None), src)
                s.put("swap_used_bytes", psutil.swap_memory().used, src)
        except Exception as e:
            log.warning("falha na coleta de memória: %s", e)
            s.put("mem_percent", None, "proc_meminfo", "error")

    def _psi(self, s: Sample) -> None:
        for res in ("memory", "cpu", "io"):
            psi = parse_psi(read_proc(f"/proc/pressure/{res}"))
            for kind in ("some", "full"):
                for w in ("avg10", "avg60"):
                    name = f"psi_{res}_{kind}_{w}"
                    if psi and f"{kind}_{w}" in psi:
                        s.put(name, psi[f"{kind}_{w}"], "proc_pressure")
                    elif kind == "full" and res == "cpu":
                        continue  # cpu não possui 'full' em kernels antigos
                    else:
                        s.put(name, None, "proc_pressure", "unsupported")

    def _disk_io(self, s: Sample, dt: float | None) -> None:
        try:
            cur = psutil.disk_io_counters()
        except Exception:
            cur = None
        if cur is None:
            for n in ("disk_read_bps", "disk_write_bps"):
                s.put(n, None, "psutil", "unavailable")
            return
        if self._last_disk is not None and dt and dt > 0:
            s.put("disk_read_bps", max(0, cur.read_bytes - self._last_disk.read_bytes) / dt, "psutil")
            s.put("disk_write_bps", max(0, cur.write_bytes - self._last_disk.write_bytes) / dt, "psutil")
        else:
            s.put("disk_read_bps", None, "psutil", "unavailable")  # 1ª amostra: sem taxa
            s.put("disk_write_bps", None, "psutil", "unavailable")
        self._last_disk = cur

    def _net(self, s: Sample, dt: float | None) -> None:
        try:
            pern = psutil.net_io_counters(pernic=True)
            skip = ("lo", "docker", "veth", "br-", "virbr")
            cur = [v for k, v in pern.items() if not k.startswith(skip)]
            tot = {
                "rx": sum(c.bytes_recv for c in cur), "tx": sum(c.bytes_sent for c in cur),
                "err": sum(c.errin + c.errout for c in cur), "drop": sum(c.dropin + c.dropout for c in cur),
            }
        except Exception:
            tot = None
        if tot is None:
            for n in ("net_rx_bps", "net_tx_bps", "net_errors_total"):
                s.put(n, None, "psutil", "unavailable")
            return
        s.put("net_rx_bytes_total", tot["rx"], "psutil")
        s.put("net_tx_bytes_total", tot["tx"], "psutil")
        s.put("net_errors_total", tot["err"] + tot["drop"], "psutil")
        if self._last_net is not None and dt and dt > 0:
            s.put("net_rx_bps", max(0, tot["rx"] - self._last_net["rx"]) / dt, "psutil")
            s.put("net_tx_bps", max(0, tot["tx"] - self._last_net["tx"]) / dt, "psutil")
        else:
            s.put("net_rx_bps", None, "psutil", "unavailable")
            s.put("net_tx_bps", None, "psutil", "unavailable")
        self._last_net = tot

    def _filesystems(self, s: Sample) -> None:
        fss = []
        seen: set[str] = set()
        try:
            for p in psutil.disk_partitions(all=False):
                if p.fstype in PSEUDO_FS or p.device in seen:
                    continue
                if p.mountpoint.startswith(("/snap", "/boot/efi", "/var/lib/docker", "/run", "/sys", "/proc")):
                    continue
                try:
                    u = shutil.disk_usage(p.mountpoint)
                except OSError:
                    continue
                if u.total == 0:
                    continue
                seen.add(p.device)
                fss.append({
                    "mount": p.mountpoint, "fstype": p.fstype, "total_bytes": u.total,
                    "used_bytes": u.used, "free_bytes": u.free,
                    "percent": round(100.0 * u.used / (u.used + u.free), 2) if (u.used + u.free) else None,
                })
        except Exception as e:  # pragma: no cover
            log.warning("falha na coleta de filesystems: %s", e)
        s.extra["filesystems"] = fss
        root = next((f for f in fss if f["mount"] == "/"), fss[0] if fss else None)
        if root:
            s.put("disk_percent", root["percent"], "shutil.disk_usage")
            s.put("disk_free_bytes", root["free_bytes"], "shutil.disk_usage")
            s.put("disk_total_bytes", root["total_bytes"], "shutil.disk_usage")
        else:
            s.put("disk_percent", None, "shutil.disk_usage", "unavailable")


# -------------------------------------------------------------------- GPU ----

SMI_FIELDS = ["utilization.gpu", "temperature.gpu", "power.draw", "clocks.sm", "clocks.mem",
              "memory.total", "memory.used", "name", "driver_version"]


def run_smi(timeout: float = 5.0) -> str | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        r = subprocess.run(
            [exe, f"--query-gpu={','.join(SMI_FIELDS)}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout if r.returncode == 0 else None
    except (subprocess.TimeoutExpired, OSError):
        return None


class GpuCollector:
    """GPU via NVML (se disponível) com nvidia-smi como fonte alternativa.

    No GB10 a memória é unificada: memory.total/used do NVML costumam ser N/A.
    Nesse caso NÃO usamos o valor como VRAM; a memória unificada vem de /proc/meminfo.
    """

    def __init__(self, smi: Callable[[], str | None] = run_smi, use_nvml: bool = True) -> None:
        self._smi = smi
        self._nvml = None
        if use_nvml:
            try:
                import pynvml  # type: ignore
                pynvml.nvmlInit()
                self._nvml = pynvml
            except Exception:
                self._nvml = None
        self.driver_version: str | None = None
        self.gpu_name: str | None = None

    def collect(self, s: Sample) -> None:
        got: dict[str, tuple[float | None, str, str]] = {}
        if self._nvml:
            try:
                self._from_nvml(got)
            except Exception as e:
                log.debug("NVML falhou: %s", e)
        missing = [k for k in ("gpu_util_percent", "gpu_temp_c", "gpu_power_w", "gpu_clock_sm_mhz")
                   if k not in got or got[k][0] is None]
        if missing or not self._nvml:
            self._from_smi(got)
        for name in ("gpu_util_percent", "gpu_temp_c", "gpu_power_w", "gpu_clock_sm_mhz", "gpu_clock_mem_mhz",
                     "gpu_mem_used_bytes", "gpu_mem_total_bytes"):
            v, st, src = got.get(name, (None, "unavailable", "none"))
            s.put(name, v, src, st)
        s.extra["gpu_name"] = self.gpu_name
        s.extra["driver_version"] = self.driver_version
        # memória unificada: derivada de meminfo (já coletada); não é somada à RAM
        total = s.values.get("mem_total_bytes")
        if total:
            s.put("unified_total_bytes", total, "proc_meminfo")
            s.put("unified_used_bytes", s.values.get("mem_used_bytes"), "proc_meminfo")
            s.put("unified_available_bytes", s.values.get("mem_available_bytes"), "proc_meminfo")
            s.put("unified_percent", s.values.get("mem_percent"), "proc_meminfo")
        s.extra["unified_memory"] = True

    def _from_nvml(self, got: dict) -> None:
        n = self._nvml
        h = n.nvmlDeviceGetHandleByIndex(0)

        def attempt(name: str, fn: Callable[[], float]) -> None:
            try:
                got[name] = (float(fn()), "ok", "nvml")
            except Exception as e:  # NVMLError_NotSupported etc.
                got[name] = (None, "unsupported" if "supported" in str(e).lower() else "unavailable", "nvml")

        attempt("gpu_util_percent", lambda: n.nvmlDeviceGetUtilizationRates(h).gpu)
        attempt("gpu_temp_c", lambda: n.nvmlDeviceGetTemperature(h, n.NVML_TEMPERATURE_GPU))
        attempt("gpu_power_w", lambda: n.nvmlDeviceGetPowerUsage(h) / 1000.0)
        attempt("gpu_clock_sm_mhz", lambda: n.nvmlDeviceGetClockInfo(h, n.NVML_CLOCK_SM))
        attempt("gpu_clock_mem_mhz", lambda: n.nvmlDeviceGetClockInfo(h, n.NVML_CLOCK_MEM))
        try:
            self.driver_version = n.nvmlSystemGetDriverVersion()
            nm = n.nvmlDeviceGetName(h)
            self.gpu_name = nm.decode() if isinstance(nm, bytes) else nm
        except Exception:
            pass

    def _from_smi(self, got: dict) -> None:
        out = self._smi()
        if not out:
            for k in ("gpu_util_percent", "gpu_temp_c", "gpu_power_w", "gpu_clock_sm_mhz"):
                got.setdefault(k, (None, "unavailable", "nvidia-smi"))
            return
        row = [c.strip() for c in out.strip().splitlines()[0].split(",")]
        row += [""] * (len(SMI_FIELDS) - len(row))
        d = dict(zip(SMI_FIELDS, row))
        mapping = {"utilization.gpu": "gpu_util_percent", "temperature.gpu": "gpu_temp_c",
                   "power.draw": "gpu_power_w", "clocks.sm": "gpu_clock_sm_mhz", "clocks.mem": "gpu_clock_mem_mhz"}
        for field, name in mapping.items():
            if name in got and got[name][0] is not None:
                continue
            v, st = parse_smi_value(d[field])
            got[name] = (v, st, "nvidia-smi")
        for field, name in (("memory.total", "gpu_mem_total_bytes"), ("memory.used", "gpu_mem_used_bytes")):
            v, st = parse_smi_value(d[field])
            got[name] = (v * 1024 * 1024 if v is not None else None, st, "nvidia-smi")
        if d["driver_version"] and not self.driver_version:
            self.driver_version = d["driver_version"]
        if d["name"] and not self.gpu_name:
            self.gpu_name = d["name"]


def static_info(driver_version: str | None, gpu_name: str | None) -> dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "arch": platform.machine(),
        "os": f"{platform.system()} {platform.release()}",
        "kernel": platform.release(),
        "python": platform.python_version(),
        "driver_version": driver_version,
        "gpu_name": gpu_name,
    }


# -------------------------------------------------------------- processos ----

def run_smi_procs(timeout: float = 5.0) -> tuple[str | None, str | None]:
    """(compute-apps csv, pmon) do nvidia-smi; None quando indisponível."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None, None
    out: list[str | None] = []
    for args in ([f"--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"], ["pmon", "-c", "1", "-s", "u"]):
        try:
            r = subprocess.run([exe, *args], capture_output=True, text=True, timeout=timeout)
            out.append(r.stdout if r.returncode == 0 else None)
        except (subprocess.TimeoutExpired, OSError):
            out.append(None)
    return out[0], out[1]


def parse_smi_procs(apps: str | None, pmon: str | None) -> dict[int, dict[str, float | None]]:
    """pid -> {gpu_util_percent, gpu_mem_bytes}. Campos N/A ficam None (nunca zero)."""
    res: dict[int, dict[str, float | None]] = {}
    for line in (apps or "").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and parts[0].isdigit():
            v, _ = parse_smi_value(parts[1])
            res.setdefault(int(parts[0]), {"gpu_util_percent": None, "gpu_mem_bytes": None})["gpu_mem_bytes"] = \
                v * 1024 * 1024 if v is not None else None
    for line in (pmon or "").splitlines():
        if line.startswith("#"):
            continue
        parts = line.split()  # gpu pid type sm mem ...
        if len(parts) >= 4 and parts[1].isdigit():
            v, _ = parse_smi_value(parts[3])
            res.setdefault(int(parts[1]), {"gpu_util_percent": None, "gpu_mem_bytes": None})["gpu_util_percent"] = v
    return res


class ProcessCollector:
    """Top processos por CPU e por GPU, gravados em s.extra["processes"].

    cpu_percent é relativo a UM núcleo (pode passar de 100 em processos multithread).
    """

    def __init__(self, top_n: int = 10, cmdline: bool = True, nvml: Any = None,
                 smi: Callable[[], tuple[str | None, str | None]] = run_smi_procs) -> None:
        self.top_n = top_n
        self.cmdline = cmdline
        self._nvml = nvml
        self._smi = smi
        self._nvml_ts = 0
        self._primed = False

    def _gpu_nvml(self) -> dict[int, dict[str, float | None]]:
        n = self._nvml
        h = n.nvmlDeviceGetHandleByIndex(0)
        res: dict[int, dict[str, float | None]] = {}
        for fn in ("nvmlDeviceGetComputeRunningProcesses", "nvmlDeviceGetGraphicsRunningProcesses"):
            try:
                for p in getattr(n, fn)(h):
                    mem = getattr(p, "usedGpuMemory", None)
                    res.setdefault(p.pid, {"gpu_util_percent": None, "gpu_mem_bytes": None})["gpu_mem_bytes"] = \
                        float(mem) if isinstance(mem, int) and mem >= 0 and mem < 2 ** 62 else None
            except Exception:
                pass
        try:
            for u in n.nvmlDeviceGetProcessUtilization(h, self._nvml_ts):
                d = res.setdefault(u.pid, {"gpu_util_percent": None, "gpu_mem_bytes": None})
                d["gpu_util_percent"] = max(float(u.smUtil), d["gpu_util_percent"] or 0.0)
                self._nvml_ts = max(self._nvml_ts, u.timeStamp)
        except Exception:  # NotFound = nenhum processo ativo no período; NotSupported em alguns drivers
            pass
        return res

    def gpu_usage(self) -> tuple[dict[int, dict[str, float | None]], str]:
        if self._nvml:
            try:
                res = self._gpu_nvml()
                if any(d["gpu_util_percent"] is not None for d in res.values()) or not shutil.which("nvidia-smi"):
                    return res, "nvml"
            except Exception as e:
                log.debug("NVML (processos) falhou: %s", e)
        return parse_smi_procs(*self._smi()), "nvidia-smi"

    def collect(self, s: Sample) -> None:
        try:
            procs = []
            for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_info"]):
                i = p.info
                procs.append((p, i))
            if not self._primed:  # cpu_percent por processo precisa de duas leituras
                self._primed = True
                return
            gpu, gsrc = self.gpu_usage()
            by_cpu = sorted(procs, key=lambda x: x[1]["cpu_percent"] or 0.0, reverse=True)[: self.top_n]
            gpu_pids = sorted(gpu, key=lambda pid: (gpu[pid]["gpu_util_percent"] or 0.0, gpu[pid]["gpu_mem_bytes"] or 0.0),
                              reverse=True)[: self.top_n]
            chosen = {i["pid"]: (p, i) for p, i in by_cpu if (i["cpu_percent"] or 0) > 0}
            index = {i["pid"]: (p, i) for p, i in procs}
            for pid in gpu_pids:
                if pid in index:
                    chosen[pid] = index[pid]
            out = []
            for pid, (p, i) in chosen.items():
                g = gpu.get(pid, {})
                cmd = None
                if self.cmdline:
                    try:
                        cmd = " ".join(p.cmdline())[:240] or None
                    except (psutil.Error, OSError):
                        pass
                mi = i.get("memory_info")
                out.append({"pid": pid, "name": (i.get("name") or "?")[:128], "user": (i.get("username") or "?")[:64],
                            "cmd": cmd, "cpu_percent": round(i.get("cpu_percent") or 0.0, 1),
                            "mem_bytes": float(mi.rss) if mi else None,
                            "gpu_util_percent": g.get("gpu_util_percent"), "gpu_mem_bytes": g.get("gpu_mem_bytes")})
            s.extra["processes"] = out
            s.sources["processes"] = f"psutil+{gsrc}"
        except Exception as e:
            log.warning("falha ao coletar processos: %s", e)
