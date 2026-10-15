"""Loop principal do agente: coleta (relógio monotônico), buffer e envio."""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import signal
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import AGENT_VERSION
from .buffer import Buffer
from .config import Config
from .identity import machine_uid
from .metrics import GpuCollector, ProcessCollector, Sample, SystemCollector, static_info
from .sender import Sender, backoff_delay

log = logging.getLogger("ceia_agent")


def setup_logging(cfg: Config) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if cfg.log_file:
        handlers.append(logging.handlers.RotatingFileHandler(cfg.log_file, maxBytes=5_000_000, backupCount=5))
    logging.basicConfig(level=cfg.log_level, handlers=handlers,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # evita URLs/headers em logs


class Agent:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.uid = machine_uid(cfg.state_dir, cfg.machine_id)
        self.buffer = Buffer(cfg.buffer_path, cfg.buffer_max_samples, cfg.buffer_drop_policy)
        self.sender = Sender(cfg.central_api_url, cfg.agent_token, self.uid, self.buffer,
                             cfg.http_timeout, cfg.batch_size, cfg.verify_tls)
        self.sys_collector = SystemCollector()
        self.gpu_collector = GpuCollector()
        self.proc_collector = (ProcessCollector(cfg.process_top_n, cfg.process_cmdline, self.gpu_collector._nvml)
                               if cfg.collect_processes else None)
        self.stop = threading.Event()
        self.last_collect: str | None = None
        self.collect_errors = 0
        self._last_ts = ""

    def _next_ts(self) -> str:
        """Timestamp UTC em ms, estritamente crescente (mesmo se o relógio recuar)."""
        fmt = "%Y-%m-%dT%H:%M:%S.%f"
        now = datetime.now(timezone.utc)
        now = now.replace(microsecond=now.microsecond // 1000 * 1000)
        if self._last_ts:
            last = datetime.strptime(self._last_ts[:-1], fmt).replace(tzinfo=timezone.utc)
            if now <= last:
                now = last + timedelta(milliseconds=1)
        ts = now.strftime(fmt)[:-3] + "Z"
        self._last_ts = ts
        return ts

    def collect_sample(self) -> dict:
        s = Sample()
        self.sys_collector.collect(s)
        self.gpu_collector.collect(s)
        if self.proc_collector:
            self.proc_collector.collect(s)
        ts = self._next_ts()
        self.sender.system = static_info(s.extra.get("driver_version"), s.extra.get("gpu_name"))
        return {"ts": ts, "interval_s": self.cfg.interval, "values": s.values, "quality": s.quality,
                "sources": s.sources, "extra": {k: v for k, v in s.extra.items()
                                                 if k in ("filesystems", "cpu_per_core", "unified_memory", "processes")}}

    def collect_loop(self) -> None:
        next_t = time.monotonic()
        while not self.stop.is_set():
            try:
                self.buffer.add(self.collect_sample())
                self.last_collect = datetime.now(timezone.utc).isoformat()
            except Exception:
                self.collect_errors += 1
                log.exception("erro na coleta")
            next_t += self.cfg.interval
            self.stop.wait(max(0.0, next_t - time.monotonic()))
            if next_t < time.monotonic() - self.cfg.interval:  # atrasado (suspensão): ressincroniza
                next_t = time.monotonic()

    def send_loop(self) -> None:
        while not self.stop.is_set():
            sent = self.sender.flush_once()
            if sent and self.buffer.count() > 0:
                continue  # drena backlog sem esperar
            if self.sender.failures:
                self.stop.wait(backoff_delay(self.sender.failures))
            else:
                self.stop.wait(min(5.0, self.cfg.interval))

    def health(self) -> dict:
        return {"status": "ok" if not self.sender.failures else "degraded", "agent_version": AGENT_VERSION,
                "machine_uid": self.uid, "last_collect": self.last_collect,
                "last_sent_sample": self.sender.last_success_ts, "pending_samples": self.buffer.count(),
                "dropped_samples": self.buffer.dropped, "send_failures": self.sender.failures,
                "last_error": self.sender.last_error, "collect_errors": self.collect_errors}

    def serve_health(self) -> ThreadingHTTPServer:
        agent = self

        class H(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                body = json.dumps(agent.health()).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):  # silencioso
                pass

        srv = ThreadingHTTPServer((self.cfg.health_bind, self.cfg.health_port), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv

    def run(self) -> None:
        log.info("agente %s iniciado: machine_uid=%s intervalo=%ss destino=%s",
                 AGENT_VERSION, self.uid, self.cfg.interval, self.cfg.central_api_url)
        try:
            self.serve_health()
        except OSError as e:
            log.warning("health check indisponível: %s", e)
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())
        t = threading.Thread(target=self.send_loop, daemon=True)
        t.start()
        self.collect_loop()
        t.join(timeout=5)
        self.buffer.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ceia-agent")
    ap.add_argument("--env-file")
    ap.add_argument("--once", action="store_true", help="coleta uma amostra e imprime (diagnóstico)")
    ap.add_argument("--check", action="store_true", help="valida a configuração e sai")
    a = ap.parse_args(argv)
    cfg = Config.load(a.env_file)
    if a.once:
        s = Sample()
        sc = SystemCollector()
        sc.collect(s)
        time.sleep(1)
        s = Sample()
        sc.collect(s)
        GpuCollector().collect(s)
        print(json.dumps({"values": s.values, "quality": s.quality, "sources": s.sources}, indent=2))
        return 0
    errs = cfg.validate()
    if errs:
        print("Configuração inválida:\n - " + "\n - ".join(errs), file=sys.stderr)
        return 2
    if a.check:
        print("configuração OK")
        return 0
    setup_logging(cfg)
    Agent(cfg).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
