"""IP-blocking — per-admin blocklist of IPs banned from that admin's pool.

The super-admin grants an admin the ``ip_blocking`` permission; that admin then
adds IPs here. A user in the admin's pool logging in (or acting) from a blocked
IP is rejected. Resolution mirrors ``user_service.is_under_admin_maintenance``:
the ban that applies to a user is the one on the user's OWNING admin
(``assigned_admin_id``; None ⇒ super-admin/platform pool).
"""

from __future__ import annotations

from beanie import PydanticObjectId

from app.models.blocked_ip import BlockedIP
from app.models.user import User, UserRole


def normalize_ip(ip: str) -> str:
    """Trim + lowercase. Keeps it forgiving — we store whatever the request
    reports as the client IP and match it verbatim, so both sides normalize
    the same way. (IPv6 hex is case-insensitive; lowercasing makes it match.)"""
    return (ip or "").strip().lower()


async def is_ip_blocked_for_user(user: User, ip: str) -> bool:
    """True when the user's owning admin has banned this request IP.

    Admin-tier accounts are NEVER IP-blocked (an admin banning an IP must not
    lock themselves — or another admin — out). A user with no owning admin is
    checked against the platform (admin_id=None) list.

    ponytail: one indexed find_one per authenticated user request — same order
    as the maintenance gate already on this path. Add a short Redis cache keyed
    by admin_id only if profiling shows the auth hot-path needs it.
    """
    if user.role in (UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BROKER, UserRole.EMPLOYEE):
        return False
    ip_n = normalize_ip(ip)
    if not ip_n or ip_n == "0.0.0.0":
        return False
    # A user is blocked if the IP is on their OWNING admin's list OR on the
    # platform (admin_id=None) list — the super-admin's list is the platform-
    # wide blocklist, so the owner's ban catches a user in ANY pool.
    admin_id = user.assigned_admin_id  # None ⇒ platform pool
    scopes: list = [None]
    if admin_id is not None:
        scopes.append(admin_id)
    hit = await BlockedIP.find_one({"admin_id": {"$in": scopes}, "ip": ip_n})
    return hit is not None


async def add(
    admin_id: PydanticObjectId | None,
    ip: str,
    reason: str | None,
    created_by: PydanticObjectId | None,
    created_by_name: str | None,
) -> BlockedIP:
    """Upsert one (admin_id, ip) ban — re-adding refreshes the note/author."""
    ip_n = normalize_ip(ip)
    if not ip_n:
        raise ValueError("IP is required")
    existing = await BlockedIP.find_one(BlockedIP.admin_id == admin_id, BlockedIP.ip == ip_n)
    if existing:
        existing.reason = reason
        existing.created_by = created_by
        existing.created_by_name = created_by_name
        await existing.save()
        return existing
    row = BlockedIP(
        admin_id=admin_id,
        ip=ip_n,
        reason=reason,
        created_by=created_by,
        created_by_name=created_by_name,
    )
    await row.insert()
    return row


async def remove(admin_id: PydanticObjectId | None, ip: str) -> bool:
    ip_n = normalize_ip(ip)
    row = await BlockedIP.find_one(BlockedIP.admin_id == admin_id, BlockedIP.ip == ip_n)
    if row is None:
        return False
    await row.delete()
    return True


def _to_dict(row: BlockedIP, admin_label: str | None = None) -> dict:
    return {
        "id": str(row.id),
        "ip": row.ip,
        "reason": row.reason,
        "admin_id": str(row.admin_id) if row.admin_id else None,
        "admin_label": admin_label,
        "created_by_name": row.created_by_name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def list_for_admin(admin_id: PydanticObjectId | None) -> list[dict]:
    """This admin's own blocklist (admin_id=None for the super-admin pool)."""
    rows = await BlockedIP.find(BlockedIP.admin_id == admin_id).sort("-created_at").to_list()
    return [_to_dict(r) for r in rows]


async def list_all() -> list[dict]:
    """Super-admin master view: every ban across every pool, labelled with the
    owning admin ("kaha kaha se blocked hai")."""
    rows = await BlockedIP.find_all().sort("-created_at").to_list()
    # Resolve admin names in one pass.
    ids = {r.admin_id for r in rows if r.admin_id is not None}
    names: dict[PydanticObjectId, str] = {}
    if ids:
        async for a in User.find({"_id": {"$in": list(ids)}}):
            names[a.id] = a.full_name or a.email or str(a.id)
    return [
        _to_dict(r, admin_label=("Platform (super-admin)" if r.admin_id is None else names.get(r.admin_id, "—")))
        for r in rows
    ]
