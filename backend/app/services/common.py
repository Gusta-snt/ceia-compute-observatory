from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Setting

DEFAULTS: dict[str, dict[str, Any]] = {
    "branding": {
        "name": "CEIA Compute Observatory",
        "subtitle": "Centro de Excelência em Inteligência Artificial · UFG",
        "ceia_logo": "/brand/ceia.png",
        "ufg_logo": "/brand/ufg.png",
        "demo_mode": False,
    },
    "status": {"offline_after_seconds": 120, "min_samples": 20},
    "classification": {
        # Valores iniciais documentados em docs/METRICS.md; ajuste conforme a realidade do laboratório.
        "min_coverage": 0.6,
        "idle_gpu_percent": 5.0,
        "idle_cpu_percent": 15.0,
        "active_gpu_percent": 30.0,
        "under_gpu_mean": 15.0, "under_gpu_p95": 50.0,
        "under_mem_mean": 50.0, "under_mem_p95": 75.0,
        "under_cpu_mean": 30.0,
        "high_gpu_mean": 60.0, "high_gpu_p95": 90.0, "high_cpu_mean": 70.0,
        "pressure_mem_p95": 90.0, "pressure_psi_p95": 10.0, "pressure_disk_percent": 90.0,
        "min_free_disk_gb": 100.0,
    },
    "alerts": {
        "mem_available_min_percent": 10.0, "psi_memory_some_avg10": 20.0,
        "disk_warning_percent": 90.0, "disk_critical_percent": 95.0,
        "gpu_temp_c": 85.0, "gpu_power_w": 200.0,
        "gpu_sustained_percent": 90.0, "gpu_sustained_minutes": 60,
    },
}


def get_group(db: Session, key: str) -> dict[str, Any]:
    out = copy.deepcopy(DEFAULTS[key])
    row = db.get(Setting, key)
    if row and isinstance(row.value, dict):
        out.update(row.value)
    return out


def set_group(db: Session, key: str, value: dict[str, Any]) -> dict[str, Any]:
    if key not in DEFAULTS:
        raise KeyError(key)
    cur = get_group(db, key)
    cur.update({k: v for k, v in value.items() if k in DEFAULTS[key]})
    row = db.get(Setting, key)
    if row:
        row.value = cur
    else:
        db.add(Setting(key=key, value=cur))
    db.commit()
    return cur


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    d = aware(dt)
    return d.isoformat().replace("+00:00", "Z") if d else None


def local_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def pct(values: list[float], p: float) -> float | None:
    """Percentil por interpolação linear (equivale a numpy.percentile padrão)."""
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)
