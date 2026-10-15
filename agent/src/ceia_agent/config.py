"""Configuração do agente, lida de variáveis de ambiente (arquivo agent.env)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


def _load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if v[:1] in "\"'" and v and v.count(v[0]) >= 2:
            v = v[1:v.index(v[0], 1)]
        else:
            v = re.split(r"\s+#", v, maxsplit=1)[0].strip()  # tolera comentário no fim da linha
        out[k.strip()] = v
    return out


@dataclass
class Config:
    central_api_url: str = ""
    agent_token: str = ""
    machine_id: str = ""
    interval: float = 15.0
    batch_size: int = 40
    http_timeout: float = 10.0
    buffer_path: str = "/var/lib/ceia-compute-observatory/buffer.db"
    buffer_max_samples: int = 200_000  # ~34 dias a 15 s
    buffer_drop_policy: str = "oldest"  # oldest | newest
    state_dir: str = "/var/lib/ceia-compute-observatory"
    log_file: str = ""
    log_level: str = "INFO"
    health_port: int = 9477
    health_bind: str = "127.0.0.1"
    collect_processes: bool = True
    process_top_n: int = 10
    process_cmdline: bool = True
    verify_tls: bool = True
    extra: dict = field(default_factory=dict)

    @classmethod
    def load(cls, env_file: str | None = None) -> "Config":
        env: dict[str, str] = {}
        path = Path(env_file or os.environ.get("CEIA_AGENT_ENV", "/etc/ceia-compute-observatory/agent.env"))
        env.update(_load_env_file(path))
        env.update({k: v for k, v in os.environ.items() if k.isupper()})
        g = env.get
        b = lambda k, d: g(k, str(d)).lower() in ("1", "true", "yes", "on")  # noqa: E731
        return cls(
            central_api_url=g("CENTRAL_API_URL", "").rstrip("/"),
            agent_token=g("AGENT_TOKEN", ""),
            machine_id=g("MACHINE_ID", ""),
            interval=float(g("COLLECTION_INTERVAL_SECONDS", "15")),
            batch_size=int(g("BATCH_SIZE", "40")),
            http_timeout=float(g("HTTP_TIMEOUT_SECONDS", "10")),
            buffer_path=g("BUFFER_PATH", "/var/lib/ceia-compute-observatory/buffer.db"),
            buffer_max_samples=int(g("BUFFER_MAX_SAMPLES", "200000")),
            buffer_drop_policy=g("BUFFER_DROP_POLICY", "oldest"),
            state_dir=g("STATE_DIR", "/var/lib/ceia-compute-observatory"),
            log_file=g("LOG_FILE", ""),
            log_level=g("LOG_LEVEL", "INFO").upper(),
            health_port=int(g("HEALTH_PORT", "9477")),
            health_bind=g("HEALTH_BIND", "127.0.0.1"),
            collect_processes=b("COLLECT_PROCESSES", True),
            process_top_n=int(g("PROCESS_TOP_N", "10")),
            process_cmdline=b("PROCESS_CMDLINE", True),
            verify_tls=b("VERIFY_TLS", True),
        )

    def validate(self) -> list[str]:
        errs = []
        if not self.central_api_url.startswith(("http://", "https://")):
            errs.append("CENTRAL_API_URL ausente ou inválida")
        if not self.agent_token:
            errs.append("AGENT_TOKEN ausente")
        if self.interval < 1:
            errs.append("COLLECTION_INTERVAL_SECONDS deve ser >= 1")
        if self.buffer_drop_policy not in ("oldest", "newest"):
            errs.append("BUFFER_DROP_POLICY deve ser oldest ou newest")
        return errs
