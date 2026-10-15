#!/usr/bin/env python3
"""Receptor mínimo para validar o agente SEM a plataforma central.

Aceita POST /api/v1/ingest, valida Authorization e imprime um resumo de cada lote.
Uso: python3 fake-central.py [porta] [--fail-first N]   (padrão: 8000)
  --fail-first N  responde 503 às N primeiras requisições (testa retry/buffer)
Não persiste nada; é só para diagnóstico.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8000
fail = int(sys.argv[sys.argv.index("--fail-first") + 1]) if "--fail-first" in sys.argv else 0
state = {"n": 0, "samples": 0}
sys.stdout.reconfigure(line_buffering=True)


class H(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        state["n"] += 1
        if state["n"] <= fail:
            print(f"[req {state['n']}] respondendo 503 de propósito")
            self.send_response(503); self.end_headers(); return
        if not self.headers.get("Authorization", "").startswith("Bearer "):
            self.send_response(401); self.end_headers(); return
        d = json.loads(body)
        state["samples"] += len(d["samples"])
        s = d["samples"][-1]
        v, q = s["values"], s["quality"]
        print(f"[req {state['n']}] {len(d['samples'])} amostras (total {state['samples']}) "
              f"uid={d['machine_uid'][:8]}… agente={d['agent_version']} ts={s['ts']}")
        print(f"   gpu_util={v.get('gpu_util_percent')} ({q.get('gpu_util_percent')})  "
              f"unified%={v.get('unified_percent')}  psi_mem={v.get('psi_memory_some_avg10')} ({q.get('psi_memory_some_avg10')})  "
              f"temp={v.get('gpu_temp_c')}  power={v.get('gpu_power_w')}")
        out = json.dumps({"accepted": len(d["samples"]), "duplicates": 0, "rejected": 0, "errors": []}).encode()
        self.send_response(202); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a):
        pass


print(f"fake-central em 0.0.0.0:{port} (Ctrl+C para sair)")
HTTPServer(("0.0.0.0", port), H).serve_forever()
