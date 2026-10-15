from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from .api import router
from .broadcast import broadcaster
from .config import get_settings
from .db import SessionLocal, get_engine
from .models import Base, User
from .security import hash_password
from .services.alerts import evaluate_all
from .services.retention import run_retention

log = logging.getLogger("observatory")


def bootstrap_admin() -> None:
    s = get_settings()
    with SessionLocal() as db:
        if s.admin_password and not db.scalar(select(func.count()).select_from(User)):
            db.add(User(username=s.admin_username, password_hash=hash_password(s.admin_password)))
            db.commit()
            log.info("usuário administrador inicial criado: %s", s.admin_username)


async def _periodic() -> None:
    n = 0
    while True:
        await asyncio.sleep(30)
        try:
            def work() -> None:
                with SessionLocal() as db:
                    evaluate_all(db)
            await asyncio.to_thread(work)
            n += 1
            if n % 120 == 0:  # ~1 h
                def ret() -> None:
                    with SessionLocal() as db:
                        run_retention(db)
                await asyncio.to_thread(ret)
        except Exception:
            log.exception("falha na rotina periódica")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.database_url.startswith("sqlite"):
        Base.metadata.create_all(get_engine())  # SQLite: apenas desenvolvimento/testes; produção usa Alembic
    bootstrap_admin()
    broadcaster.bind(asyncio.get_running_loop())
    task = asyncio.create_task(_periodic()) if s.background_tasks else None
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="CEIA Compute Observatory", version="1.0.0", lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json")
    if s.cors_list:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_list, allow_credentials=True,
                           allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > s.max_body_bytes:
            return JSONResponse({"detail": "corpo da requisição grande demais"}, status_code=413)
        return await call_next(request)

    app.include_router(router)
    return app


app = create_app()
