"""Broadcast em processo para o dashboard (Server-Sent Events).

Cada ingestão publica um resumo da última amostra; todos os navegadores conectados
em /api/v1/stream recebem o evento. Funciona com uma réplica do backend (a mesma
restrição já existente da tarefa periódica).
"""
from __future__ import annotations

import asyncio
import json
from typing import Any


class Broadcaster:
    def __init__(self, max_queue: int = 100) -> None:
        self.max_queue = max_queue
        self.subscribers: set[asyncio.Queue[str]] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(self.max_queue)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self.subscribers.discard(q)

    def _deliver(self, msg: str) -> None:
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:  # cliente lento: descarta o evento, não bloqueia os outros
                pass

    def publish(self, event: str, data: dict[str, Any]) -> None:
        """Seguro para chamar de threads (rotas síncronas do FastAPI)."""
        if not self.loop or not self.subscribers:
            return
        msg = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
        self.loop.call_soon_threadsafe(self._deliver, msg)


broadcaster = Broadcaster()
