"""Identidade persistente da máquina, independente do hostname."""
from __future__ import annotations

import os
import uuid
from pathlib import Path


def machine_uid(state_dir: str, override: str = "") -> str:
    if override:
        return override
    candidates = [Path(state_dir), Path.home() / ".local/state/ceia-compute-observatory"]
    for d in candidates:
        f = d / "machine_id"
        try:
            if f.is_file():
                v = f.read_text().strip()
                if v:
                    return v
        except OSError:
            continue
    new = str(uuid.uuid4())
    for d in candidates:
        try:
            d.mkdir(parents=True, exist_ok=True)
            f = d / "machine_id"
            f.write_text(new + "\n")
            os.chmod(f, 0o644)
            return new
        except OSError:
            continue
    return new  # sem persistência possível; instável, mas não bloqueia a coleta
