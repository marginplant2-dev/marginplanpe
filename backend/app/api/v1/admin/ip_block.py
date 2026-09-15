"""Admin "IP Block" — each admin bans IPs from their own pool. Gated by the
super-admin-granted ``ip_blocking`` permission (super-admin always passes).

A ban applies to users whose owning admin matches the ban's admin_id, enforced
in the user auth dependency + login (see ip_block_service). The super-admin
also gets a platform-wide master list of every ban across every pool.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.dependencies import (
    CurrentAdmin,
    SuperAdmin,
    effective_scope_actor,
    require_admin_permission,
)
from app.core.exceptions import ValidationFailedError
from app.models.user import UserRole
from app.schemas.common import APIResponse
from app.services import ip_block_service

router = APIRouter(prefix="/ip-block", tags=["admin-ip-block"])


class AddIpBody(BaseModel):
    ip: str
    reason: str | None = None
    # Widen a single IP to its subscriber prefix (IPv4 /24, IPv6 /64) so a
    # mobile user rotating IPs within the same block stays caught.
    as_range: bool = False


async def _scope_admin_id(admin) -> object:
    """The pool this admin's blocklist belongs to: None for super-admin
    (platform pool), else the effective admin id (employee → parent)."""
    actor = await effective_scope_actor(admin)
    return None if actor.role == UserRole.SUPER_ADMIN else actor.id


@router.get("/all", response_model=APIResponse[list])
async def list_all_blocked(_: SuperAdmin):
    """Super-admin master list: every blocked IP across every pool."""
    return APIResponse(data=await ip_block_service.list_all())


@router.get("", response_model=APIResponse[list])
async def list_blocked(
    admin: CurrentAdmin,
    _: None = Depends(require_admin_permission("ip_blocking")),
):
    return APIResponse(data=await ip_block_service.list_for_admin(await _scope_admin_id(admin)))


@router.post("", response_model=APIResponse[dict])
async def add_blocked(
    body: AddIpBody,
    admin: CurrentAdmin,
    _: None = Depends(require_admin_permission("ip_blocking")),
):
    try:
        row = await ip_block_service.add(
            admin_id=await _scope_admin_id(admin),
            ip=body.ip,
            reason=body.reason,
            created_by=admin.id,
            created_by_name=admin.full_name or admin.email,
            as_range=body.as_range,
        )
    except ValueError as e:
        raise ValidationFailedError(str(e)) from e
    return APIResponse(data={"id": str(row.id), "ip": row.ip, "is_cidr": row.is_cidr})


@router.delete("", response_model=APIResponse[dict])
async def remove_blocked(
    admin: CurrentAdmin,
    ip: str = Query(...),
    _: None = Depends(require_admin_permission("ip_blocking")),
):
    ok = await ip_block_service.remove(await _scope_admin_id(admin), ip)
    return APIResponse(data={"removed": ok})
