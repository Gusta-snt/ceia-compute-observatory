"""usuários com papel (admin/usuario), desativação e versão de sessão

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("name", sa.String(120)))
        b.add_column(sa.Column("role", sa.String(16), nullable=False, server_default="usuario"))
        b.add_column(sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
        b.add_column(sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("last_login", sa.DateTime(timezone=True)))
    # quem já existia era administrador (antes só havia o admin)
    op.execute("UPDATE users SET role = 'admin'")


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        for c in ("last_login", "session_version", "active", "role", "name"):
            b.drop_column(c)
