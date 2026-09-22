"""Crypto options (Binance BTC/ETH) — instrument catalog sync + expiry settle.

Binance option contracts (``BTC-260925-145000-C``) are mirrored into the
``instruments`` collection so the existing option-chain DB-fallback
(``zerodha_service.get_option_chain_fast``) can build a chain from them and the
order/matching stack treats them like any other option. Prices come from the
``BinanceOptionsFeed`` (mark price) via ``market_data_service.get_ltp`` — the
instrument ``token`` IS the Binance symbol so the feed overlay resolves it.

Two jobs:
  • ``sync_instruments()`` — upsert the catalog (run on boot + hourly).
  • ``settle_due_expiries()`` — close open positions the instant a contract's
    UTC expiry timestamp passes (crypto expires intraday, 24×7 — not a
    trading-day boundary), reusing ``position_service.settle_expired_position``.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
from bson import Decimal128

from app.models._base import Exchange, InstrumentType, OptionType
from app.models.instrument import Instrument

logger = logging.getLogger(__name__)

_EXCHANGE_INFO_URL = "https://eapi.binance.com/eapi/v1/exchangeInfo"

# Instrument.segment carried on every crypto option doc — resolves to the
# CRYPTO_OPT admin row via netting_service._SEGMENT_NAME_MAP and passes the
# "CRYPTO" (spread) + "OPTION" (option margin/strike) contain-checks.
CRYPTO_OPTION_SEGMENT = "CRYPTO_OPTION"

# Underlying base asset → spot token used as `underlying_token` (live BTC/ETH
# spot for order-time strike-distance checks). The option's own mark price is
# what marks the position; the underlying is only for strike validation.
CRYPTO_OPTION_UNDERLYINGS: dict[str, str] = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}

# Only seed contracts expiring within this many days — Binance lists ~800 BTC
# strikes across a year; a bounded window keeps the catalog + chain sane. The
# admin's per-pool "expiry days" display filter narrows it further at read time.
_SEED_MAX_DAYS = 120


def _parse_symbol(sym: str) -> tuple[str, date, float, str] | None:
    """``BTC-260925-145000-C`` → (base, expiry_date, strike, "CE"|"PE")."""
    parts = sym.split("-")
    if len(parts) != 4:
        return None
    base, ymd, strike, cp = parts
    try:
        exp = datetime.strptime(ymd, "%y%m%d").date()
        strike_f = float(strike)
    except (ValueError, TypeError):
        return None
    ot = "CE" if cp.upper().startswith("C") else "PE"
    return base.upper(), exp, strike_f, ot


def expiry_datetime_utc(exp: date) -> datetime:
    """Binance options settle at 08:00 UTC on the expiry date."""
    return datetime(exp.year, exp.month, exp.day, 8, 0, 0, tzinfo=timezone.utc)


async def sync_instruments(max_days: int = _SEED_MAX_DAYS) -> dict[str, Any]:
    """Upsert BTC/ETH option Instrument docs from Binance exchangeInfo; retire
    (deactivate) any previously-seeded crypto option no longer listed / expired.
    Idempotent — safe to run repeatedly."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(_EXCHANGE_INFO_URL)
            r.raise_for_status()
            info = r.json()
    except Exception as e:  # noqa: BLE001
        logger.warning("crypto_options_exchangeinfo_failed: %s", e)
        return {"upserts": 0, "active": 0, "retired": 0, "error": str(e)[:200]}

    symbols = info.get("optionSymbols") or []
    today = date.today()
    seen: set[str] = set()
    upserts = 0
    for s in symbols:
        sym = str(s.get("symbol") or "").upper()
        parsed = _parse_symbol(sym)
        if not parsed:
            continue
        base, exp, strike_f, ot = parsed
        if base not in CRYPTO_OPTION_UNDERLYINGS:
            continue
        if exp < today or (exp - today).days > max_days:
            continue
        seen.add(sym)
        und_tok = CRYPTO_OPTION_UNDERLYINGS[base]
        try:
            lot = int(float(s.get("unit") or 1)) or 1
        except (ValueError, TypeError):
            lot = 1
        tick = None
        for f in s.get("filters") or []:
            if isinstance(f, dict) and f.get("filterType") == "PRICE_FILTER":
                tick = f.get("tickSize")
        it = InstrumentType.CE if ot == "CE" else InstrumentType.PE
        opt = OptionType.CE if ot == "CE" else OptionType.PE
        strike_d = Decimal128(str(strike_f))
        existing = await Instrument.find_one(Instrument.token == sym)
        if existing is not None:
            existing.is_active = True
            existing.is_tradable = True
            existing.strike = strike_d
            existing.expiry = exp
            existing.underlying_token = und_tok
            existing.segment = CRYPTO_OPTION_SEGMENT
            await existing.save()
        else:
            await Instrument(
                token=sym,
                symbol=sym,
                trading_symbol=sym,
                name=base,  # option-chain groups by name == underlying
                exchange=Exchange.CRYPTO,
                segment=CRYPTO_OPTION_SEGMENT,
                instrument_type=it,
                option_type=opt,
                strike=strike_d,
                expiry=exp,
                underlying_token=und_tok,
                lot_size=lot,
                tick_size=Decimal128(str(tick)) if tick else Decimal128("0.1"),
            ).insert()
        upserts += 1

    # Retire crypto options no longer offered (expired / rolled off / outside
    # the window) so they drop out of the chain + search.
    retired = 0
    async for d in Instrument.find(
        {"segment": CRYPTO_OPTION_SEGMENT, "is_active": True}
    ):
        if d.token not in seen:
            d.is_active = False
            d.is_tradable = False
            await d.save()
            retired += 1

    logger.info(
        "crypto_options_synced", extra={"upserts": upserts, "active": len(seen), "retired": retired}
    )
    return {"upserts": upserts, "active": len(seen), "retired": retired}


async def settle_due_expiries() -> int:
    """Close every OPEN position whose crypto option has passed its UTC expiry
    timestamp (08:00 UTC on the expiry date). Crypto expires intraday, 24×7 —
    so this is timestamp-driven, unlike the date-day-after expiry_cleanup sweep.
    Reuses ``position_service.settle_expired_position`` (books P&L at LTP,
    releases margin). Idempotent — settle_expired_position no-ops on non-OPEN."""
    from app.models.position import Position, PositionStatus
    from app.services import position_service

    now = datetime.now(timezone.utc)
    expired_tokens: list[str] = []
    async for d in Instrument.find(
        {"segment": CRYPTO_OPTION_SEGMENT, "expiry": {"$ne": None}}
    ):
        exp = d.expiry
        if isinstance(exp, datetime):
            exp = exp.date()
        if exp is not None and expiry_datetime_utc(exp) <= now:
            expired_tokens.append(str(d.token))
    if not expired_tokens:
        return 0

    settled = 0
    async for p in Position.find(
        {"status": PositionStatus.OPEN.value, "instrument.token": {"$in": expired_tokens}}
    ):
        try:
            res = await position_service.settle_expired_position(p, reason="CRYPTO_EXPIRY")
            if res == "settled":
                settled += 1
        except Exception:
            logger.exception("crypto_option_settle_failed", extra={"position_id": str(p.id)})
    if settled:
        logger.info("crypto_options_expired_settled", extra={"count": settled})
    return settled


_loop_running = False
_loop_task: Any = None


async def _crypto_options_loop(
    settle_interval_sec: float = 60.0, sync_interval_sec: float = 3600.0
) -> None:
    """Boot-seed + periodic catalog refresh + timestamp expiry settlement.
    Settles due expiries every minute; refreshes the Binance catalog hourly."""
    global _loop_running
    _loop_running = True
    import asyncio as _asyncio
    import time as _time

    last_sync = 0.0
    logger.info("crypto_options_loop_started")
    try:
        while _loop_running:
            try:
                now_m = _time.monotonic()
                if now_m - last_sync >= sync_interval_sec:
                    await sync_instruments()
                    last_sync = now_m
                await settle_due_expiries()
            except _asyncio.CancelledError:
                break
            except Exception:
                logger.exception("crypto_options_loop_tick_failed")
            await _asyncio.sleep(settle_interval_sec)
    finally:
        _loop_running = False
        logger.info("crypto_options_loop_stopped")


async def start_loop() -> None:
    """Start the leader-only maintenance loop (idempotent)."""
    global _loop_task
    if _loop_task is not None and not _loop_task.done():
        return
    import asyncio as _asyncio

    _loop_task = _asyncio.create_task(_crypto_options_loop(), name="crypto_options_loop")


async def stop_loop() -> None:
    global _loop_running, _loop_task
    _loop_running = False
    if _loop_task is not None:
        _loop_task.cancel()
        try:
            await _loop_task
        except Exception:
            pass
        _loop_task = None
