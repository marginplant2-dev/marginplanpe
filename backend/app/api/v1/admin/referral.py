"""Admin referral settings — each admin prices their own pool's referral reward
+ minimum-deposit condition (stored on the admin's own User row)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.dependencies import CurrentAdmin, require_perm
from app.schemas.common import APIResponse
from app.services import referral_service
from app.utils.decimal_utils import quantize_money, to_decimal, to_decimal128

router = APIRouter(prefix="/referral-settings", tags=["admin-referral"])


@router.get("/stats", response_model=APIResponse[dict])
async def get_stats(
    admin: CurrentAdmin,
    _: None = Depends(require_perm("users", "read")),
):
    """Referral analytics: total referred users, total paid out, top-5 referrers."""
    return APIResponse(data=await referral_service.admin_stats(admin))


class RefSettingsBody(BaseModel):
    enabled: bool = True
    reward_amount: float = Field(ge=0, le=10_000_000)
    min_deposit: float = Field(ge=0, le=10_000_000)


@router.get("", response_model=APIResponse[dict])
async def get_settings(
    admin: CurrentAdmin,
    _: None = Depends(require_perm("users", "read")),
):
    return APIResponse(
        data={
            "enabled": bool(getattr(admin, "referral_enabled", True)),
            "reward_amount": str(quantize_money(to_decimal(getattr(admin, "referral_reward", 0) or 0))),
            "min_deposit": str(quantize_money(to_decimal(getattr(admin, "referral_min_deposit", 0) or 0))),
        }
    )


@router.put("", response_model=APIResponse[dict])
async def put_settings(
    body: RefSettingsBody,
    admin: CurrentAdmin,
    _: None = Depends(require_perm("users", "write")),
):
    admin.referral_enabled = body.enabled
    admin.referral_reward = to_decimal128(to_decimal(body.reward_amount))
    admin.referral_min_deposit = to_decimal128(to_decimal(body.min_deposit))
    await admin.save()
    return APIResponse(data={"ok": True})
