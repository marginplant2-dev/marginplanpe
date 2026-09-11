"""DemoLead — a name + phone captured when a visitor starts a demo session.

Each admin runs their OWN universal demo account (see auth_service.
create_demo_session), and before a visitor is dropped into it they leave a
name + mobile. One row per (admin, mobile) — a repeat visitor with the same
number updates the existing row (login_count++) rather than duplicating, so
the admin's "Demo Accounts" list shows each lead once with how often they
came back.
"""

from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.models._base import TimestampMixin
from app.utils.time_utils import now_utc


class DemoLead(TimestampMixin):
    # Owning admin whose demo this visitor used. None = platform/super-admin
    # pool (the original shared demo).
    admin_id: PydanticObjectId | None = None
    name: str
    mobile: str

    login_count: int = 1
    last_login_at: datetime = Field(default_factory=now_utc)

    class Settings:
        name = "demo_leads"
        indexes = [
            # One lead per (admin, mobile) — the capture upsert dedups on this.
            IndexModel([("admin_id", ASCENDING), ("mobile", ASCENDING)], unique=True),
            IndexModel([("admin_id", ASCENDING), ("last_login_at", DESCENDING)]),
        ]
