"""Private bookmarks and shared issue comments."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0002_issue_collaboration"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "bookmarks",
        sa.Column(
            "user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True
        ),
        sa.Column(
            "work_item_id",
            UUID(as_uuid=True),
            sa.ForeignKey("work_items.id"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "work_item_id",
            UUID(as_uuid=True),
            sa.ForeignKey("work_items.id"),
            nullable=False,
        ),
        sa.Column(
            "author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_comments_work_item_id", "comments", ["work_item_id"])


def downgrade():
    op.drop_table("comments")
    op.drop_table("bookmarks")
