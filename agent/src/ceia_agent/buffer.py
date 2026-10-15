"""Buffer persistente em SQLite para amostras pendentes de envio."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path


class Buffer:
    def __init__(self, path: str, max_samples: int = 200_000, drop_policy: str = "oldest") -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._lock = threading.Lock()
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("CREATE TABLE IF NOT EXISTS pending (ts TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        self.max_samples = max_samples
        self.drop_policy = drop_policy
        self.dropped = 0

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM pending").fetchone()[0]

    def add(self, sample: dict) -> bool:
        """Insere a amostra. Retorna False se descartada pela política de limite."""
        with self._lock:
            if self._db.execute("SELECT 1 FROM pending WHERE ts = ?", (sample["ts"],)).fetchone():
                return True  # duplicata: substitui sem evicção
            n = self._db.execute("SELECT COUNT(*) FROM pending").fetchone()[0]
            if n >= self.max_samples:
                if self.drop_policy == "newest":
                    self.dropped += 1
                    return False
                self._db.execute(
                    "DELETE FROM pending WHERE ts IN (SELECT ts FROM pending ORDER BY ts LIMIT ?)",
                    (n - self.max_samples + 1,),
                )
                self.dropped += n - self.max_samples + 1
            self._db.execute(
                "INSERT OR REPLACE INTO pending(ts, payload) VALUES (?, ?)",
                (sample["ts"], json.dumps(sample, separators=(",", ":"))),
            )
            return True

    def peek(self, limit: int) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT payload FROM pending ORDER BY ts LIMIT ?", (limit,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def ack(self, timestamps: list[str]) -> None:
        with self._lock:
            self._db.executemany("DELETE FROM pending WHERE ts = ?", [(t,) for t in timestamps])

    def close(self) -> None:
        self._db.close()
