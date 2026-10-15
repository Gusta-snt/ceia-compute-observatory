from __future__ import annotations

import hashlib
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Machine, User

_ph = PasswordHasher()
COOKIE = "ceia_session"
TOKEN_PREFIX = "ceia_agt_"


def hash_password(p: str) -> str:
    return _ph.hash(p)


def verify_password(h: str, p: str) -> bool:
    try:
        return _ph.verify(h, p)
    except (VerifyMismatchError, Exception):
        return False


def new_agent_token() -> tuple[str, str]:
    tok = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return tok, hash_token(tok)


def hash_token(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def make_session(user: User) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(hours=s.session_hours)
    return jwt.encode({"sub": str(user.id), "usr": user.username, "typ": "admin", "exp": exp}, s.secret_key, "HS256")


def current_admin(request: Request, db: Session = Depends(get_db), ceia_session: str | None = Cookie(None)) -> User:
    """Apenas sessões de administrador. Tokens de agente nunca passam por aqui."""
    s = get_settings()
    if not ceia_session:
        raise HTTPException(401, "não autenticado")
    try:
        data = jwt.decode(ceia_session, s.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "sessão inválida ou expirada")
    if data.get("typ") != "admin":
        raise HTTPException(401, "sessão inválida")
    user = db.get(User, int(data["sub"]))
    if not user:
        raise HTTPException(401, "usuário inexistente")
    return user


def current_agent(authorization: str | None = Header(None), db: Session = Depends(get_db)) -> Machine:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "token ausente")
    tok = authorization[7:].strip()
    if not tok.startswith(TOKEN_PREFIX):
        raise HTTPException(401, "token inválido")
    m = db.scalar(select(Machine).where(Machine.token_hash == hash_token(tok)))
    if not m or m.token_revoked:
        raise HTTPException(401, "token inválido ou revogado")
    if not m.active:
        raise HTTPException(403, "máquina desativada")
    return m


class RateLimiter:
    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


limiter = RateLimiter()
