"""User Refer & Earn — the referrer's code/link, conditions + earnings cards."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.dependencies import CurrentUser
from app.schemas.common import APIResponse
from app.services import referral_service

router = APIRouter(prefix="/referral", tags=["user-referral"])


@router.get("", response_model=APIResponse[dict])
async def my_referral(user: CurrentUser):
    """Everything the Refer & Earn page shows: this user's referral code, the
    reward + min-deposit conditions (from their admin), the earnings cards
    (successful referrals + total earned), and the per-referral list."""
    return APIResponse(data=await referral_service.summary(user))
