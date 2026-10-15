"""Gera dados DEMONSTRATIVOS (máquinas 'DEMO-*') e ativa o selo de modo demonstração.

Uso (a partir de backend/):  DATABASE_URL=sqlite:///demo.db python ../scripts/seed_demo.py
NÃO execute contra o banco de produção.
"""
import math
import random
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")
from app.db import SessionLocal, get_engine  # noqa: E402
from app.models import Base, Machine, Sample  # noqa: E402
from app.services.common import set_group  # noqa: E402

Base.metadata.create_all(get_engine())
random.seed(7)
now = datetime.now(timezone.utc).replace(microsecond=0)
profiles = [("DEMO-01", 8, 35), ("DEMO-02", 55, 70), ("DEMO-03", 85, 92), ("DEMO-04", 3, 20), ("DEMO-05", 25, 97), ("DEMO-06", 40, 55)]
with SessionLocal() as db:
    for name, gpu_base, mem_base in profiles:
        m = Machine(name=name, hostname=name.lower(), status="online", last_seen=now, last_sample_ts=now,
                    machine_uid=f"demo-{name}", system={"gpu_name": "NVIDIA GB10 (demo)"})
        db.add(m); db.flush()
        rows = []
        for i in range(0, 7 * 86400, 60):
            t = now - timedelta(seconds=7 * 86400 - i)
            if 40000 < (i % 86400) < 46000 and name == "DEMO-04":
                continue  # lacuna
            hour = (t.hour - 3) % 24
            day = 1.0 if 8 <= hour <= 20 else 0.4
            g = max(0, min(100, gpu_base * day + random.gauss(0, 5)))
            u = max(0, min(100, mem_base + random.gauss(0, 2)))
            rows.append(dict(machine_id=m.id, ts=t, ts_epoch=int(t.timestamp()), dur=60.0, gpu_util_percent=g,
                             unified_percent=u, mem_percent=u, cpu_percent=max(0, g * 0.4 + random.gauss(0, 3)),
                             unified_total_bytes=128 * 1024**3, unified_available_bytes=128 * 1024**3 * (1 - u / 100),
                             mem_total_bytes=128 * 1024**3, mem_available_bytes=128 * 1024**3 * (1 - u / 100),
                             disk_percent=45.0, disk_free_bytes=2.2e12, disk_total_bytes=4e12,
                             psi_memory_some_avg10=max(0, (u - 85) / 3), gpu_temp_c=45 + g * 0.3, gpu_power_w=20 + g))
        db.bulk_insert_mappings(Sample, rows)
    set_group(db, "branding", {"demo_mode": True})
print("Dados de demonstração criados. Remova o banco para voltar ao estado real.")
