"""Envio em lote com retry, backoff exponencial e jitter."""
from __future__ import annotations

import logging
import random
from typing import Any

import httpx

from . import AGENT_VERSION, SCHEMA_VERSION
from .buffer import Buffer

log = logging.getLogger("ceia_agent.sender")


def backoff_delay(attempt: int, base: float = 2.0, cap: float = 300.0, rnd: random.Random | None = None) -> float:
    exp = min(cap, base * (2 ** max(0, attempt - 1)))
    return (rnd or random).uniform(exp / 2, exp)  # jitter


class Sender:
    def __init__(self, url: str, token: str, machine_uid: str, buffer: Buffer, timeout: float = 10.0,
                 batch_size: int = 40, verify: bool = True, transport: httpx.BaseTransport | None = None) -> None:
        self.url = url.rstrip("/") + "/api/v1/ingest"
        self.machine_uid = machine_uid
        self.buffer = buffer
        self.batch_size = batch_size
        self.client = httpx.Client(timeout=timeout, verify=verify, transport=transport,
                                   headers={"Authorization": f"Bearer {token}", "User-Agent": f"ceia-agent/{AGENT_VERSION}"})
        self.failures = 0
        self.last_success_ts: str | None = None
        self.last_error: str | None = None
        self.system: dict[str, Any] = {}

    def flush_once(self) -> int:
        """Envia um lote. Retorna quantidade confirmada (0 se nada/ falha)."""
        batch = self.buffer.peek(self.batch_size)
        if not batch:
            return 0
        body = {"schema_version": SCHEMA_VERSION, "agent_version": AGENT_VERSION,
                "machine_uid": self.machine_uid, "system": self.system, "samples": batch}
        try:
            r = self.client.post(self.url, json=body)
        except httpx.HTTPError as e:
            return self._fail(f"rede: {e.__class__.__name__}: {e}")
        if r.status_code in (200, 202):
            self.buffer.ack([s["ts"] for s in batch])
            self.failures = 0
            self.last_error = None
            self.last_success_ts = batch[-1]["ts"]
            return len(batch)
        if r.status_code in (400, 413, 422):
            # lote rejeitado de forma permanente: descarta para não travar a fila, e registra.
            log.error("lote rejeitado (%s): %s", r.status_code, r.text[:300])
            self.buffer.ack([s["ts"] for s in batch])
            self.last_error = f"rejeitado {r.status_code}"
            return 0
        return self._fail(f"HTTP {r.status_code}: {r.text[:200]}")

    def _fail(self, msg: str) -> int:
        self.failures += 1
        self.last_error = msg
        log.warning("falha no envio (tentativa %d): %s", self.failures, msg)
        return 0
