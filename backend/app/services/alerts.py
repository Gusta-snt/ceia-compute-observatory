from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Alert, Machine, Sample
from .common import aware, get_group
from .status import refresh_status


def _recent(db: Session, mid: int, col, minutes: int, agg=func.avg):
    since = int((datetime.now(timezone.utc) - timedelta(minutes=minutes)).timestamp())
    return db.scalar(select(agg(col)).where(Sample.machine_id == mid, Sample.ts_epoch >= since))


def _set(db: Session, m: Machine, rule: str, triggered: bool | None, severity: str, msg: str, value: float | None, now: datetime):
    """triggered None = dado indisponível: mantém o estado atual (não resolve por falta de dados)."""
    if triggered is None:
        return
    open_a = db.scalar(select(Alert).where(Alert.machine_id == m.id, Alert.rule == rule, Alert.resolved_at.is_(None)))
    if triggered:
        if open_a:
            open_a.last_seen_at, open_a.value = now, value
            if open_a.severity != severity:
                open_a.severity, open_a.message = severity, msg
        else:
            db.add(Alert(machine_id=m.id, rule=rule, severity=severity, message=msg, value=value,
                         opened_at=now, last_seen_at=now))
    elif open_a:
        open_a.resolved_at = now


def evaluate_machine(db: Session, m: Machine, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    cfg = get_group(db, "alerts")
    status = refresh_status(db, m, now)
    label = m.name
    _set(db, m, "sem_comunicacao", status == "sem_comunicacao" if m.last_seen else None, "critical",
         f"{label}: sem comunicação do agente desde {aware(m.last_seen).strftime('%d/%m %H:%M UTC') if m.last_seen else '-'}.",
         None, now)
    _set(db, m, "agente_com_problema", status == "agente_com_problema", "warning",
         f"{label}: agente reporta falha de coleta.", None, now)
    if status == "sem_comunicacao":
        db.commit()
        return  # métricas desatualizadas não devem abrir/resolver alertas de recurso

    avail = _recent(db, m.id, Sample.mem_available_bytes, 5)
    total = _recent(db, m.id, Sample.mem_total_bytes, 5)
    if avail is not None and total:
        p = 100 * avail / total
        _set(db, m, "memoria_disponivel_baixa", p < cfg["mem_available_min_percent"], "critical",
             f"{label}: apenas {p:.1f}% da memória disponível (limite {cfg['mem_available_min_percent']:.0f}%).", p, now)
    psi = _recent(db, m.id, Sample.psi_memory_some_avg10, 5)
    if psi is not None:
        _set(db, m, "pressao_memoria", psi >= cfg["psi_memory_some_avg10"], "warning",
             f"{label}: pressão de memória (PSI some avg10) em {psi:.1f}%.", psi, now)
    disk = _recent(db, m.id, Sample.disk_percent, 10, func.max)
    if disk is not None:
        crit = disk >= cfg["disk_critical_percent"]
        _set(db, m, "armazenamento_cheio", disk >= cfg["disk_warning_percent"], "critical" if crit else "warning",
             f"{label}: armazenamento em {disk:.0f}%.", disk, now)
    temp = _recent(db, m.id, Sample.gpu_temp_c, 5, func.max)
    if temp is not None:
        _set(db, m, "temperatura_alta", temp >= cfg["gpu_temp_c"], "warning",
             f"{label}: temperatura da GPU em {temp:.0f} °C.", temp, now)
    power = _recent(db, m.id, Sample.gpu_power_w, 5)
    if power is not None:
        _set(db, m, "consumo_alto", power >= cfg["gpu_power_w"], "warning",
             f"{label}: consumo médio de {power:.0f} W.", power, now)
    mins = int(cfg["gpu_sustained_minutes"])
    n = _recent(db, m.id, Sample.gpu_util_percent, mins, func.count)
    # exige cobertura mínima da janela antes de afirmar utilização contínua
    if n and n * 15 >= mins * 60 * 0.6:
        g = _recent(db, m.id, Sample.gpu_util_percent, mins)
        _set(db, m, "gpu_utilizacao_continua", g >= cfg["gpu_sustained_percent"], "info",
             f"{label}: GPU com média de {g:.0f}% nos últimos {mins} min.", g, now)
    db.commit()


def evaluate_all(db: Session) -> None:
    for m in db.scalars(select(Machine).where(Machine.active.is_(True))).all():
        evaluate_machine(db, m)
