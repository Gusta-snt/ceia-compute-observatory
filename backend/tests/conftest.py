import os
import tempfile

import pytest

_dir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_dir}/test.db"
os.environ["ADMIN_PASSWORD"] = "senha-de-teste-123"
os.environ["BACKGROUND_TASKS"] = "false"
os.environ["SECRET_KEY"] = "test-secret"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from app import db as dbm
    from app.config import get_settings
    from app.models import Base
    from app.security import limiter
    limiter.hits.clear()
    get_settings.cache_clear()
    dbm.reset_engine()
    Base.metadata.drop_all(dbm.get_engine())
    from app.main import create_app
    with TestClient(create_app()) as c:
        yield c
        dbm.reset_engine()


@pytest.fixture()
def admin(client):
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "senha-de-teste-123"})
    assert r.status_code == 200
    return client
