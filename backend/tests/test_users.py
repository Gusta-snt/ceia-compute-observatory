"""Usuários: papéis, permissões e invalidação de sessão."""
PW = "senha-de-teste-123"


def login(client, username, password):
    c = client.__class__(client.app)
    r = c.post("/api/v1/auth/login", json={"username": username, "password": password})
    return c, r


def test_me_returns_role(admin):
    r = admin.get("/api/v1/auth/me").json()
    assert r["username"] == "admin" and r["role"] == "admin"


def test_admin_creates_user_and_user_has_limited_access(client, admin):
    r = admin.post("/api/v1/users", json={"username": "Maria.Silva", "name": "Maria", "password": "outra-senha-123"})
    assert r.status_code == 201, r.text
    assert r.json()["username"] == "maria.silva" and r.json()["role"] == "usuario"
    assert admin.post("/api/v1/users", json={"username": "maria.silva", "password": "x" * 12}).status_code == 409
    assert admin.post("/api/v1/users", json={"username": "a b", "password": "x" * 12}).status_code == 422
    assert admin.post("/api/v1/users", json={"username": "curto", "password": "123"}).status_code == 422

    u, r = login(client, "MARIA.SILVA", "outra-senha-123")  # login sem diferenciar maiúsculas
    assert r.status_code == 200 and r.json()["role"] == "usuario"
    # pode usar a central
    assert u.get("/api/v1/overview").status_code == 200
    assert u.get("/api/v1/machines").status_code == 200
    assert u.get("/api/v1/projects").status_code == 200
    assert u.post("/api/v1/projects", json={"name": "P1"}).status_code == 201
    # não pode administrar
    assert u.get("/api/v1/users").status_code == 403
    assert u.post("/api/v1/users", json={"username": "x1", "password": "x" * 12}).status_code == 403
    assert u.post("/api/v1/machines", json={"name": "m"}).status_code == 403
    assert u.put("/api/v1/settings/branding", json={"name": "x"}).status_code == 403
    assert u.post("/api/v1/admin/evaluate-alerts").status_code == 403


def test_deactivate_and_reset_password_kill_sessions(client, admin):
    uid = admin.post("/api/v1/users", json={"username": "joao", "password": "senha-joao-123"}).json()["id"]
    u, _ = login(client, "joao", "senha-joao-123")
    assert u.get("/api/v1/auth/me").status_code == 200
    admin.post(f"/api/v1/users/{uid}/password", json={"password": "nova-senha-joao"})
    assert u.get("/api/v1/auth/me").status_code == 401  # sessão antiga encerrada
    assert login(client, "joao", "senha-joao-123")[1].status_code == 401
    u, r = login(client, "joao", "nova-senha-joao")
    assert r.status_code == 200
    admin.patch(f"/api/v1/users/{uid}", json={"active": False})
    assert u.get("/api/v1/auth/me").status_code == 401
    assert login(client, "joao", "nova-senha-joao")[1].status_code == 403
    assert admin.delete(f"/api/v1/users/{uid}").status_code == 200
    assert login(client, "joao", "nova-senha-joao")[1].status_code == 401


def test_own_password_change_keeps_current_session(client, admin):
    admin.post("/api/v1/users", json={"username": "ana", "password": "senha-ana-1234"})
    u1, _ = login(client, "ana", "senha-ana-1234")
    u2, _ = login(client, "ana", "senha-ana-1234")
    assert u1.post("/api/v1/auth/password", json={"current": "errada", "new": "senha-nova-ana"}).status_code == 403
    assert u1.post("/api/v1/auth/password", json={"current": "senha-ana-1234", "new": "senha-nova-ana"}).status_code == 200
    assert u1.get("/api/v1/auth/me").status_code == 200
    assert u2.get("/api/v1/auth/me").status_code == 401


def test_cannot_lock_out_last_admin(client, admin):
    me = admin.get("/api/v1/auth/me").json()["id"]
    assert admin.patch(f"/api/v1/users/{me}", json={"role": "usuario"}).status_code == 409
    assert admin.patch(f"/api/v1/users/{me}", json={"active": False}).status_code == 409
    assert admin.delete(f"/api/v1/users/{me}").status_code == 409
    # um segundo admin pode rebaixar o primeiro
    admin.post("/api/v1/users", json={"username": "admin2", "password": PW, "role": "admin"})
    a2, _ = login(client, "admin2", PW)
    assert a2.patch(f"/api/v1/users/{me}", json={"role": "usuario"}).status_code == 200
    assert admin.get("/api/v1/users").status_code == 403
