"""Bonus engine — grant / absorb-loss / wager / convert / expire, all
materialized from the append-only bonus_transactions ledger.

Loss model (operator-confirmed, DEPOSIT-FIRST): a trade loss drains the
user's REAL available_balance first; only the part that would push the
balance below zero (the overflow) is offered here to `absorb_loss`, which
eats it out of the bonus credit pool BEFORE it books to settlement. So bonus
credit is the last cushion, not the first. Stop-out counts bonus credit in
the equity base (risk_enforcer) so the user can ride a bit further.

Whole module is dormant unless settings.BONUSES_ENABLED — callers gate first.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Any

from beanie import PydanticObjectId

from app.models.audit_log import AuditAction
from app.models.bonus_template import BonusTemplate
from app.models.bonus_transaction import BonusAction, BonusTransaction
from app.models.user import User
from app.models.user_bonus import UserBonus, UserBonusStatus
from app.models.wallet import Wallet
from app.services import bonus_template_service, wallet_service
from app.services.audit_service import log_event
from app.utils.decimal_utils import quantize_money, to_decimal, to_decimal128
from app.utils.time_utils import now_utc

logger = logging.getLogger("bonus")
ZERO = Decimal("0")


def _uid(user_or_id: Any) -> PydanticObjectId:
    if isinstance(user_or_id, User):
        return user_or_id.id
    return PydanticObjectId(str(user_or_id))


# ── low-level helpers ────────────────────────────────────────────────
async def _write_bonus_tx(
    *, bonus: UserBonus, action: BonusAction, credit_delta: Decimal,
    position_id=None, trade_id=None, wallet_tx_id=None, metadata=None,
) -> BonusTransaction:
    tx = BonusTransaction(
        user_id=bonus.user_id,
        bonus_id=bonus.id,
        action=action,
        credit_delta=to_decimal128(credit_delta),
        related_position_id=position_id,
        related_trade_id=trade_id,
        related_wallet_tx_id=wallet_tx_id,
        metadata=metadata or {},
    )
    await tx.insert()
    return tx


async def _bump_wallet_credit(user_id: Any, delta: Decimal) -> None:
    """Apply a signed delta to Wallet.credit, floored at 0.
    ponytail: load-modify-save, not optimistic-locked — safe under the
    effectively-sequential per-user grant/close path; add a version guard if
    concurrent same-user grants+losses ever contend."""
    w = await Wallet.find_one(Wallet.user_id == _uid(user_id))
    if w is None:
        return
    new = quantize_money(to_decimal(w.credit) + to_decimal(delta))
    if new < 0:
        new = ZERO
    w.credit = to_decimal128(new)
    await w.save()


# ── grants ───────────────────────────────────────────────────────────
async def grant_from_template(
    user: User, template: BonusTemplate, deposit_amount: Any,
    *, deposit_id: PydanticObjectId | None, granted_by: PydanticObjectId | None,
) -> UserBonus:
    amount = bonus_template_service.compute_bonus_amount(template, deposit_amount)
    if amount <= 0:
        raise ValueError("Computed bonus amount is zero")
    target = quantize_money(amount * Decimal(int(template.wager_requirement_multiple)))
    expires = now_utc() + timedelta(days=int(template.duration_days)) if template.duration_days else None
    bonus = UserBonus(
        user_id=user.id,
        admin_id=getattr(user, "assigned_admin_id", None) or granted_by,
        template_id=template.id,
        template_name_snapshot=template.name,
        type=str(template.type),
        deposit_id=deposit_id,
        deposit_amount=to_decimal128(deposit_amount),
        original_amount=to_decimal128(amount),
        current_credit=to_decimal128(amount),
        wager_requirement_multiple=int(template.wager_requirement_multiple),
        wager_target_volume=to_decimal128(target),
        granted_by=granted_by,
        expires_at=expires,
    )
    await bonus.insert()
    await _write_bonus_tx(bonus=bonus, action=BonusAction.GRANTED, credit_delta=amount)
    await _bump_wallet_credit(user.id, amount)
    template.used_count = int(template.used_count) + 1
    await template.save()
    await log_event(
        action=AuditAction.CREATE, entity_type="UserBonus", entity_id=bonus.id,
        actor_id=granted_by, target_user_id=user.id,
        metadata={"amount": str(amount), "template": template.name, "type": str(template.type)},
    )
    return bonus


async def grant_custom(
    user: User, amount: Any, *, granted_by: PydanticObjectId | None, notes: str = ""
) -> UserBonus:
    amt = quantize_money(to_decimal(amount))
    if amt <= 0:
        raise ValueError("Bonus amount must be positive")
    bonus = UserBonus(
        user_id=user.id,
        admin_id=getattr(user, "assigned_admin_id", None) or granted_by,
        template_id=None,
        template_name_snapshot="Custom",
        type="CUSTOM",
        original_amount=to_decimal128(amt),
        current_credit=to_decimal128(amt),
        wager_requirement_multiple=0,
        wager_target_volume=to_decimal128(ZERO),
        granted_by=granted_by,
        expires_at=None,
        notes=notes or "",
    )
    await bonus.insert()
    await _write_bonus_tx(bonus=bonus, action=BonusAction.GRANTED, credit_delta=amt)
    await _bump_wallet_credit(user.id, amt)
    await log_event(
        action=AuditAction.CREATE, entity_type="UserBonus", entity_id=bonus.id,
        actor_id=granted_by, target_user_id=user.id,
        metadata={"amount": str(amt), "type": "CUSTOM"},
    )
    return bonus


async def cancel(bonus: UserBonus, *, cancelled_by: PydanticObjectId | None, reason: str) -> UserBonus:
    if bonus.status != UserBonusStatus.ACTIVE:
        raise ValueError("Only an active bonus can be cancelled")
    leftover = to_decimal(bonus.current_credit)
    if leftover > 0:
        await _write_bonus_tx(bonus=bonus, action=BonusAction.CANCELLED_CLAWED, credit_delta=-leftover)
        await _bump_wallet_credit(bonus.user_id, -leftover)
        bonus.current_credit = to_decimal128(ZERO)
    bonus.status = UserBonusStatus.CANCELLED
    bonus.cancelled_at = now_utc()
    bonus.cancelled_by = cancelled_by
    bonus.cancellation_reason = reason or ""
    await bonus.save()
    await log_event(
        action=AuditAction.UPDATE, entity_type="UserBonus", entity_id=bonus.id,
        actor_id=cancelled_by, target_user_id=bonus.user_id,
        metadata={"action": "cancel", "reason": reason, "clawed": str(leftover)},
    )
    return bonus


# ── ledger materialization ───────────────────────────────────────────
async def recompute_credit(user_id: Any) -> Decimal:
    """Re-sum every bonus's ledger → current_credit, and the ACTIVE total →
    Wallet.credit. Idempotent — the safety-net that makes the cached fields
    self-healing."""
    uid = _uid(user_id)
    bonuses = await UserBonus.find(UserBonus.user_id == uid).to_list()
    total = ZERO
    for b in bonuses:
        rows = await BonusTransaction.find(BonusTransaction.bonus_id == b.id).to_list()
        s = quantize_money(sum((to_decimal(r.credit_delta) for r in rows), ZERO))
        if s < 0:
            s = ZERO
        if to_decimal(b.current_credit) != s:
            b.current_credit = to_decimal128(s)
            await b.save()
        if b.status == UserBonusStatus.ACTIVE:
            total += s
    total = quantize_money(total)
    w = await Wallet.find_one(Wallet.user_id == uid)
    if w is not None:
        w.credit = to_decimal128(total)
        await w.save()
    return total


async def absorb_loss(
    user: Any, loss_amount: Any, *, position_id=None, trade_id=None
) -> Decimal:
    """Eat `loss_amount` (the overflow past real balance) out of ACTIVE bonus
    credit, OLDEST bonus first. Returns the amount actually absorbed; the
    caller books only the residual to settlement."""
    remaining = quantize_money(to_decimal(loss_amount))
    if remaining <= 0:
        return ZERO
    uid = _uid(user)
    bonuses = (
        await UserBonus.find(
            UserBonus.user_id == uid, UserBonus.status == UserBonusStatus.ACTIVE
        )
        .sort("+granted_at")
        .to_list()
    )
    absorbed_total = ZERO
    for b in bonuses:
        if remaining <= 0:
            break
        cred = to_decimal(b.current_credit)
        if cred <= 0:
            continue
        take = min(cred, remaining)
        await _write_bonus_tx(
            bonus=b, action=BonusAction.LOSS_ABSORBED, credit_delta=-take,
            position_id=position_id, trade_id=trade_id,
        )
        b.current_credit = to_decimal128(cred - take)
        await b.save()
        remaining -= take
        absorbed_total += take
    if absorbed_total > 0:
        await _bump_wallet_credit(uid, -absorbed_total)
    return quantize_money(absorbed_total)


async def complete_and_convert(bonus: UserBonus) -> UserBonus:
    """Wager met → move remaining bonus credit into withdrawable
    available_balance and close the bonus. Idempotent."""
    if bonus.status != UserBonusStatus.ACTIVE:
        return bonus
    credit = to_decimal(bonus.current_credit)
    if credit > 0:
        wtx = await wallet_service.credit_balance(
            user_id=bonus.user_id, amount=credit, reason="BONUS_CONVERTED",
            bonus_id=bonus.id, metadata={"bonus": bonus.template_name_snapshot},
        )
        await _write_bonus_tx(
            bonus=bonus, action=BonusAction.COMPLETED_CONVERTED, credit_delta=-credit,
            wallet_tx_id=(wtx.id if wtx is not None else None),
        )
        await _bump_wallet_credit(bonus.user_id, -credit)
        bonus.current_credit = to_decimal128(ZERO)
    bonus.status = UserBonusStatus.COMPLETED
    bonus.completed_at = now_utc()
    await bonus.save()
    await log_event(
        action=AuditAction.UPDATE, entity_type="UserBonus", entity_id=bonus.id,
        target_user_id=bonus.user_id,
        metadata={"action": "completed", "converted": str(credit)},
    )
    return bonus


async def increment_wager(user: Any, trade_notional: Any, *, trade_id=None) -> None:
    """Add a fill's notional to every ACTIVE bonus's wager progress, then
    convert any that just crossed their target."""
    uid = _uid(user)
    notional = quantize_money(to_decimal(trade_notional))
    if notional <= 0:
        return
    await UserBonus.get_motor_collection().update_many(
        {"user_id": uid, "status": UserBonusStatus.ACTIVE.value},
        {"$inc": {"wager_progress_volume": to_decimal128(notional)},
         "$set": {"updated_at": now_utc()}},
    )
    bonuses = await UserBonus.find(
        UserBonus.user_id == uid, UserBonus.status == UserBonusStatus.ACTIVE
    ).to_list()
    for b in bonuses:
        target = to_decimal(b.wager_target_volume)
        if target > 0 and to_decimal(b.wager_progress_volume) >= target:
            await complete_and_convert(b)


async def expire(bonus: UserBonus) -> UserBonus:
    """Past expiry with wager unmet → claw back the remaining credit."""
    if bonus.status != UserBonusStatus.ACTIVE:
        return bonus
    leftover = to_decimal(bonus.current_credit)
    if leftover > 0:
        await _write_bonus_tx(bonus=bonus, action=BonusAction.EXPIRED_CLAWED, credit_delta=-leftover)
        await _bump_wallet_credit(bonus.user_id, -leftover)
        bonus.current_credit = to_decimal128(ZERO)
    bonus.status = UserBonusStatus.EXPIRED
    await bonus.save()
    await log_event(
        action=AuditAction.UPDATE, entity_type="UserBonus", entity_id=bonus.id,
        target_user_id=bonus.user_id,
        metadata={"action": "expired", "clawed": str(leftover)},
    )
    return bonus


# ── deposit auto-grant + preview ─────────────────────────────────────
async def maybe_auto_grant_on_deposit(
    user: User, deposit_amount: Any, *, deposit_id: PydanticObjectId, is_first: bool | None = None
) -> UserBonus | None:
    """Idempotent-by-deposit auto-grant. Returns the (existing or new) bonus,
    or None when no template matches. Swallows ValueError (zero-amount)."""
    existing = await UserBonus.find_one(UserBonus.deposit_id == PydanticObjectId(str(deposit_id)))
    if existing is not None:
        return existing
    if is_first is None:
        is_first = getattr(user, "first_deposit_at", None) is None
    admin_id = getattr(user, "assigned_admin_id", None)
    tpl = await bonus_template_service.find_matching_template(deposit_amount, is_first, admin_id)
    if tpl is None:
        return None
    try:
        return await grant_from_template(
            user, tpl, deposit_amount, deposit_id=deposit_id, granted_by=None
        )
    except ValueError:
        return None


async def _nearest_minimum(deposit_amount, is_first, admin_id):
    """Smallest in-scope template min_deposit that the deposit fell short of →
    lets the preview say 'deposit ≥ X for a bonus'. Returns (min, name) or None."""
    from app.models.bonus_template import BonusType, TemplateStatus

    amt = to_decimal(deposit_amount)
    now = now_utc()
    types = (
        [BonusType.FIRST_DEPOSIT, BonusType.REGULAR_DEPOSIT]
        if is_first else [BonusType.REGULAR_DEPOSIT]
    )
    best = None
    for t in types:
        rows = await BonusTemplate.find(
            BonusTemplate.type == t, BonusTemplate.status == TemplateStatus.ACTIVE
        ).to_list()
        for tpl in rows:
            if tpl.admin_id not in (None, admin_id):
                continue
            if tpl.end_date is not None and tpl.end_date < now:
                continue
            mn = to_decimal(tpl.min_deposit)
            if mn > amt and (best is None or mn < best[0]):
                best = (mn, tpl.name)
    return best


async def preview_eligible(user: User, deposit_amount: Any) -> dict:
    """Pure calculator (no mutation): what bonus THIS deposit would earn."""
    admin_id = getattr(user, "assigned_admin_id", None)
    is_first = getattr(user, "first_deposit_at", None) is None
    tpl = await bonus_template_service.find_matching_template(deposit_amount, is_first, admin_id)
    if tpl is None:
        below = await _nearest_minimum(deposit_amount, is_first, admin_id)
        return {
            "bonus_amount": "0", "template_id": None, "template_name": None, "type": None,
            "is_first_deposit": is_first, "below_minimum": below is not None,
            "minimum_required": str(below[0]) if below else None,
            "minimum_template_name": below[1] if below else None,
        }
    amt = bonus_template_service.compute_bonus_amount(tpl, deposit_amount)
    return {
        "bonus_amount": str(amt), "template_id": str(tpl.id), "template_name": tpl.name,
        "type": str(tpl.type), "is_first_deposit": is_first, "below_minimum": False,
        "minimum_required": None, "minimum_template_name": None,
    }
