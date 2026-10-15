from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSONType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# Métricas escalares com coluna própria (NULL = indisponível, nunca zero).
METRIC_COLUMNS = [
    "cpu_percent", "cpu_cores", "load_1", "load_5", "load_15",
    "mem_percent", "mem_total_bytes", "mem_used_bytes", "mem_available_bytes", "swap_used_bytes",
    "psi_memory_some_avg10", "psi_memory_full_avg10", "psi_cpu_some_avg10", "psi_io_some_avg10",
    "gpu_util_percent", "gpu_temp_c", "gpu_power_w", "gpu_clock_sm_mhz",
    "unified_percent", "unified_used_bytes", "unified_total_bytes", "unified_available_bytes",
    "disk_percent", "disk_free_bytes", "disk_total_bytes", "disk_read_bps", "disk_write_bps",
    "net_rx_bps", "net_tx_bps", "net_errors_total", "uptime_seconds",
]


class Machine(Base):
    __tablename__ = "machines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    hostname: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(255))
    hardware: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    machine_uid: Mapped[str | None] = mapped_column(String(64), unique=True)
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    token_revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_version: Mapped[str | None] = mapped_column(String(32))
    system: Mapped[dict | None] = mapped_column(JSONType)
    status: Mapped[str] = mapped_column(String(32), default="dados_insuficientes")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sample_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    allocations: Mapped[list["Allocation"]] = relationship(back_populates="machine", cascade="all, delete-orphan")


class Sample(Base):
    __tablename__ = "samples"
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    ts_epoch: Mapped[int] = mapped_column(BigInteger)
    dur: Mapped[float] = mapped_column(Float, default=15.0)  # segundos representados pela amostra
    quality: Mapped[dict | None] = mapped_column(JSONType)
    extra: Mapped[dict | None] = mapped_column(JSONType)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    for _c in METRIC_COLUMNS:
        locals()[_c] = mapped_column(Float, nullable=True)
    del _c
    __table_args__ = (Index("ix_samples_machine_epoch", "machine_id", "ts_epoch"),)


class ProcessSample(Base):
    """Top processos (CPU/GPU) de cada amostra. cpu_percent é relativo a um núcleo."""
    __tablename__ = "process_samples"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"))
    ts_epoch: Mapped[int] = mapped_column(BigInteger)
    dur: Mapped[float] = mapped_column(Float, default=15.0)
    pid: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128))
    username: Mapped[str | None] = mapped_column(String(64))
    cmd: Mapped[str | None] = mapped_column(String(240))
    cpu_percent: Mapped[float | None] = mapped_column(Float)
    mem_bytes: Mapped[float | None] = mapped_column(Float)
    gpu_util_percent: Mapped[float | None] = mapped_column(Float)
    gpu_mem_bytes: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (Index("ix_process_samples_machine_epoch", "machine_id", "ts_epoch"),)


class Rollup(Base):
    """Agregado horário preservado após a expiração das amostras brutas."""
    __tablename__ = "rollups_hourly"
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), primary_key=True)
    bucket_epoch: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    n_samples: Mapped[int] = mapped_column(Integer)
    covered_seconds: Mapped[float] = mapped_column(Float)
    avg: Mapped[dict] = mapped_column(JSONType)
    max: Mapped[dict] = mapped_column(JSONType)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(160))
    researchers: Mapped[int | None] = mapped_column(Integer)
    priority: Mapped[str] = mapped_column(String(16), default="media")
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    allocations: Mapped[list["Allocation"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Allocation(Base):
    __tablename__ = "allocations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="principal")  # principal | compartilhada
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    machine: Mapped[Machine] = relationship(back_populates="allocations")
    project: Mapped[Project] = relationship(back_populates="allocations")


class AvailabilityEvent(Base):
    """Transições de estado do agente (histórico de disponibilidade)."""
    __tablename__ = "availability_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int | None] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    rule: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(Text)
    value: Mapped[float | None] = mapped_column(Float)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONType)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
