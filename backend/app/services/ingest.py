from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import METRIC_COLUMNS, Machine, ProcessSample, Sample

SCHEMA_VERSION = 1
QUALITY_VALUES = {"ok", "unsupported", "unavailable", "error", "missing"}


class SampleIn(BaseModel):
    ts: datetime
    interval_s: float = Field(15.0, ge=0.5, le=3600)
    values: dict[str, float | None] = Field(default_factory=dict)
    quality: dict[str, str] = Field(default_factory=dict)
    sources: dict[str, str] = Field(default_factory=dict)
    extra: dict = Field(default_factory=dict)

    @field_validator("values")
    @classmethod
    def _finite(cls, v: dict[str, float | None]) -> dict[str, float | None]:
        if len(v) > 200:
            raise ValueError("muitas métricas por amostra")
        for k, x in v.items():
            if x is not None and not math.isfinite(x):
                raise ValueError(f"valor não finito em {k}")
        return v

    @field_validator("ts")
    @classmethod
    def _tz(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("timestamp sem fuso (esperado UTC)")
        return v.astimezone(timezone.utc)


class BatchIn(BaseModel):
    schema_version: int
    agent_version: str = Field(max_length=32)
    machine_uid: str = Field(min_length=1, max_length=64)
    system: dict = Field(default_factory=dict)
    samples: list[SampleIn]


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    rejected: int
    errors: list[str]


def _row(machine_id: int, s: SampleIn, now: datetime) -> dict:
    row: dict = {c: None for c in METRIC_COLUMNS}
    for k, v in s.values.items():
        if k in row:
            # nunca aceitar 0 quando a qualidade declara indisponível
            if s.quality.get(k, "ok") != "ok":
                v = None
            row[k] = v
    row.update(
        machine_id=machine_id, ts=s.ts, ts_epoch=int(s.ts.timestamp()),
        dur=min(max(s.interval_s, 1.0), 120.0),
        quality={k: v for k, v in s.quality.items() if v in QUALITY_VALUES and v != "ok"},
        extra={k: s.extra[k] for k in ("filesystems", "cpu_per_core", "unified_memory") if k in s.extra},
        received_at=now,
    )
    return row


def _num(v: object) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 else None


def _str(v: object, n: int) -> str | None:
    return str(v)[:n] if v not in (None, "") else None


def _proc_rows(machine_id: int, row: dict, procs: object) -> list[dict]:
    if not isinstance(procs, list):
        return []
    out = []
    for p in procs[:50]:
        if not isinstance(p, dict) or not isinstance(p.get("pid"), int):
            continue
        out.append(dict(machine_id=machine_id, ts_epoch=row["ts_epoch"], dur=row["dur"], pid=p["pid"],
                        name=_str(p.get("name"), 128) or "?", username=_str(p.get("user"), 64), cmd=_str(p.get("cmd"), 240),
                        cpu_percent=_num(p.get("cpu_percent")), mem_bytes=_num(p.get("mem_bytes")),
                        gpu_util_percent=_num(p.get("gpu_util_percent")), gpu_mem_bytes=_num(p.get("gpu_mem_bytes"))))
    return out


def ingest_batch(db: Session, machine: Machine, batch: BatchIn) -> IngestResult:
    cfg = get_settings()
    now = datetime.now(timezone.utc)
    errors: list[str] = []
    if batch.schema_version != SCHEMA_VERSION:
        raise ValueError(f"schema_version {batch.schema_version} não suportado")
    if len(batch.samples) > cfg.max_batch_samples:
        raise ValueError(f"lote excede {cfg.max_batch_samples} amostras")
    if machine.machine_uid and machine.machine_uid != batch.machine_uid:
        raise PermissionError("machine_uid não corresponde ao token")

    lo, hi = now - timedelta(days=cfg.raw_retention_days), now + timedelta(minutes=5)
    valid: dict[datetime, dict] = {}
    raw_procs: dict[datetime, object] = {}
    rejected = 0
    for s in batch.samples:
        if not (lo <= s.ts <= hi):
            rejected += 1
            errors.append(f"{s.ts.isoformat()}: fora da janela aceita")
            continue
        valid[s.ts] = _row(machine.id, s, now)  # duplicatas no mesmo lote: última vence
        raw_procs[s.ts] = s.extra.get("processes")

    dup = 0
    if valid:
        existing = set(
            aware_ts for (aware_ts,) in db.execute(
                select(Sample.ts).where(Sample.machine_id == machine.id, Sample.ts >= min(valid), Sample.ts <= max(valid))
            )
        )
        existing_naive = {e.replace(tzinfo=None) if e.tzinfo else e for e in existing}
        fresh = [r for t, r in valid.items() if t.replace(tzinfo=None) not in existing_naive]
        dup = len(valid) - len(fresh)
        if fresh:
            db.bulk_insert_mappings(Sample, fresh)
            procs = [p for r in fresh for p in _proc_rows(machine.id, r, raw_procs.get(r["ts"]))]
            if procs:
                db.bulk_insert_mappings(ProcessSample, procs)

    machine.last_seen = now
    machine.agent_version = batch.agent_version
    if not machine.machine_uid:
        machine.machine_uid = batch.machine_uid
    if batch.system:
        machine.system = {k: batch.system[k] for k in
                          ("hostname", "arch", "os", "kernel", "driver_version", "gpu_name", "python") if k in batch.system}
    if valid:
        newest = max(valid)
        cur = machine.last_sample_ts
        if cur is None or newest.replace(tzinfo=None) > cur.replace(tzinfo=None):
            machine.last_sample_ts = newest
    db.commit()
    return IngestResult(accepted=len(valid) - dup, duplicates=dup, rejected=rejected, errors=errors[:10])
