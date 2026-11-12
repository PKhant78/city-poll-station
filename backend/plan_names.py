"""Account-scoped saved-plan name validation."""
from fastapi import HTTPException
from sqlalchemy import func, select
from database import Plan, User

DUPLICATE_PLAN_NAME = 'A plan with this name already exists. Choose a different name.'


def ensure_unique_plan_name(db, user_id, name, *, exclude_plan_id=None):
    """Serialize same-account saves and reject a conflicting plan name.

    The PostgreSQL row lock lasts until the caller commits or rolls back. This
    prevents two concurrent API saves from both passing the existence check,
    without requiring a migration of an already deployed database.
    """
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).scalar_one()
    statement = select(Plan.id).where(
        Plan.user_id == user_id,
        func.lower(func.trim(Plan.name)) == func.lower(name.strip()),
    )
    if exclude_plan_id is not None:
        statement = statement.where(Plan.id != exclude_plan_id)
    if db.scalar(statement.limit(1)) is not None:
        raise HTTPException(409, DUPLICATE_PLAN_NAME)
