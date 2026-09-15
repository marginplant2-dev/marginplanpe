"""IP-blocking — per-admin blocklist of IPs (and CIDR ranges) banned from that
admin's pool.

The super-admin grants an admin the ``ip_blocking`` permission; that admin then
adds IPs/ranges here. A user in the admin's pool logging in (or acting) from a
blocked IP is rejected. Resolution mirrors
``user_service.is_under_admin_maintenance``: the ban that applies to a user is
on the user's OWNING admin (``assigned_admin_id``; None ⇒ platform pool). The
super-admin's list (admin_id=None) is the PLATFORM-WIDE list — it applies to
every pool.

Ranges matter: mobile users hop IPs and use IPv6, so blocking one address
rarely catches them. A CIDR block (IPv4 /24, IPv6 /64) catches the whole
subscriber prefix.
"""

from __future__ import annotations

import ipaddress

from beanie import PydanticObjectId

from app.models.blocked_ip import BlockedIP
from app.models.user import User, UserRole

_ADMIN_TIER = (UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BROKER, UserRole.EMPLOYEE)


def _canonical(raw: str) -> tuple[str, bool] | None:
    """(stored_value, is_cidr) for a valid IP or CIDR, else None. Canonicalises
    so exact-match dedup + lookup are representation-independent (IPv6
    compression, host bits in a CIDR)."""
    s = (raw or "").strip()
    if not s:
        return None
    if "/" in s:
        try:
            return str(ipaddress.ip_network(s, strict=False)), True
        except ValueError:
            return None
    try:
        return str(ipaddress.ip_address(s)), False
    except ValueError:
        return None


def _widen(stored: str) -> str:
    """Expand a single IP to its subscriber prefix: IPv4 → /24, IPv6 → /64."""
    a = ipaddress.ip_address(stored)
    prefix = 24 if a.version == 4 else 64
    return str(ipaddress.ip_network(f"{stored}/{prefix}", strict=False))


async def is_ip_blocked_for_user(user: User, ip: str) -> bool:
    """True when the user's owning admin (or the platform list) bans this IP —
    by exact match OR by falling inside a blocked CIDR range.

    Admin-tier accounts are NEVER IP-blocked (can't lock an admin out).

    ponytail: one indexed exact find_one + (only if any range entries exist) a
    small scan of range rows for the scope, per authenticated request. Pools
    keep a handful of entries; add a Redis cache keyed by admin_id if the
    platform list ever grows large enough to show up in profiling.
    """
    if user.role in _ADMIN_TIER:
        return False
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False  # unparseable peer (e.g. "0.0.0.0") → don't block
    canon = str(addr)
    admin_id = user.assigned_admin_id  # None ⇒ platform pool
    scopes: list = [None]
    if admin_id is not None:
        scopes.append(admin_id)
    # Exact IP (indexed). No is_cidr filter: a CIDR is stored with a "/" so it
    # can never equal a plain address, and legacy rows predating the is_cidr
    # field would be missed by an {is_cidr: False} clause (Mongo doesn't match
    # a missing field against False).
    if await BlockedIP.find_one({"admin_id": {"$in": scopes}, "ip": canon}):
        return True
    # CIDR ranges — usually zero or a few.
    async for b in BlockedIP.find({"admin_id": {"$in": scopes}, "is_cidr": True}):
        try:
            net = ipaddress.ip_network(b.ip, strict=False)
        except ValueError:
            continue
        if addr.version == net.version and addr in net:
            return True
    return False


async def add(
    admin_id: PydanticObjectId | None,
    ip: str,
    reason: str | None,
    created_by: PydanticObjectId | None,
    created_by_name: str | None,
    as_range: bool = False,
) -> BlockedIP:
    """Upsert one (admin_id, ip) ban. `as_range` widens a single IP to its /24
    (v4) or /64 (v6) prefix. Raises ValueError on an invalid IP/CIDR."""
    c = _canonical(ip)
    if c is None:
        raise ValueError("Enter a valid IP or range, e.g. 106.78.2.68 or 106.78.2.0/24")
    stored, is_cidr = c
    if as_range and not is_cidr:
        stored, is_cidr = _widen(stored), True
    existing = await BlockedIP.find_one(BlockedIP.admin_id == admin_id, BlockedIP.ip == stored)
    if existing:
        existing.is_cidr = is_cidr
        existing.reason = reason
        existing.created_by = created_by
        existing.created_by_name = created_by_name
        await existing.save()
        return existing
    row = BlockedIP(
        admin_id=admin_id,
        ip=stored,
        is_cidr=is_cidr,
        reason=reason,
        created_by=created_by,
        created_by_name=created_by_name,
    )
    await row.insert()
    return row


async def remove(admin_id: PydanticObjectId | None, ip: str) -> bool:
    # Accept either the exact stored value or an equivalent representation.
    c = _canonical(ip)
    target = c[0] if c else (ip or "").strip()
    row = await BlockedIP.find_one(BlockedIP.admin_id == admin_id, BlockedIP.ip == target)
    if row is None:
        return False
    await row.delete()
    return True


def _to_dict(row: BlockedIP, admin_label: str | None = None) -> dict:
    return {
        "id": str(row.id),
        "ip": row.ip,
        "is_cidr": bool(getattr(row, "is_cidr", False)),
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
    ids = {r.admin_id for r in rows if r.admin_id is not None}
    names: dict[PydanticObjectId, str] = {}
    if ids:
        async for a in User.find({"_id": {"$in": list(ids)}}):
            names[a.id] = a.full_name or a.email or str(a.id)
    return [
        _to_dict(
            r,
            admin_label=("Platform (super-admin)" if r.admin_id is None else names.get(r.admin_id, "—")),
        )
        for r in rows
    ]


def _demo() -> None:
    """Self-check for the matching logic (no DB)."""
    assert _canonical("106.78.2.68") == ("106.78.2.68", False)
    assert _canonical("106.78.2.0/24") == ("106.78.2.0/24", True)
    assert _canonical("2402:3A80::1") == ("2402:3a80::1", False)  # canonicalised
    assert _canonical("not-an-ip") is None
    assert _widen("106.78.2.68") == "106.78.2.0/24"
    assert _widen("2402:3a80:1185:9e68:eb0d:f0fe:b75d:50ee") == "2402:3a80:1185:9e68::/64"
    # containment
    net = ipaddress.ip_network("106.78.2.0/24")
    assert ipaddress.ip_address("106.78.2.199") in net
    assert ipaddress.ip_address("106.78.3.1") not in net
    v6 = ipaddress.ip_network("2402:3a80:1185:9e68::/64")
    assert ipaddress.ip_address("2402:3a80:1185:9e68:ffff::1") in v6
    print("ip_block_service _demo OK")


if __name__ == "__main__":
    _demo()
