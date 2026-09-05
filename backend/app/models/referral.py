"""Referral — one document per user-to-user referral.

A referrer shares their link (`register?rc=<referral_code>`); the referee who
signs up through it lands under the referrer's SAME broker/admin and this row is
created PENDING. The referrer is paid (fixed amount, from the referrer's admin's
referral settings) only once the referee has BOTH:
  • deposited >= the admin's min-deposit, AND
  • opened at least one position.
On qualification the reward is credited straight into the referrer's wallet
available_balance (withdrawable) and the row goes PAID.
"""

from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from bson import Decimal128
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.models._base import StrEnum, TimestampMixin
from app.models._types import Money


def _zero() -> Decimal128:
    return Decimal128("0")


class ReferralStatus(StrEnum):
    PENDING = "PENDING"      # referee joined, conditions not yet met
    QUALIFIED = "QUALIFIED"  # both conditions met, reward about to be paid
    PAID = "PAID"            # reward credited to the referrer's wallet


class Referral(TimestampMixin):
    referrer_id: PydanticObjectId          # who shared the link (gets the reward)
    referee_id: PydanticObjectId           # who joined via the link
    # The admin whose referral settings priced this reward (referrer's admin, or
    # None for the super-admin/platform pool). Frozen at join time.
    admin_id: PydanticObjectId | None = None

    status: ReferralStatus = ReferralStatus.PENDING
    deposit_met: bool = False              # referee deposited >= min
    trade_met: bool = False                # referee opened >= 1 position

    reward_amount: Money = Field(default_factory=_zero)  # paid on qualification
    qualified_at: datetime | None = None
    paid_at: datetime | None = None

    class Settings:
        name = "referrals"
        indexes = [
            IndexModel([("referrer_id", ASCENDING), ("created_at", DESCENDING)]),
            # One referral row per referee (a user is referred at most once).
            IndexModel([("referee_id", ASCENDING)], unique=True),
            IndexModel([("status", ASCENDING)]),
        ]
