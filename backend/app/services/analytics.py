"""Séries, estatísticas, mapas de calor e classificação de capacidade.

Convenções:
- amostras ausentes NUNCA contam como zero; viram lacunas explícitas e reduzem a cobertura;
- a média ponderada pelo tempo usa a duração (dur) representada por cada amostra;
- percentis são calculados sobre médias de buckets de 5 minutos (documentado em docs/METRICS.md).
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AvailabilityEvent, Machine, Rollup, Sample
from .common import aware, get_group, local_tz, pct

ANALYSIS_METRICS = ["gpu_util_percent", "unified_percent", "mem_percent", "psi_memory_some_avg10",
                    "cpu_percent", "disk_percent", "gpu_temp_c", "gpu_power_w"]
NICE_BUCKETS = [15, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 86400]
LABELS = {
    "subutilizada": "Potencialmente subutilizada", "moderada": "Utilização moderada",
    "alta": "Alta utilização", "pressao": "Pressão de recursos", "insuficiente": "Dados insuficientes",
}


def pick_bucket(start: datetime, end: datetime, max_points: int = 600) -> int:
    span = max(1.0, (end - start).total_seconds())
    need = span / max_points
    return next((b for b in NICE_BUCKETS if b >= need), NICE_BUCKETS[-1])


def _num(x: Any) -> float | None:
    return None if x is None else float(x)


def bucket_rows(db: Session, machine_id: int, start: datetime, end: datetime, bucket_s: int,
                metrics: list[str]) -> list[dict[str, Any]]:
    b = (Sample.ts_epoch // bucket_s) * bucket_s
    cols: list[Any] = [b.label("b"), func.count().label("n"), func.sum(Sample.dur).label("dur")]
    for m in metrics:
        c = getattr(Sample, m)
        cols += [
            func.avg(c).label(f"{m}__avg"), func.min(c).label(f"{m}__min"), func.max(c).label(f"{m}__max"),
            func.count(c).label(f"{m}__cnt"), func.sum(c * Sample.dur).label(f"{m}__ws"),
            func.sum(case((c.isnot(None), Sample.dur), else_=0.0)).label(f"{m}__wd"),
        ]
    q = (select(*cols).where(Sample.machine_id == machine_id,
                             Sample.ts_epoch >= int(start.timestamp()), Sample.ts_epoch < int(end.timestamp()))
         .group_by(b).order_by(b))
    out = []
    for r in db.execute(q).mappings():
        row: dict[str, Any] = {"t": int(r["b"]), "n": int(r["n"]), "dur": float(r["dur"] or 0)}
        for m in metrics:
            row[m] = {
                "avg": _num(r[f"{m}__avg"]), "min": _num(r[f"{m}__min"]), "max": _num(r[f"{m}__max"]),
                "cnt": int(r[f"{m}__cnt"] or 0), "ws": _num(r[f"{m}__ws"]) or 0.0, "wd": _num(r[f"{m}__wd"]) or 0.0,
            }
        out.append(row)
    return out


def rollup_rows(db: Session, machine_id: int, start: datetime, end: datetime, metrics: list[str]) -> list[dict[str, Any]]:
    rows = db.scalars(select(Rollup).where(
        Rollup.machine_id == machine_id, Rollup.bucket_epoch >= int(start.timestamp()),
        Rollup.bucket_epoch < int(end.timestamp())).order_by(Rollup.bucket_epoch)).all()
    out = []
    for r in rows:
        d: dict[str, Any] = {"t": r.bucket_epoch, "n": r.n_samples, "dur": r.covered_seconds}
        for m in metrics:
            a, mx = (r.avg or {}).get(m), (r.max or {}).get(m)
            d[m] = {"avg": a, "min": None, "max": mx, "cnt": r.n_samples if a is not None else 0,
                    "ws": (a or 0) * r.covered_seconds, "wd": r.covered_seconds if a is not None else 0.0}
        out.append(d)
    return out


def timeseries(db: Session, machine_id: int, start: datetime, end: datetime, metrics: list[str],
               bucket_s: int | None = None) -> dict[str, Any]:
    bucket_s = bucket_s or pick_bucket(start, end)
    cutoff = datetime.now(timezone.utc) - timedelta(days=get_settings().raw_retention_days)
    rows: list[dict] = []
    if start < cutoff:
        rows += rollup_rows(db, machine_id, start, min(end, cutoff), metrics)
    if end > cutoff:
        rows += bucket_rows(db, machine_id, max(start, cutoff), end, bucket_s, metrics)
    # reagrupa (rollups horários podem exigir re-bucket)
    merged: dict[int, dict] = {}
    for r in rows:
        t = (r["t"] // bucket_s) * bucket_s
        d = merged.setdefault(t, {"t": t, **{m: [0.0, 0.0, None] for m in metrics}})
        for m in metrics:
            d[m][0] += r[m]["ws"]
            d[m][1] += r[m]["wd"]
            mx = r[m]["max"]
            if mx is not None:
                d[m][2] = mx if d[m][2] is None else max(d[m][2], mx)
    points, gaps = [], []
    prev = None
    gap_after = max(bucket_s * 3, 60)
    for t in sorted(merged):
        if prev is not None and t - prev > gap_after:
            gaps.append({"from": prev + bucket_s, "to": t})
            points.append({"t": prev + bucket_s, **{m: None for m in metrics}})  # quebra a linha
        p = {"t": t}
        for m in metrics:
            ws, wd, mx = merged[t][m]
            p[m] = round(ws / wd, 3) if wd > 0 else None
            p[f"{m}_max"] = mx
        points.append(p)
        prev = t
    return {"bucket_seconds": bucket_s, "points": points, "gaps": gaps,
            "from": int(start.timestamp()), "to": int(end.timestamp())}


def _metric_stats(rows: list[dict], m: str, window_s: float) -> dict[str, Any]:
    cnt = sum(r[m]["cnt"] for r in rows)
    if cnt == 0:
        return {"available": False, "valid_samples": 0}
    avgs = [r[m]["avg"] for r in rows if r[m]["avg"] is not None]
    wd = sum(r[m]["wd"] for r in rows)
    simple = sum(r[m]["avg"] * r[m]["cnt"] for r in rows if r[m]["avg"] is not None) / cnt
    maxes = [r[m]["max"] for r in rows if r[m]["max"] is not None]
    mins = [r[m]["min"] for r in rows if r[m]["min"] is not None]
    return {
        "available": True, "valid_samples": cnt, "mean": round(simple, 2),
        "wmean": round(sum(r[m]["ws"] for r in rows) / wd, 2) if wd else None,
        "median": round(pct(avgs, 50), 2), "p90": round(pct(avgs, 90), 2), "p95": round(pct(avgs, 95), 2),
        "min": round(min(mins), 2) if mins else None, "max": round(max(maxes), 2) if maxes else None,
        "coverage": round(min(1.0, wd / window_s), 3) if window_s else 0,
    }


def _trend_per_week(rows: list[dict], m: str) -> float | None:
    """Inclinação (pontos percentuais/semana) por regressão sobre médias diárias."""
    daily: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        if r[m]["avg"] is not None:
            daily[r["t"] // 86400].append(r[m]["avg"])
    if len(daily) < 4:
        return None
    xs = sorted(daily)
    ys = [sum(daily[x]) / len(daily[x]) for x in xs]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den * 7, 2) if den else None


def window_analysis(db: Session, machine: Machine, start: datetime, end: datetime) -> dict[str, Any]:
    th = get_group(db, "classification")
    window_s = (end - start).total_seconds()
    rows = bucket_rows(db, machine.id, start, end, 300, ANALYSIS_METRICS)
    total_dur = sum(r["dur"] for r in rows)
    coverage = min(1.0, total_dur / window_s) if window_s else 0.0
    metrics = {m: _metric_stats(rows, m, window_s) for m in ANALYSIS_METRICS}

    idle_s = known_s = 0.0
    above: dict[str, dict[str, float]] = {"gpu_util_percent": {}, "unified_percent": {}}
    hours: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for r in rows:
        g = r["gpu_util_percent"]["avg"]
        c = r["cpu_percent"]["avg"]
        if g is not None:
            known_s += r["dur"]
            if g < th["idle_gpu_percent"] and (c is None or c < th["idle_cpu_percent"]):
                idle_s += r["dur"]
            hours[r["t"] // 3600][0] += r["gpu_util_percent"]["ws"]
            hours[r["t"] // 3600][1] += r["gpu_util_percent"]["wd"]
    for m, thr_list in (("gpu_util_percent", (50, 80, 90)), ("unified_percent", (75, 90, 95))):
        for thr in thr_list:
            above[m][str(thr)] = round(sum(r["dur"] for r in rows
                                           if r[m]["avg"] is not None and r[m]["avg"] >= thr), 0)
    active_hours = sum(1 for ws, wd in hours.values() if wd > 0 and ws / wd >= th["active_gpu_percent"])

    # indisponibilidade registrada pelo servidor
    evs = db.scalars(select(AvailabilityEvent).where(
        AvailabilityEvent.machine_id == machine.id, AvailabilityEvent.status == "sem_comunicacao",
        AvailabilityEvent.started_at < end)).all()
    outages = []
    for e in evs:
        s0, e0 = max(aware(e.started_at), start), min(aware(e.ended_at) or end, end)
        if e0 > s0:
            outages.append((e0 - s0).total_seconds())
    # lacunas de dados (mesmo sem evento registrado)
    gaps = [rows[i + 1]["t"] - rows[i]["t"] - 300 for i in range(len(rows) - 1) if rows[i + 1]["t"] - rows[i]["t"] > 600]

    result: dict[str, Any] = {
        "machine_id": machine.id, "from": int(start.timestamp()), "to": int(end.timestamp()),
        "window_seconds": window_s, "coverage": round(coverage, 3), "metrics": metrics,
        "idle_seconds": idle_s, "idle_fraction": round(idle_s / known_s, 3) if known_s else None,
        "time_above": above, "active_hours": active_hours,
        "outages": {"count": len(outages), "total_seconds": sum(outages), "longest_seconds": max(outages, default=0)},
        "data_gaps": {"count": len(gaps), "total_seconds": sum(gaps)},
        "trend_gpu_pp_per_week": _trend_per_week(rows, "gpu_util_percent"),
        "trend_memory_pp_per_week": _trend_per_week(rows, "unified_percent"),
        "total_samples": sum(r["n"] for r in rows),
        "capacity": latest_capacity(db, machine.id),
    }
    result["classification"] = classify(result, th, machine)
    return result


def classify(a: dict[str, Any], th: dict[str, Any], machine: Machine) -> dict[str, Any]:
    m = a["metrics"]
    gpu, mem, cpu, psi, disk = (m["gpu_util_percent"], m["unified_percent"], m["cpu_percent"],
                                m["psi_memory_some_avg10"], m["disk_percent"])
    if not mem["available"] and m["mem_percent"]["available"]:
        mem = m["mem_percent"]  # unificada deriva de meminfo; fallback equivalente
    reasons: list[str] = []
    cov = a["coverage"]
    if a["total_samples"] == 0 or cov < th["min_coverage"]:
        return {"key": "insuficiente", "label": LABELS["insuficiente"], "confidence": "baixa",
                "reasons": [f"Cobertura de dados de {cov:.0%} no período, abaixo do mínimo de {th['min_coverage']:.0%}."],
                "eligible": False, "headroom_gb": None, "caveats": []}
    caveats = []
    gpu_ok = gpu["available"]
    if not gpu_ok:
        caveats.append("Utilização de GPU indisponível (não suportada ou sem coleta): análise inconclusiva para GPU.")
    if not mem["available"]:
        caveats.append("Memória unificada indisponível.")
    conf = "alta" if cov >= 0.9 and gpu_ok and mem["available"] else "media" if cov >= 0.75 and (gpu_ok or mem["available"]) else "baixa"

    pressure: list[str] = []
    if mem["available"] and mem["p95"] >= th["pressure_mem_p95"]:
        pressure.append(f"memória unificada com P95 de {mem['p95']:.0f}% (limite {th['pressure_mem_p95']:.0f}%)")
    if psi["available"] and psi["p95"] >= th["pressure_psi_p95"]:
        pressure.append(f"pressão de memória (PSI some) com P95 de {psi['p95']:.1f}% (limite {th['pressure_psi_p95']:.0f}%)")
    if disk["available"] and disk["max"] is not None and disk["max"] >= th["pressure_disk_percent"]:
        pressure.append(f"armazenamento em {disk['max']:.0f}% (limite {th['pressure_disk_percent']:.0f}%)")
    high: list[str] = []
    if gpu_ok and gpu["mean"] >= th["high_gpu_mean"]:
        high.append(f"GPU com média de {gpu['mean']:.0f}% (limite {th['high_gpu_mean']:.0f}%)")
    if gpu_ok and gpu["p95"] >= th["high_gpu_p95"]:
        high.append(f"GPU com P95 de {gpu['p95']:.0f}% (limite {th['high_gpu_p95']:.0f}%)")
    if cpu["available"] and cpu["mean"] >= th["high_cpu_mean"]:
        high.append(f"CPU com média de {cpu['mean']:.0f}% (limite {th['high_cpu_mean']:.0f}%)")

    headroom = None
    if mem["available"]:
        tot = a["capacity"]["unified_total_bytes"]
        headroom = None if tot is None else round(tot * (100 - mem["p95"]) / 100 / 1024**3, 1)

    if pressure:
        key = "pressao"
        reasons = [f"Pressão de recursos: {x}." for x in pressure]
        reasons += [f"Também: {x}." for x in high]
    elif high:
        key = "alta"
        reasons = [f"Alta utilização: {x}." for x in high]
    else:
        under_checks = []
        if gpu_ok:
            under_checks.append(gpu["mean"] < th["under_gpu_mean"] and gpu["p95"] < th["under_gpu_p95"])
        if mem["available"]:
            under_checks.append(mem["mean"] < th["under_mem_mean"] and mem["p95"] < th["under_mem_p95"])
        if cpu["available"]:
            under_checks.append(cpu["mean"] < th["under_cpu_mean"])
        free = a["capacity"]["disk_free_bytes"]
        if free is not None and free / 1024**3 < th["min_free_disk_gb"]:
            under_checks.append(False)
            caveats.append(f"Armazenamento livre de {free / 1024**3:.0f} GB, abaixo do mínimo de {th['min_free_disk_gb']:.0f} GB.")
        if gpu_ok and mem["available"] and under_checks and all(under_checks):
            key = "subutilizada"
            reasons = [f"GPU com média de {gpu['mean']:.0f}% e P95 de {gpu['p95']:.0f}% no período.",
                       f"Memória unificada com média de {mem['mean']:.0f}% e P95 de {mem['p95']:.0f}%."]
            if cpu["available"]:
                reasons.append(f"CPU com média de {cpu['mean']:.0f}%.")
            if a["idle_fraction"] is not None:
                reasons.append(f"Ociosa em {a['idle_fraction']:.0%} do tempo observado.")
        elif not gpu_ok:
            key = "insuficiente"
            reasons = ["Sem utilização de GPU confiável, a máquina não pode ser considerada subutilizada."]
            conf = "baixa"
        else:
            key = "moderada"
            reasons = []
            if gpu_ok:
                reasons.append(f"GPU com média de {gpu['mean']:.0f}% e P95 de {gpu['p95']:.0f}%.")
            if mem["available"]:
                reasons.append(f"Memória unificada com média de {mem['mean']:.0f}% e P95 de {mem['p95']:.0f}%.")
            reasons.append("Indicadores fora dos limites de subutilização, sem atingir os de alta utilização.")
    if key == "subutilizada" and gpu_ok and mem["available"] and gpu["mean"] < th["under_gpu_mean"] and mem["p95"] >= th["under_mem_p95"]:
        key = "moderada"
    eligible = key == "subutilizada" and conf != "baixa"
    if a["outages"]["count"]:
        caveats.append(f"{a['outages']['count']} período(s) sem comunicação registrado(s), "
                       f"totalizando {a['outages']['total_seconds'] / 3600:.1f} h.")
    return {"key": key, "label": LABELS[key], "confidence": conf, "reasons": reasons, "caveats": caveats,
            "eligible": eligible, "headroom_gb": headroom}


def heatmap(db: Session, machine_ids: list[int], metric: str, days: int) -> dict[str, Any]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    tz = local_tz()
    cells: dict[tuple[int, int], list[float]] = defaultdict(lambda: [0.0, 0.0])
    counted = 0
    for mid in machine_ids:
        for r in bucket_rows(db, mid, start, end, 3600, [metric]):
            d = r[metric]
            if d["wd"] > 0:
                loc = datetime.fromtimestamp(r["t"], tz)
                c = cells[(loc.weekday(), loc.hour)]
                c[0] += d["ws"]
                c[1] += d["wd"]
                counted += r["n"]
    grid = [[(round(cells[(w, h)][0] / cells[(w, h)][1], 2) if cells[(w, h)][1] > 0 else None) for h in range(24)]
            for w in range(7)]
    span_days = days
    enough = counted >= 24 * 7 * 12 and span_days >= 3  # ao menos ~1 amostra de 5min por célula
    return {"metric": metric, "days": days, "timezone": get_settings().timezone, "grid": grid,
            "sufficient": enough, "samples": counted}


def latest_capacity(db: Session, machine_id: int) -> dict[str, float | None]:
    r = db.execute(select(Sample.unified_total_bytes, Sample.unified_available_bytes, Sample.disk_free_bytes,
                          Sample.disk_total_bytes).where(Sample.machine_id == machine_id)
                   .order_by(Sample.ts.desc()).limit(1)).first()
    if not r:
        return {"unified_total_bytes": None, "unified_available_bytes": None, "disk_free_bytes": None,
                "disk_total_bytes": None}
    return {"unified_total_bytes": r[0], "unified_available_bytes": r[1], "disk_free_bytes": r[2],
            "disk_total_bytes": r[3]}
