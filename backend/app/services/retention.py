from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Alert, METRIC_COLUMNS, ProcessSample, Rollup, Sample


def run_retention(db: Session, now: datetime | None = None) -> dict:
    """Agrega amostras brutas expiradas em rollups horários e só então as remove.

    O resultado fica registrado como evento (tabela alerts, severidade info, já resolvido).
    """
    cfg = get_settings()
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=cfg.raw_retention_days)
    cutoff_epoch = int(cutoff.timestamp()) // 3600 * 3600  # só horas completas
    cols = [getattr(Sample, c) for c in METRIC_COLUMNS]
    q = select(Sample.machine_id, Sample.ts_epoch, Sample.dur, *cols).where(Sample.ts_epoch < cutoff_epoch)
    acc: dict[tuple[int, int], dict] = defaultdict(lambda: {"n": 0, "dur": 0.0, "ws": defaultdict(float),
                                                            "wd": defaultdict(float), "mx": {}})
    total = 0
    for row in db.execute(q):
        mid, ep, dur, *vals = row
        a = acc[(mid, ep // 3600 * 3600)]
        a["n"] += 1
        a["dur"] += dur
        total += 1
        for name, v in zip(METRIC_COLUMNS, vals):
            if v is None:
                continue
            a["ws"][name] += v * dur
            a["wd"][name] += dur
            a["mx"][name] = v if name not in a["mx"] else max(a["mx"][name], v)
    # Processos não viram rollup: expiram junto com as amostras brutas.
    db.execute(delete(ProcessSample).where(ProcessSample.ts_epoch < cutoff_epoch))
    if not acc:
        db.commit()
        return {"rolled_up_samples": 0, "rollups": 0}
    for (mid, bucket), a in acc.items():
        avg = {k: a["ws"][k] / a["wd"][k] for k in a["ws"] if a["wd"][k] > 0}
        existing = db.get(Rollup, (mid, bucket))
        if existing:  # reexecução parcial: combina por soma ponderada simples
            existing.n_samples += a["n"]
            existing.covered_seconds += a["dur"]
            existing.avg = {**existing.avg, **avg}
            existing.max = {**existing.max, **a["mx"]}
        else:
            db.add(Rollup(machine_id=mid, bucket_epoch=bucket, n_samples=a["n"], covered_seconds=a["dur"],
                          avg=avg, max=a["mx"]))
    db.flush()
    db.execute(delete(Sample).where(Sample.ts_epoch < cutoff_epoch))
    db.add(Alert(machine_id=None, rule="retencao", severity="info", opened_at=now, resolved_at=now, last_seen_at=now,
                 message=f"Retenção: {total} amostras brutas anteriores a {cutoff.date()} foram agregadas em "
                         f"{len(acc)} rollups horários e removidas.", value=float(total)))
    db.commit()
    return {"rolled_up_samples": total, "rollups": len(acc)}
