"""Referral programme — user-to-user referrals.

Flow:
  • Every user has a `referral_code`; their share link is register?rc=<code>.
  • A referee who signs up with that code inherits the referrer's broker/admin
    and a PENDING Referral row is created, priced by the REFERRER's admin's
    per-admin settings (referral_reward / referral_min_deposit / referral_enabled).
  • The referrer is PAID (reward → their wallet available_balance, withdrawable)
    only once the referee BOTH deposits >= min AND opens >= 1 position.

Every public function is best-effort where it hangs off a primary write
(signup / deposit / trade): a referral hiccup must never roll those back.
"""

from __future__ import annotations

import logging
import secrets

from beanie import PydanticObjectId

from app.models.referral import Referral, ReferralStatus
from app.models.transaction import TransactionType
from app.models.user import User, UserRole
from app.utils.decimal_utils import quantize_money, to_decimal, to_decimal128
from app.utils.time_utils import now_utc

logger = logging.getLogger(__name__)

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous 0/O/1/I


def _uid(u) -> PydanticObjectId:
    return u.id if isinstance(u, User) else PydanticObjectId(str(u))


async def ensure_code(user: User) -> str:
    """Return the user's referral code, generating a unique one on first use."""
    if user.referral_code:
        return user.referral_code
    for _ in range(8):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        if await User.find_one(User.referral_code == code) is None:
            user.referral_code = code
            await user.save()
            return code
    # Astronomically unlikely fallback — append random hex.
    user.referral_code = "R" + secrets.token_hex(4).upper()
    await user.save()
    return user.referral_code


async def resolve_referrer(code: str | None) -> User | None:
    """Find the user who owns a referral code (client-tier only)."""
    if not code or not code.strip():
        return None
    u = await User.find_one(User.referral_code == code.strip().upper())
    if u is None or u.role != UserRole.CLIENT:
        return None
    return u


async def _pricing_admin(referrer: User) -> User | None:
    """The admin whose referral settings price this referrer's rewards — the
    referrer's assigned admin, else the platform super-admin."""
    if referrer.assigned_admin_id:
        adm = await User.get(referrer.assigned_admin_id)
        if adm is not None:
            return adm
    return await User.find_one(User.role == UserRole.SUPER_ADMIN)


async def attach_referral(referee: User, referrer: User) -> Referral | None:
    """Create the PENDING referral row at signup. Reward + min-deposit are frozen
    from the referrer's admin's settings. No-op if referral is disabled there or
    a row already exists for this referee. Returns the row (or None)."""
    if referee.id == referrer.id:
        return None
    existing = await Referral.find_one(Referral.referee_id == referee.id)
    if existing is not None:
        return existing
    adm = await _pricing_admin(referrer)
    if adm is None or not bool(getattr(adm, "referral_enabled", True)):
        return None
    row = Referral(
        referrer_id=referrer.id,
        referee_id=referee.id,
        admin_id=adm.id if adm.role != UserRole.SUPER_ADMIN else None,
        reward_amount=to_decimal128(to_decimal(getattr(adm, "referral_reward", 0) or 0)),
    )
    await row.insert()
    return row


async def _min_deposit_for(row: Referral) -> object:
    """Min-deposit threshold for a referral, from its pricing admin (frozen at
    row create for reward, re-read for min so an admin edit applies to pending)."""
    adm = await User.get(row.admin_id) if row.admin_id else await User.find_one(
        User.role == UserRole.SUPER_ADMIN
    )
    return to_decimal(getattr(adm, "referral_min_deposit", 0) or 0) if adm else to_decimal(0)


async def _try_qualify(row: Referral) -> None:
    """If both conditions met and still unpaid → credit the referrer + mark PAID."""
    if row.status == ReferralStatus.PAID:
        return
    if not (row.deposit_met and row.trade_met):
        return
    reward = to_decimal(row.reward_amount)
    row.status = ReferralStatus.QUALIFIED
    row.qualified_at = now_utc()
    await row.save()
    if reward > 0:
        from app.services import wallet_service

        await wallet_service.adjust(
            row.referrer_id,
            reward,
            transaction_type=TransactionType.REFERRAL,
            narration="Referral reward",
            reference_type="REFERRAL",
            reference_id=str(row.id),
        )
    row.status = ReferralStatus.PAID
    row.paid_at = now_utc()
    await row.save()
    logger.info(
        "referral_paid",
        extra={"referral": str(row.id), "referrer": str(row.referrer_id), "reward": float(reward)},
    )


async def on_deposit(user_id, deposit_amount) -> None:
    """Called after a referee's deposit is credited. Marks deposit_met when the
    (cumulative sense: single deposit) amount clears the min, then tries to pay."""
    try:
        uid = _uid(user_id)
        row = await Referral.find_one(
            Referral.referee_id == uid, Referral.status != ReferralStatus.PAID
        )
        if row is None or row.deposit_met:
            return
        min_dep = await _min_deposit_for(row)
        if to_decimal(deposit_amount) >= min_dep:
            row.deposit_met = True
            await row.save()
            await _try_qualify(row)
    except Exception:  # never block the deposit
        logger.exception("referral_on_deposit_failed user=%s", user_id)


async def on_first_trade(user_id) -> None:
    """Called when a referee opens a position. Marks trade_met, then tries to pay."""
    try:
        uid = _uid(user_id)
        row = await Referral.find_one(
            Referral.referee_id == uid, Referral.status != ReferralStatus.PAID
        )
        if row is None or row.trade_met:
            return
        row.trade_met = True
        await row.save()
        await _try_qualify(row)
    except Exception:  # never block the trade
        logger.exception("referral_on_first_trade_failed user=%s", user_id)


async def summary(user: User) -> dict:
    """Refer & Earn card data for `user`: their code/link inputs + totals + list."""
    code = await ensure_code(user)
    rows = await Referral.find(Referral.referrer_id == user.id).sort("-created_at").to_list()
    successful = [r for r in rows if r.status == ReferralStatus.PAID]
    total_earned = quantize_money(sum((to_decimal(r.reward_amount) for r in successful), to_decimal(0)))
    # Reward the referrer WOULD earn per successful referral, from their admin.
    adm = await _pricing_admin(user)
    reward = to_decimal(getattr(adm, "referral_reward", 0) or 0) if adm else to_decimal(0)
    min_dep = to_decimal(getattr(adm, "referral_min_deposit", 0) or 0) if adm else to_decimal(0)
    enabled = bool(getattr(adm, "referral_enabled", True)) if adm else False

    async def _name(rid) -> str:
        u = await User.get(rid)
        return (u.full_name or u.user_code or "User") if u else "User"

    items = []
    for r in rows:
        items.append(
            {
                "name": await _name(r.referee_id),
                "status": r.status.value,
                "deposit_met": r.deposit_met,
                "trade_met": r.trade_met,
                "reward": str(quantize_money(to_decimal(r.reward_amount))),
                "created_at": r.created_at,
            }
        )
    return {
        "referral_code": code,
        "enabled": enabled,
        "reward_amount": str(quantize_money(reward)),
        "min_deposit": str(quantize_money(min_dep)),
        "total_referrals": len(rows),
        "successful_referrals": len(successful),
        "total_earned": str(total_earned),
        "referrals": items,
    }


async def admin_stats(admin: User) -> dict:
    """Referral analytics for an admin's pool (SUPER_ADMIN = whole platform):
    total referred users, total reward paid out, and the top-5 referrers by
    joined count with their earnings.

    ponytail: groups in Python — referral volume is small. Switch to a Mongo
    $group aggregation only if the collection grows past a few thousand rows.
    """
    # Each principal sees ONLY their OWN pool's referrals: a regular admin →
    # rows priced by them (admin_id == self); the super-admin → the platform
    # pool (admin_id is None, i.e. referrers who sit directly under super-admin,
    # not under any sub-admin).
    q: dict = {"admin_id": None if admin.role == UserRole.SUPER_ADMIN else admin.id}
    rows = await Referral.find(q).to_list()
    total_paid = to_decimal(0)
    agg: dict[PydanticObjectId, dict] = {}
    for r in rows:
        d = agg.setdefault(r.referrer_id, {"joined": 0, "paid": 0, "earned": to_decimal(0)})
        d["joined"] += 1
        if r.status == ReferralStatus.PAID:
            amt = to_decimal(r.reward_amount)
            total_paid += amt
            d["paid"] += 1
            d["earned"] += amt
    top = sorted(agg.items(), key=lambda kv: (kv[1]["joined"], kv[1]["earned"]), reverse=True)[:5]
    ref_ids = [rid for rid, _ in top]
    users = await User.find({"_id": {"$in": ref_ids}}).to_list() if ref_ids else []
    meta = {u.id: (u.full_name, u.user_code) for u in users}
    top_referrers = [
        {
            "name": meta.get(rid, ("Unknown", ""))[0],
            "user_code": meta.get(rid, ("", ""))[1],
            "joined": d["joined"],
            "paid": d["paid"],
            "earned": str(quantize_money(d["earned"])),
        }
        for rid, d in top
    ]
    return {
        "total_referred": len(rows),
        "total_paid": str(quantize_money(total_paid)),
        "top_referrers": top_referrers,
    }
