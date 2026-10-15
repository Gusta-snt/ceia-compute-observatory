"""hypertable TimescaleDB (opcional)

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    has = bind.exec_driver_sql("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'").first()
    if not has:
        return  # PostgreSQL puro: a tabela segue funcionando com índices por (machine_id, ts_epoch)
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute("SELECT create_hypertable('samples', 'ts', chunk_time_interval => INTERVAL '7 days', "
               "migrate_data => true, if_not_exists => true)")


def downgrade() -> None:
    pass
