"""BlockedIP — an IP address an admin has banned from their pool.

Each admin keeps their OWN blocklist (``admin_id``). ``admin_id=None`` is the
super-admin / platform pool. When a user in that admin's pool tries to log in
(or acts on a live session) from a blocked IP, they're rejected — mirrors the
per-admin ``maintenance_mode`` gate, but keyed on the request IP instead of a
pool-wide switch. Enforced in the user auth dependency + login endpoint; the
super-admin grants an admin the ``ip_blocking`` permission to use it at all.

One row per (admin_id, ip) — adding the same IP twice just refreshes the note.
"""

from __future__ import annotations

from beanie import PydanticObjectId
from pymongo import ASCENDING, IndexModel

from app.models._base import TimestampMixin


class BlockedIP(TimestampMixin):
    # Owning admin whose pool this ban applies to. None = platform/super-admin
    # pool (users with assigned_admin_id is None).
    admin_id: PydanticObjectId | None = None
    ip: str
    reason: str | None = None
    # Who added it — for the super-admin "kaha kaha blocked hai" master list.
    created_by: PydanticObjectId | None = None
    created_by_name: str | None = None

    class Settings:
        name = "blocked_ips"
        indexes = [
            # The auth hot-path lookup + the add() dedup both key on this.
            IndexModel([("admin_id", ASCENDING), ("ip", ASCENDING)], unique=True),
        ]
