"""Per-grant bonus row — one document per bonus granted to a user. The
live `Wallet.credit` pool is the sum of every ACTIVE bonus's `current_credit`;
this row tracks that grant's wager progress + lifecycle. Part of Bonus
Management (gated by settings.BONUSES_ENABLED).
"""

from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from bson import Decimal128
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.models._base import StrEnum, TimestampMixin
from app.models._types import Money
from app.utils.time_utils import now_utc


def _zero() -> Decimal128:
    return Decimal128("0")


class UserBonusStatus(StrEnum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"  # wager met → remaining credit converted to cash
    EXPIRED = "EXPIRED"  # past expires_at, wager unmet → remainder clawed
    CANCELLED = "CANCELLED"  # admin cancel → remainder clawed


class UserBonus(TimestampMixin):
    user_id: PydanticObjectId
    admin_id: PydanticObjectId | None = None  # owning admin; None = super-admin pool
    template_id: PydanticObjectId | None = None
    template_name_snapshot: str = ""
    type: str = "CUSTOM"  # BonusType value, or "CUSTOM" for flat grants
    deposit_id: PydanticObjectId | None = None
    deposit_amount: Money = Field(default_factory=_zero)

    original_amount: Money  # bonus amount at grant time
    current_credit: Money = Field(default_factory=_zero)  # cached Σ this bonus's tx deltas
    wager_requirement_multiple: int = 0
    wager_target_volume: Money = Field(default_factory=_zero)  # original × multiple
    wager_progress_volume: Money = Field(default_factory=_zero)

    status: UserBonusStatus = UserBonusStatus.ACTIVE
    granted_at: datetime = Field(default_factory=now_utc)
    expires_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    granted_by: PydanticObjectId | None = None
    cancelled_by: PydanticObjectId | None = None
    cancellation_reason: str = ""
    notes: str = ""

    class Settings:
        name = "user_bonuses"
        indexes = [
            IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("admin_id", ASCENDING), ("granted_at", DESCENDING)]),
            # One bonus per deposit — blocks a double-grant on webhook / retry.
            IndexModel([("deposit_id", ASCENDING)], unique=True, sparse=True),
        ]
