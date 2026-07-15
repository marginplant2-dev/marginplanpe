"""Daily instrument-expiry cleanup.

Background loop that runs every hour and applies the same rule the user
asked for:

    Expiry day  → instrument still shows / trades normally
    Day after   → instrument is removed from every user's watchlist,
                  unsubscribed from Zerodha, and marked inactive in the
                  Instrument collection so search stops returning it.

Idempotent — running twice in a row is a no-op once everything has been
swept. The loop exists so admins don't have to remember to nuke yesterday's
expired option chain manually.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone

from app.models.instrument import Instrument
from app.models.watchlist import WatchlistItem

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

_running = False

# ── Symbol-derived expiry (fallback for null Instrument.expiry) ──────────
_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
# Zerodha weekly single-char month codes for Oct/Nov/Dec (Jan-Sep use digit).
_WEEK_MONTH = {"O": 10, "N": 11, "D": 12}
_MONTHLY_FUT_RE = re.compile(
    r"^[A-Z&]+?(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$"
)
_MONTHLY_OPT_RE = re.compile(
    r"^[A-Z&]+?(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)(CE|PE)$"
)
_WEEKLY_OPT_RE = re.compile(r"^[A-Z&]+?(\d{2})([1-9OND])(\d{2})(\d+)(CE|PE)$")


def _month_end(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def parse_symbol_expiry(symbol: str | None) -> date | None:
    """Best-effort expiry date from an F&O trading symbol — used ONLY as a
    fallback when Instrument.expiry is null. Returns None unless the symbol
    matches a known high-confidence pattern, so a parse miss NEVER removes an
    instrument (it just leaves it untouched).

    Formats:
      • Monthly future  CRUDEOIL26JULFUT   → month-end (safe upper bound)
      • Monthly option  NIFTY26JUL24000CE  → month-end
      • Weekly option   SENSEX2670276900CE → exact 2026-07-02
        (UND · YY · M · DD · STRIKE · CE/PE; M = 1-9 or O/N/D)
    """
    if not symbol:
        return None
    s = symbol.upper().strip()
    m = _MONTHLY_FUT_RE.match(s)
    if m:
        return _month_end(2000 + int(m.group(1)), _MONTHS[m.group(2)])
    m = _MONTHLY_OPT_RE.match(s)
    if m:
        return _month_end(2000 + int(m.group(1)), _MONTHS[m.group(2)])
    m = _WEEKLY_OPT_RE.match(s)
    if m:
        year = 2000 + int(m.group(1))
        mc = m.group(2)
        month = int(mc) if mc.isdigit() else _WEEK_MONTH[mc]
        day = int(m.group(3))
        try:
            return date(year, month, day)
        except ValueError:
            return None
    return None


def _ist_today_date():
    """Indian trading-day boundary. We compare against IST midnight, not
    UTC, so a contract expiring on Thursday 'survives' through to Friday
    morning 00:00 IST regardless of the host machine's timezone."""
    return datetime.now(IST).date()


async def cleanup_expired_once() -> dict[str, int]:
    """Single sweep. Returns counts so the caller can log what changed.

    Strategy:
      • cutoff_date = today_IST - 1 day. Anything with `expiry < today_IST`
        is "yesterday or earlier" → cleanup target.
      • For each expired Instrument:
          - delete every WatchlistItem that references its token (across all
            users — there's no per-user opt-out for an expired contract)
          - unsubscribe the token from the Zerodha live ticker (skipped for
            non-Kite tokens)
          - mark the Instrument is_active=False so /instruments/search stops
            returning it. We DON'T hard-delete — historical orders / trades
            still reference these tokens.
    """
    today = _ist_today_date()

    # A) Instruments that already carry a real expiry date.
    expired = await Instrument.find(
        {"expiry": {"$ne": None, "$lt": today}, "is_active": True}
    ).to_list()

    # B) Fallback for F&O rows whose `expiry` was never populated (seed gap):
    #    derive it from the trading symbol (SENSEX2670276900CE → 2026-07-02).
    #    Without this a null-expiry weekly option lingers in search + every
    #    user's favorites forever, showing a stale index-fallback price and a
    #    "no live session" toast (operator-flagged). We also backfill the
    #    parsed date onto the doc so search/expiry filters + the next sweep
    #    see a real value. A symbol we can't confidently parse is left alone.
    seen_ids = {i.id for i in expired}
    null_expiry_fno = await Instrument.find(
        {
            "expiry": None,
            "is_active": True,
            "segment": {"$regex": "OPT|FUT", "$options": "i"},
        }
    ).to_list()
    backfilled = 0
    for inst in null_expiry_fno:
        parsed = parse_symbol_expiry(inst.symbol)
        if parsed is None:
            continue
        try:
            inst.expiry = parsed
            await inst.save()
            backfilled += 1
        except Exception:
            logger.exception(
                "expiry_cleanup_backfill_failed", extra={"symbol": inst.symbol}
            )
        if parsed < today and inst.id not in seen_ids:
            expired.append(inst)
            seen_ids.add(inst.id)

    if not expired:
        return {
            "instruments": 0,
            "watchlist_items": 0,
            "unsubscribed": 0,
            "positions_settled": 0,
            "expiry_backfilled": backfilled,
        }

    expired_tokens = [str(i.token) for i in expired if i.token]
    expired_symbols = [i.symbol for i in expired if i.symbol]

    # 0) Settle any OPEN positions in these expired contracts FIRST — before
    #    we unsubscribe their tokens below. An expired contract no longer
    #    trades; once its token is unsubscribed the risk-enforcer can never
    #    price it, so it silently skips SL/TP/stop-out and the position would
    #    sit OPEN forever holding the user's margin (the risk_ltp_fetch_failed
    #    "zombie position" flood). settle_expired_position books realized P&L
    #    at the last-known price, releases the margin and flips the row CLOSED.
    #    Settling here (token still subscribed on the first sweep) gives the
    #    best chance of a fresh live price; it falls back to the position's
    #    frozen `ltp` otherwise.
    settled = 0
    from app.models.position import Position, PositionStatus
    from app.services import position_service

    open_in_expired = await Position.find(
        {
            "status": PositionStatus.OPEN.value,
            "instrument.token": {"$in": expired_tokens},
        }
    ).to_list()
    for _pos in open_in_expired:
        try:
            if await position_service.settle_expired_position(_pos) == "settled":
                settled += 1
        except Exception:  # noqa: BLE001
            logger.exception(
                "expiry_cleanup_settle_failed", extra={"position_id": str(_pos.id)}
            )

    # 1) Yank from every user's watchlist — by token AND by symbol. Symbol is
    #    the belt-and-braces path: a favorite whose stored instrument_token
    #    drifted from the Instrument doc's token (duplicate/re-seeded rows)
    #    would survive a token-only delete and keep showing the dead contract.
    wl_removed = 0
    if expired_tokens:
        wl_result = await WatchlistItem.find(
            {"instrument_token": {"$in": expired_tokens}}
        ).delete()
        wl_removed += getattr(wl_result, "deleted_count", 0) or 0
    if expired_symbols:
        wl_result_sym = await WatchlistItem.find(
            {"symbol": {"$in": expired_symbols}}
        ).delete()
        wl_removed += getattr(wl_result_sym, "deleted_count", 0) or 0

    # 2) Unsubscribe from Zerodha — only for numeric Kite tokens
    int_tokens: list[int] = []
    for t in expired_tokens:
        try:
            int_tokens.append(int(t))
        except (TypeError, ValueError):
            pass
    unsubbed = 0
    if int_tokens:
        try:
            from app.services.zerodha_service import zerodha
            unsubbed = await zerodha.unsubscribe_tokens_on_demand(int_tokens)
        except Exception:
            logger.exception("expiry_cleanup_zerodha_unsubscribe_failed")

    # 3) Mark inactive so search stops returning them
    for inst in expired:
        try:
            inst.is_active = False
            inst.is_tradable = False
            await inst.save()
        except Exception:
            logger.exception(
                "expiry_cleanup_instrument_save_failed", extra={"token": inst.token}
            )

    logger.info(
        "expiry_cleanup_swept",
        extra={
            "instruments": len(expired),
            "watchlist_items_removed": wl_removed,
            "tokens_unsubscribed": unsubbed,
            "positions_settled": settled,
            "expiry_backfilled": backfilled,
            "cutoff_date": str(today),
        },
    )
    return {
        "instruments": len(expired),
        "watchlist_items": wl_removed,
        "unsubscribed": unsubbed,
        "positions_settled": settled,
        "expiry_backfilled": backfilled,
    }


async def expiry_cleanup_loop(interval_sec: float = 3600.0) -> None:
    """Hourly sweep. An hourly cadence is enough because expiry happens at
    instrument granularity (date), not minute — but it's frequent enough
    that users never see day-old contracts after the boundary. Idempotent
    — second call returns immediately."""
    global _running
    if _running:
        return
    _running = True
    logger.info("expiry_cleanup_loop_started", extra={"interval_sec": interval_sec})
    try:
        # First sweep happens immediately on boot — picks up anything that
        # expired while the server was down.
        try:
            await cleanup_expired_once()
        except Exception:
            logger.exception("expiry_cleanup_initial_sweep_failed")
        while _running:
            await asyncio.sleep(interval_sec)
            try:
                await cleanup_expired_once()
            except Exception:
                logger.exception("expiry_cleanup_tick_failed")
    finally:
        _running = False
        logger.info("expiry_cleanup_loop_stopped")


def stop_expiry_cleanup() -> None:
    global _running
    _running = False
