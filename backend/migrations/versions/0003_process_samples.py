"""ranking de processos (top CPU/GPU por amostra)

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "process_samples",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("machine_id", sa.Integer(), sa.ForeignKey("machines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ts_epoch", sa.BigInteger(), nullable=False),
        sa.Column("dur", sa.Float(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("username", sa.String(64)),
        sa.Column("cmd", sa.String(240)),
        sa.Column("cpu_percent", sa.Float()),
        sa.Column("mem_bytes", sa.Float()),
        sa.Column("gpu_util_percent", sa.Float()),
        sa.Column("gpu_mem_bytes", sa.Float()),
    )
    op.create_index("ix_process_samples_machine_epoch", "process_samples", ["machine_id", "ts_epoch"])


def downgrade() -> None:
    op.drop_index("ix_process_samples_machine_epoch", "process_samples")
    op.drop_table("process_samples")
