from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AvailabilityEvent, Machine, Sample
from .common import aware, get_group

STATUSES = ("online", "sem_comunicacao", "agente_com_problema", "dados_insuficientes")


def compute_status(db: Session, m: Machine, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    cfg = get_group(db, "status")
    seen = aware(m.last_seen)
    if seen is None or m.last_sample_ts is None:
        return "dados_insuficientes"
    if (now - seen).total_seconds() > cfg["offline_after_seconds"]:
        return "sem_comunicacao"
    last = db.scalar(select(Sample).where(Sample.machine_id == m.id).order_by(Sample.ts.desc()).limit(1))
    if last and last.quality and any(last.quality.get(k) == "error" for k in ("cpu_percent", "mem_percent")):
        return "agente_com_problema"
    n = db.scalar(select(func.count()).select_from(
        select(Sample.ts).where(Sample.machine_id == m.id).limit(cfg["min_samples"]).subquery()))
    if (n or 0) < cfg["min_samples"]:
        return "dados_insuficientes"
    return "online"


def refresh_status(db: Session, m: Machine, now: datetime | None = None) -> str:
    """Recalcula o estado e registra a transição no histórico de disponibilidade."""
    now = now or datetime.now(timezone.utc)
    new = compute_status(db, m, now)
    if new != m.status or db.scalar(select(AvailabilityEvent.id).where(AvailabilityEvent.machine_id == m.id).limit(1)) is None:
        open_ev = db.scalar(select(AvailabilityEvent).where(
            AvailabilityEvent.machine_id == m.id, AvailabilityEvent.ended_at.is_(None)))
        if open_ev:
            open_ev.ended_at = now
        db.add(AvailabilityEvent(machine_id=m.id, status=new, started_at=now))
        m.status = new
        db.commit()
    return new
