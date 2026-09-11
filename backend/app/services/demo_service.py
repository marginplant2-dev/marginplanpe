"""Shared demo account lifecycle.

The login page's "Try Demo" logs every visitor into ONE shared demo account
(see `auth_service.create_demo_session` / `GLOBAL_DEMO_EMAIL`) instead of
minting a throwaway per click. That single account accumulates everyone's
trades, so it must be flattened and re-funded on a schedule — otherwise its
open positions never close and the books drift. `reset_global_demo` does that
full wipe + ₹50L restore; `main.py` calls it every 24h via `demo_reset_loop`.
"""

from __future__ import annotations

import logging

from bson import Decimal128

from app.models.order import Order
from app.models.position import Position
from app.models.trade import Trade
from app.models.transaction import TransactionStatus, TransactionType, WalletTransaction
from app.models.user import User
from app.services import wallet_service

logger = logging.getLogger(__name__)

_DEMO_FUND = Decimal128("5000000")  # ₹50,00,000 virtual demo balance
_ZERO = Decimal128("0")


async def _reset_demo_user(user: User) -> None:
    """Flatten one demo account and restore its ₹50L virtual balance."""
    uid = user.id
    # Full wipe — a clean slate every cycle keeps the account light (open demo
    # trades were never closing and piling up).
    await Position.find(Position.user_id == uid).delete()
    await Order.find(Order.user_id == uid).delete()
    await Trade.find(Trade.user_id == uid).delete()
    await WalletTransaction.find(WalletTransaction.user_id == uid).delete()

    wallet = await wallet_service.get_or_create(uid)
    wallet.available_balance = _DEMO_FUND
    wallet.used_margin = _ZERO
    wallet.settlement_outstanding = _ZERO
    wallet.version = (wallet.version or 0) + 1
    await wallet.save()

    await WalletTransaction(
        user_id=uid,
        transaction_type=TransactionType.BONUS,
        amount=_DEMO_FUND,
        balance_before=_ZERO,
        balance_after=_DEMO_FUND,
        narration="Demo daily reset — ₹50,00,000 virtual balance restored",
        status=TransactionStatus.COMPLETED,
    ).insert()


async def reset_global_demo() -> dict:
    """Flatten EVERY demo account (the platform demo + each admin's own
    universal demo) and restore each one's ₹50L virtual balance.

    Idempotent — safe to call repeatedly. No-op when no demo account has been
    provisioned yet (nobody has clicked Try Demo anywhere).
    """
    users = await User.find(User.is_demo == True).to_list()  # noqa: E712
    if not users:
        return {"reset": False, "reason": "no demo accounts provisioned yet"}

    reset_count = 0
    for user in users:
        try:
            await _reset_demo_user(user)
            reset_count += 1
        except Exception:
            logger.exception("demo_reset_failed user=%s", user.id)

    summary = {"reset": True, "accounts_reset": reset_count, "demo_accounts": len(users)}
    logger.info("demo_reset_done", extra=summary)
    return summary


async def demo_reset_loop(*, interval_sec: float = 3600.0) -> None:
    """Reset the shared demo every 24h.

    Polls hourly (the supervisor/leader wrapper in main.py owns the lifecycle)
    and fires `reset_global_demo` only once a full day has elapsed since the
    last reset. The "last reset" timestamp lives in Redis, so the 24h cadence
    survives process restarts/redeploys instead of restarting from boot. On
    the very first run (no timestamp yet) it resets immediately, then settles
    into the daily rhythm.
    """
    import asyncio
    import time

    from app.core.redis_client import cache_get, cache_set

    _KEY = "demo:last_reset_ts"
    _DAY = 24 * 3600

    while True:
        try:
            rec = await cache_get(_KEY)
            last = float(rec.get("ts")) if rec and rec.get("ts") else 0.0
            if time.time() - last >= _DAY:
                await reset_global_demo()
                # Re-read now() AFTER the reset so a long wipe doesn't shorten
                # the next cycle. TTL is 2 days so a stalled cluster re-fires.
                await cache_set(_KEY, {"ts": time.time()}, ttl_sec=_DAY * 2)
        except Exception:
            logger.exception("demo_reset_loop_iteration_failed")
        await asyncio.sleep(interval_sec)
