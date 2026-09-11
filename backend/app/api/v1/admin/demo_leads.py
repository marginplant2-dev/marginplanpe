"""Admin "Demo Accounts" — the name + phone every visitor left before trying
this pool's demo. Scoped per admin (super-admin sees the platform pool)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import CurrentAdmin, require_perm
from app.models.user import UserRole
from app.schemas.common import APIResponse
from app.services import demo_lead_service

router = APIRouter(prefix="/demo-leads", tags=["admin-demo-leads"])


@router.get("", response_model=APIResponse[dict])
async def list_demo_leads(
    admin: CurrentAdmin,
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _: None = Depends(require_perm("users", "read")),
):
    # Each admin sees ONLY their own pool's leads; the super-admin sees the
    # platform pool (admin_id None) — same scoping the referral stats use.
    scope_admin_id = None if admin.role == UserRole.SUPER_ADMIN else admin.id
    data = await demo_lead_service.list_for_admin(
        admin_id=scope_admin_id, search=search, page=page, page_size=page_size
    )
    return APIResponse(data=data)
