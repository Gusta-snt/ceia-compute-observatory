from __future__ import annotations

import asyncio
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .broadcast import broadcaster
from .config import get_settings
from .db import get_db
from .models import METRIC_COLUMNS, Alert, Allocation, AvailabilityEvent, Machine, ProcessSample, Project, Rollup, Sample, User
from .security import (COOKIE, current_admin, current_agent, hash_password, limiter, make_session,
                       new_agent_token, verify_password)
from .services import analytics as an
from .services.alerts import evaluate_all
from .services.common import DEFAULTS, aware, get_group, iso, set_group
from .services.ingest import BatchIn, IngestResult, ingest_batch
from .services.status import refresh_status

router = APIRouter(prefix="/api/v1")
Admin = Depends(current_admin)

RANGE_PRESETS = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720, "90d": 2160}


def parse_range(frm: str | None, to: str | None, preset: str = "24h") -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    try:
        if to:
            end = aware(datetime.fromisoformat(to.replace("Z", "+00:00")))
        start = aware(datetime.fromisoformat(frm.replace("Z", "+00:00"))) if frm else \
            end - timedelta(hours=RANGE_PRESETS.get(preset, 24))
    except ValueError:
        raise HTTPException(422, "datas inválidas (use ISO 8601)")
    if start >= end:
        raise HTTPException(422, "intervalo inválido")
    return start, end


def get_machine(db: Session, mid: int) -> Machine:
    m = db.get(Machine, mid)
    if not m:
        raise HTTPException(404, "máquina não encontrada")
    return m


# ------------------------------------------------------------------ público ----
@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(select(1))
    return {"status": "ok", "time": iso(datetime.now(timezone.utc))}


@router.get("/branding")
def branding(db: Session = Depends(get_db)) -> dict:
    return get_group(db, "branding")


# --------------------------------------------------------------------- auth ----
class Login(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


@router.post("/auth/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    ip = request.client.host if request.client else "?"
    if not limiter.check(f"login:{ip}", 10):
        raise HTTPException(429, "muitas tentativas; aguarde")
    u = db.scalar(select(User).where(User.username == body.username))
    if not u or not verify_password(u.password_hash, body.password):
        raise HTTPException(401, "credenciais inválidas")
    s = get_settings()
    response.set_cookie(COOKIE, make_session(u), httponly=True, samesite="lax", secure=s.cookie_secure,
                        max_age=s.session_hours * 3600)
    return {"username": u.username}


@router.post("/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/auth/me")
def me(u: User = Admin) -> dict:
    return {"username": u.username}


class PasswordChange(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=256)


@router.post("/auth/password")
def change_password(body: PasswordChange, u: User = Admin, db: Session = Depends(get_db)) -> dict:
    if not verify_password(u.password_hash, body.current):
        raise HTTPException(403, "senha atual incorreta")
    u.password_hash = hash_password(body.new)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------- ingest ----
@router.post("/ingest", response_model=IngestResult, status_code=202)
def ingest(batch: BatchIn, machine: Machine = Depends(current_agent), db: Session = Depends(get_db)):
    s = get_settings()
    if not limiter.check(f"ingest:{machine.id}", s.ingest_rate_per_minute):
        raise HTTPException(429, "limite de requisições excedido")
    try:
        res = ingest_batch(db, machine, batch)
    except PermissionError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    refresh_status(db, machine)
    if batch.samples:
        last = max(batch.samples, key=lambda x: x.ts)
        broadcaster.publish("sample", {"machine_id": machine.id, "ts": iso(last.ts), "values": last.values,
                                       "accepted": res.accepted})
    return res


@router.get("/stream")
async def stream(request: Request, _: User = Admin) -> StreamingResponse:
    """SSE: empurra cada ingestão para os dashboards abertos (substitui o polling curto)."""
    q = broadcaster.subscribe()

    async def gen():
        try:
            yield "retry: 5000\n\n"
            while not await request.is_disconnected():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # mantém a conexão viva atrás de proxies
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ----------------------------------------------------------------- máquinas ----
class MachineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hostname: str | None = None
    address: str | None = None
    hardware: str | None = None
    notes: str | None = None
    active: bool = True


class MachinePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    hostname: str | None = None
    address: str | None = None
    hardware: str | None = None
    notes: str | None = None
    active: bool | None = None


def machine_out(db: Session, m: Machine, live: bool = True) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": m.id, "name": m.name, "hostname": m.hostname, "address": m.address, "hardware": m.hardware,
        "notes": m.notes, "active": m.active, "status": m.status, "agent_version": m.agent_version,
        "system": m.system, "last_seen": iso(m.last_seen), "last_sample_ts": iso(m.last_sample_ts),
        "has_token": bool(m.token_hash) and not m.token_revoked, "machine_uid": m.machine_uid,
        "projects": [{"id": a.project.id, "name": a.project.name, "kind": a.kind}
                     for a in m.allocations if _alloc_active(a)],
    }
    if live:
        last = db.scalar(select(Sample).where(Sample.machine_id == m.id).order_by(Sample.ts.desc()).limit(1))
        d["latest"] = None if not last else {
            "ts": iso(last.ts), **{c: getattr(last, c) for c in METRIC_COLUMNS}, "quality": last.quality or {},
            "filesystems": (last.extra or {}).get("filesystems", []),
        }
    return d


def _alloc_active(a: Allocation) -> bool:
    now = datetime.now(timezone.utc)
    return (a.end_date is None or aware(a.end_date) >= now) and (a.start_date is None or aware(a.start_date) <= now)


@router.get("/machines")
def list_machines(include_inactive: bool = False, _: User = Admin, db: Session = Depends(get_db)) -> list[dict]:
    q = select(Machine).order_by(Machine.name)
    if not include_inactive:
        q = q.where(Machine.active.is_(True))
    return [machine_out(db, m) for m in db.scalars(q)]


@router.post("/machines", status_code=201)
def create_machine(body: MachineIn, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Machine.id).where(Machine.name == body.name)):
        raise HTTPException(409, "já existe uma máquina com esse nome")
    m = Machine(**body.model_dump())
    tok, h = new_agent_token()
    m.token_hash = h
    db.add(m)
    db.commit()
    return {**machine_out(db, m, live=False), "token": tok}  # token exibido uma única vez


@router.get("/machines/{mid}")
def get_one(mid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    return machine_out(db, get_machine(db, mid))


@router.patch("/machines/{mid}")
def patch_machine(mid: int, body: MachinePatch, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    m = get_machine(db, mid)
    if body.name is not None:
        body.name = body.name.strip()
        if not body.name:
            raise HTTPException(422, "nome não pode ser vazio")
        if db.scalar(select(Machine.id).where(Machine.name == body.name, Machine.id != m.id)):
            raise HTTPException(409, "já existe uma máquina com esse nome")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    return machine_out(db, m)


@router.delete("/machines/{mid}")
def delete_machine(mid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    """Remove a máquina e todo o seu histórico (amostras, agregados, alertas, alocações). Irreversível."""
    m = get_machine(db, mid)
    # Exclusão explícita: o SQLite (dev) não aplica ON DELETE CASCADE sem PRAGMA.
    for model in (Sample, ProcessSample, Rollup, AvailabilityEvent, Alert, Allocation):
        db.execute(delete(model).where(model.machine_id == m.id))
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.post("/machines/{mid}/token")
def rotate_token(mid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    m = get_machine(db, mid)
    tok, h = new_agent_token()
    m.token_hash, m.token_revoked = h, False
    db.commit()
    return {"token": tok}


@router.delete("/machines/{mid}/token")
def revoke_token(mid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    m = get_machine(db, mid)
    m.token_revoked = True
    db.commit()
    return {"ok": True}


@router.get("/machines/{mid}/metrics")
def machine_metrics(mid: int, metrics: str = "gpu_util_percent,unified_percent,cpu_percent", range: str = "24h",
                    frm: str | None = Query(None, alias="from"), to: str | None = None, bucket: int | None = None,
                    _: User = Admin, db: Session = Depends(get_db)) -> dict:
    get_machine(db, mid)
    names = [x for x in metrics.split(",") if x in METRIC_COLUMNS]
    if not names:
        raise HTTPException(422, "nenhuma métrica válida")
    s, e = parse_range(frm, to, range)
    return an.timeseries(db, mid, s, e, names, bucket)


@router.get("/machines/{mid}/summary")
def machine_summary(mid: int, range: str = "24h", frm: str | None = Query(None, alias="from"), to: str | None = None,
                    _: User = Admin, db: Session = Depends(get_db)) -> dict:
    m = get_machine(db, mid)
    s, e = parse_range(frm, to, range)
    return an.window_analysis(db, m, s, e)


@router.get("/machines/{mid}/processes")
def machine_processes(mid: int, range: str = "24h", frm: str | None = Query(None, alias="from"), to: str | None = None,
                      sort: str = "cpu", limit: int = Query(20, ge=1, le=100), _: User = Admin,
                      db: Session = Depends(get_db)) -> dict:
    """Ranking de processos (agrupados por nome + usuário) na janela.

    cpu_core_hours = Σ cpu%/100 × duração; gpu_pct_hours = Σ gpu%/100 × duração. Processos só entram
    quando estão no top N do agente, então valores baixos ficam subestimados (não superestimados).
    """
    get_machine(db, mid)
    b, e = parse_range(frm, to, range)
    P = ProcessSample
    sec = func.sum(P.dur)
    cpu_h = func.sum(func.coalesce(P.cpu_percent, 0) * P.dur) / 360000.0
    gpu_h = func.sum(func.coalesce(P.gpu_util_percent, 0) * P.dur) / 360000.0
    order = {"cpu": cpu_h, "gpu": gpu_h, "mem": func.max(P.mem_bytes), "gpu_mem": func.max(P.gpu_mem_bytes)}
    if sort not in order:
        raise HTTPException(422, "sort deve ser cpu, gpu, mem ou gpu_mem")
    q = (select(P.name, P.username, sec.label("seen"), cpu_h.label("cpu_h"), gpu_h.label("gpu_h"),
                func.avg(P.cpu_percent), func.max(P.cpu_percent), func.avg(P.gpu_util_percent), func.max(P.gpu_util_percent),
                func.max(P.mem_bytes), func.max(P.gpu_mem_bytes), func.max(P.ts_epoch), func.count(func.distinct(P.pid)),
                func.max(P.cmd))
         .where(P.machine_id == mid, P.ts_epoch >= int(b.timestamp()), P.ts_epoch < int(e.timestamp()))
         .group_by(P.name, P.username).order_by(order[sort].desc().nulls_last()).limit(limit))
    rows = []
    for i, r in enumerate(db.execute(q), 1):
        rows.append({"rank": i, "name": r[0], "user": r[1], "seen_seconds": r[2], "cpu_core_hours": r[3],
                     "gpu_pct_hours": r[4], "cpu_avg": r[5], "cpu_max": r[6], "gpu_avg": r[7], "gpu_max": r[8],
                     "mem_max_bytes": r[9], "gpu_mem_max_bytes": r[10],
                     "last_seen": iso(datetime.fromtimestamp(r[11], timezone.utc)), "pids": r[12], "cmd_example": r[13]})
    return {"from": iso(b), "to": iso(e), "sort": sort, "processes": rows}


@router.get("/machines/{mid}/availability")
def machine_availability(mid: int, range: str = "30d", _: User = Admin, db: Session = Depends(get_db)) -> list[dict]:
    get_machine(db, mid)
    s, _e = parse_range(None, None, range)
    evs = db.scalars(select(AvailabilityEvent).where(AvailabilityEvent.machine_id == mid)
                     .order_by(AvailabilityEvent.started_at.desc()).limit(500)).all()
    return [{"status": x.status, "started_at": iso(x.started_at), "ended_at": iso(x.ended_at)}
            for x in evs if (aware(x.ended_at) or datetime.now(timezone.utc)) >= s]


# ------------------------------------------------------------ infraestrutura ----
def _active(db: Session) -> list[Machine]:
    return list(db.scalars(select(Machine).where(Machine.active.is_(True)).order_by(Machine.name)))


@router.get("/overview")
def overview(window: str = "24h", _: User = Admin, db: Session = Depends(get_db)) -> dict:
    s, e = parse_range(None, None, window)
    machines = _active(db)
    cards = []
    for m in machines:
        refresh_status(db, m)
        a = an.window_analysis(db, m, s, e)
        d = machine_out(db, m)
        d["analysis"] = {"classification": a["classification"], "coverage": a["coverage"],
                         "gpu_mean": a["metrics"]["gpu_util_percent"].get("mean"),
                         "memory_mean": a["metrics"]["unified_percent"].get("mean"),
                         "cpu_mean": a["metrics"]["cpu_percent"].get("mean"),
                         "idle_fraction": a["idle_fraction"]}
        cards.append(d)

    def avg(key: str) -> float | None:
        v = [c["latest"][key] for c in cards
             if c["status"] == "online" and c.get("latest") and c["latest"].get(key) is not None]
        return round(sum(v) / len(v), 1) if v else None

    avail = [c["latest"]["unified_available_bytes"] for c in cards
             if c.get("latest") and c["latest"].get("unified_available_bytes") is not None]
    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.resolved_at.is_(None))) or 0
    return {
        "window": window,
        "totals": {
            "machines": len(cards),
            "online": sum(c["status"] == "online" for c in cards),
            "sem_comunicacao": sum(c["status"] == "sem_comunicacao" for c in cards),
            "agente_com_problema": sum(c["status"] == "agente_com_problema" for c in cards),
            "dados_insuficientes": sum(c["status"] == "dados_insuficientes" for c in cards),
            "gpu_avg_now": avg("gpu_util_percent"), "unified_avg_now": avg("unified_percent"),
            "unified_available_bytes": sum(avail) if avail else None,
            "underutilized": sum(c["analysis"]["classification"]["key"] == "subutilizada" for c in cards),
            "pressure": sum(c["analysis"]["classification"]["key"] == "pressao" for c in cards),
            "open_alerts": open_alerts,
        },
        "machines": cards,
    }


@router.get("/infrastructure/timeseries")
def infra_series(metric: str = "gpu_util_percent", range: str = "24h", frm: str | None = Query(None, alias="from"),
                 to: str | None = None, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    if metric not in METRIC_COLUMNS:
        raise HTTPException(422, "métrica inválida")
    s, e = parse_range(frm, to, range)
    out = {}
    for m in _active(db):
        out[str(m.id)] = {"name": m.name, **an.timeseries(db, m.id, s, e, [metric])}
    return {"metric": metric, "machines": out}


@router.get("/infrastructure/heatmap")
def infra_heatmap(metric: str = "gpu_util_percent", days: int = Query(14, ge=1, le=90), machine_id: int | None = None,
                  _: User = Admin, db: Session = Depends(get_db)) -> dict:
    if metric not in METRIC_COLUMNS:
        raise HTTPException(422, "métrica inválida")
    ids = [machine_id] if machine_id else [m.id for m in _active(db)]
    return an.heatmap(db, ids, metric, days)


# ------------------------------------------------------------------ análise ----
@router.get("/analysis/compare")
def compare(range: str = "7d", frm: str | None = Query(None, alias="from"), to: str | None = None,
            _: User = Admin, db: Session = Depends(get_db)) -> dict:
    s, e = parse_range(frm, to, range)
    return {"from": iso(s), "to": iso(e),
            "machines": [{"id": m.id, "name": m.name, "status": m.status, **an.window_analysis(db, m, s, e)}
                         for m in _active(db)]}


@router.get("/analysis/capacity")
def capacity(_: User = Admin, db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    rows = []
    for m in _active(db):
        wins = {}
        for key, hours in (("24h", 24), ("7d", 168), ("30d", 720)):
            a = an.window_analysis(db, m, now - timedelta(hours=hours), now)
            wins[key] = {"classification": a["classification"], "coverage": a["coverage"],
                         "gpu": a["metrics"]["gpu_util_percent"], "memory": a["metrics"]["unified_percent"],
                         "psi": a["metrics"]["psi_memory_some_avg10"], "cpu": a["metrics"]["cpu_percent"],
                         "idle_fraction": a["idle_fraction"], "capacity": a["capacity"],
                         "outages": a["outages"], "total_samples": a["total_samples"]}
        # janela principal: 7d se suficiente; senão 24h; senão a de 30d
        order = ["7d", "24h", "30d"]
        primary = next((k for k in order if wins[k]["classification"]["key"] != "insuficiente"), "7d")
        rows.append({"id": m.id, "name": m.name, "status": m.status, "primary_window": primary,
                     "result": wins[primary]["classification"], "windows": wins,
                     "projects": [{"name": a.project.name, "kind": a.kind} for a in m.allocations if _alloc_active(a)]})
    order_key = {"subutilizada": 0, "moderada": 1, "alta": 2, "pressao": 3, "insuficiente": 4}
    rows.sort(key=lambda r: (order_key[r["result"]["key"]],
                             r["windows"][r["primary_window"]]["gpu"].get("mean") or 999))
    return {"generated_at": iso(now), "machines": rows,
            "disclaimer": "Evidências para decisão administrativa; não garantem que uma máquina comportará um "
                          "treinamento ou inferência específicos. Avalie os requisitos de memória e processamento."}


@router.get("/analysis/report")
def report(range: str = "30d", frm: str | None = Query(None, alias="from"), to: str | None = None, format: str = "json",
           _: User = Admin, db: Session = Depends(get_db)):
    s, e = parse_range(frm, to, range)
    rows = []
    for m in _active(db):
        a = an.window_analysis(db, m, s, e)
        mt = a["metrics"]
        rows.append({
            "maquina": m.name, "classificacao": a["classification"]["label"], "confianca": a["classification"]["confidence"],
            "cobertura": a["coverage"], "amostras": a["total_samples"],
            "gpu_media": mt["gpu_util_percent"].get("mean"), "gpu_mediana": mt["gpu_util_percent"].get("median"),
            "gpu_p90": mt["gpu_util_percent"].get("p90"), "gpu_p95": mt["gpu_util_percent"].get("p95"),
            "gpu_max": mt["gpu_util_percent"].get("max"), "memoria_unificada_media": mt["unified_percent"].get("mean"),
            "memoria_unificada_p95": mt["unified_percent"].get("p95"), "cpu_media": mt["cpu_percent"].get("mean"),
            "ociosidade": a["idle_fraction"], "horas_ativas": a["active_hours"],
            "indisponibilidades": a["outages"]["count"], "indisponibilidade_horas": round(a["outages"]["total_seconds"] / 3600, 2),
            "justificativa": " ".join(a["classification"]["reasons"]),
        })
    if format == "csv":
        return _csv(rows, f"relatorio_{s.date()}_{e.date()}.csv")
    if format == "md":
        md = [f"# Relatório de utilização — {s.date()} a {e.date()}", ""]
        for r in rows:
            md += [f"## {r['maquina']} — {r['classificacao']} (confiança {r['confianca']})",
                   f"- Cobertura: {r['cobertura']:.0%}; amostras: {r['amostras']}",
                   f"- GPU: média {r['gpu_media']}%, P95 {r['gpu_p95']}%, máx {r['gpu_max']}%",
                   f"- Memória unificada: média {r['memoria_unificada_media']}%, P95 {r['memoria_unificada_p95']}%",
                   f"- Indisponibilidades: {r['indisponibilidades']} ({r['indisponibilidade_horas']} h)",
                   f"- Justificativa: {r['justificativa']}", ""]
        md.append("> Evidências para decisão administrativa; não garantem compatibilidade com um modelo específico.")
        return Response("\n".join(md), media_type="text/markdown; charset=utf-8")
    return {"from": iso(s), "to": iso(e), "rows": rows}


def _csv(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/export/samples")
def export_samples(machine_id: int, range: str = "24h", frm: str | None = Query(None, alias="from"),
                   to: str | None = None, format: str = "csv", limit: int = Query(200_000, le=1_000_000),
                   _: User = Admin, db: Session = Depends(get_db)):
    get_machine(db, machine_id)
    s, e = parse_range(frm, to, range)
    q = (select(Sample).where(Sample.machine_id == machine_id, Sample.ts_epoch >= int(s.timestamp()),
                              Sample.ts_epoch < int(e.timestamp())).order_by(Sample.ts).limit(limit))

    def rows():
        for r in db.scalars(q).yield_per(2000):
            yield {"ts": iso(r.ts), **{c: getattr(r, c) for c in METRIC_COLUMNS}}

    if format == "json":
        return StreamingResponse((json.dumps(r) + "\n" for r in rows()), media_type="application/x-ndjson")

    def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ts", *METRIC_COLUMNS])
        yield buf.getvalue()
        for r in rows():
            buf.seek(0), buf.truncate()
            w.writerow([r["ts"], *["" if r[c] is None else r[c] for c in METRIC_COLUMNS]])  # vazio = indisponível
            yield buf.getvalue()

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="samples_{machine_id}.csv"'})


# ----------------------------------------------------------------- projetos ----
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    owner: str | None = None
    researchers: int | None = Field(None, ge=0)
    priority: str = Field("media", pattern="^(baixa|media|alta)$")
    start_date: datetime | None = None
    end_date: datetime | None = None
    notes: str | None = None


class AllocIn(BaseModel):
    machine_id: int
    project_id: int
    kind: str = Field("principal", pattern="^(principal|compartilhada)$")
    start_date: datetime | None = None
    end_date: datetime | None = None
    notes: str | None = None


def _proj(p: Project) -> dict:
    return {"id": p.id, "name": p.name, "description": p.description, "owner": p.owner, "researchers": p.researchers,
            "priority": p.priority, "start_date": iso(p.start_date), "end_date": iso(p.end_date), "notes": p.notes,
            "machines": [{"allocation_id": a.id, "machine_id": a.machine_id, "machine": a.machine.name, "kind": a.kind}
                         for a in p.allocations if _alloc_active(a)]}


@router.get("/projects")
def list_projects(_: User = Admin, db: Session = Depends(get_db)) -> list[dict]:
    return [_proj(p) for p in db.scalars(select(Project).order_by(Project.name))]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Project.id).where(Project.name == body.name)):
        raise HTTPException(409, "projeto já existe")
    p = Project(**body.model_dump())
    db.add(p)
    db.commit()
    return _proj(p)


@router.put("/projects/{pid}")
def update_project(pid: int, body: ProjectIn, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "projeto não encontrado")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return _proj(p)


@router.delete("/projects/{pid}")
def delete_project(pid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "projeto não encontrado")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/allocations", status_code=201)
def create_alloc(body: AllocIn, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    get_machine(db, body.machine_id)
    if not db.get(Project, body.project_id):
        raise HTTPException(404, "projeto não encontrado")
    a = Allocation(**body.model_dump())
    db.add(a)
    db.commit()
    return {"id": a.id}


@router.delete("/allocations/{aid}")
def delete_alloc(aid: int, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    a = db.get(Allocation, aid)
    if not a:
        raise HTTPException(404, "associação não encontrada")
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.get("/allocations/overview")
def alloc_overview(_: User = Admin, db: Session = Depends(get_db)) -> list[dict]:
    out = []
    for m in _active(db):
        act = [a for a in m.allocations if _alloc_active(a)]
        out.append({"machine_id": m.id, "machine": m.name,
                    "projects": [{"allocation_id": a.id, "project_id": a.project_id, "name": a.project.name,
                                  "kind": a.kind, "priority": a.project.priority} for a in act],
                    "simultaneous": len(act) > 1})
    return out


# ------------------------------------------------------- alertas/configurações ----
@router.get("/alerts")
def list_alerts(status: str = "all", machine_id: int | None = None, severity: str | None = None,
                frm: str | None = Query(None, alias="from"), to: str | None = None,
                limit: int = Query(200, le=1000), offset: int = 0, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    q = select(Alert).order_by(Alert.opened_at.desc())
    if status == "open":
        q = q.where(Alert.resolved_at.is_(None))
    elif status == "resolved":
        q = q.where(Alert.resolved_at.isnot(None))
    if machine_id:
        q = q.where(Alert.machine_id == machine_id)
    if severity:
        q = q.where(Alert.severity == severity)
    if frm:
        q = q.where(Alert.opened_at >= parse_range(frm, None)[0])
    if to:
        q = q.where(Alert.opened_at <= parse_range("2000-01-01T00:00:00Z", to)[1])
    names = {m.id: m.name for m in db.scalars(select(Machine))}
    rows = db.scalars(q.limit(limit).offset(offset)).all()
    return {"items": [{"id": a.id, "machine_id": a.machine_id, "machine": names.get(a.machine_id), "rule": a.rule,
                       "severity": a.severity, "message": a.message, "value": a.value, "opened_at": iso(a.opened_at),
                       "resolved_at": iso(a.resolved_at), "last_seen_at": iso(a.last_seen_at)} for a in rows]}


@router.get("/settings")
def get_all_settings(_: User = Admin, db: Session = Depends(get_db)) -> dict:
    return {k: get_group(db, k) for k in DEFAULTS}


@router.put("/settings/{group}")
def put_settings(group: str, body: dict, _: User = Admin, db: Session = Depends(get_db)) -> dict:
    if group not in DEFAULTS:
        raise HTTPException(404, "grupo desconhecido")
    ref = DEFAULTS[group]
    for k, v in body.items():
        if k in ref and type(v) is not type(ref[k]) and not (isinstance(ref[k], float) and isinstance(v, int)):
            raise HTTPException(422, f"tipo inválido para {k}")
    return set_group(db, group, body)


@router.post("/admin/evaluate-alerts")
def force_eval(_: User = Admin, db: Session = Depends(get_db)) -> dict:
    evaluate_all(db)
    return {"ok": True}
