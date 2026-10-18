"""Issue collaboration, always scoped through the existing read permission."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import Bookmark, Comment, User
from app.services.access import visible_item
from app.services.mutations import event
from app.services.summaries import summarize

router = APIRouter(prefix="/work-items", tags=["collaboration"])


class CommentInput(BaseModel):
    body: str = Field(min_length=1, max_length=10000)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Comment cannot be blank")
        return value


def comment_out(comment, name):
    return {
        "id": comment.id,
        "author_id": comment.author_id,
        "author_name": name,
        "body": comment.body,
        "created_at": comment.created_at,
    }


@router.get("/{item_id}/bookmark")
def bookmark_state(
    item_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    visible_item(db, item_id, user.id)
    return {"bookmarked": db.get(Bookmark, (user.id, item_id)) is not None}


@router.put("/{item_id}/bookmark")
def add_bookmark(
    item_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    visible_item(db, item_id, user.id)
    db.execute(
        insert(Bookmark)
        .values(user_id=user.id, work_item_id=item_id)
        .on_conflict_do_nothing()
    )
    db.commit()
    return {"bookmarked": True}


@router.delete("/{item_id}/bookmark", status_code=204)
def remove_bookmark(
    item_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    visible_item(db, item_id, user.id)
    db.execute(
        delete(Bookmark).where(
            Bookmark.user_id == user.id, Bookmark.work_item_id == item_id
        )
    )
    db.commit()
    return Response(status_code=204)


@router.get("/{item_id}/comments")
def list_comments(
    item_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    visible_item(db, item_id, user.id)
    total = db.scalar(
        select(func.count()).select_from(Comment).where(Comment.work_item_id == item_id)
    )
    rows = db.execute(
        select(Comment, User.full_name)
        .join(User, User.id == Comment.author_id)
        .where(Comment.work_item_id == item_id)
        .order_by(Comment.created_at.desc(), Comment.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [comment_out(c, name) for c, name in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/{item_id}/comments", status_code=201)
def add_comment(
    item_id: UUID,
    body: CommentInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    visible_item(db, item_id, user.id)
    comment = Comment(work_item_id=item_id, author_id=user.id, body=body.body)
    db.add(comment)
    db.flush()
    event(db, item_id, user.id, "COMMENTED", details={"comment_id": str(comment.id)})
    db.commit()
    return comment_out(comment, user.full_name)


@router.post("/{item_id}/summary")
def issue_summary(
    item_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    item = visible_item(db, item_id, user.id)
    comments = db.scalars(
        select(Comment)
        .where(Comment.work_item_id == item_id)
        .order_by(Comment.created_at.desc(), Comment.id)
        .limit(30)
    ).all()
    context = {
        "title": item.title,
        "status": item.status,
        "priority": item.priority,
        "description": item.description[:20000],
        "next_action": (item.next_action or "")[:4000],
        "recent_comments_newest_first": [c.body[:1000] for c in comments],
    }
    return {
        "summary": summarize(json.dumps(context)),
        "model": get_settings().groq_model,
        "min_words": 100,
        "max_words": 150,
        "context_note": "Based on issue details and up to 30 recent comments; long text may be shortened.",
    }
