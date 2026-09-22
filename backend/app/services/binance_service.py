"""Binance public market-data feed for CRYPTO symbols.

Free, no-API-key WebSocket (``wss://stream.binance.com``) that streams realtime
last / bid / ask / OHLC for crypto pairs (BTCUSDT, ETHUSDT…). Wired in as a
CRYPTO-ONLY overlay source that takes priority over Infoway when
``BINANCE_CRYPTO_FEED=true`` — forex / metals / energy stay on Infoway,
untouched.

Same in-memory-cache shape as ``infoway_service``: ``get_tick(symbol)`` returns
the latest ``{ltp, bid, ask, change, change_pct, volume, open, high, low,
close_24h}`` so ``market_data_service._infoway_overlay`` can merge it
identically. Ticks are keyed by the Binance symbol (BTCUSDT); the overlay's
``get_tick(sym) or get_tick(sym + "T")`` fallback maps platform ``BTCUSD`` →
``BTCUSDT`` automatically. Only the symbols we actually subscribe (crypto) ever
resolve here, so a forex/metal lookup returns ``None`` and cleanly falls back to
Infoway.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any

import websockets

from app.core.config import settings

logger = logging.getLogger(__name__)

_WS_BASE = "wss://stream.binance.com:9443/stream"
_STALE_RX_TIMEOUT_SEC = 30      # no frame this long → force reconnect (half-open heal)
_RECONNECT_CAP_SEC = 60
_STABLE_CONNECTION_SEC = 30     # stayed up this long → reset backoff to fast retry
# Reject a lone tick that jumps more than this fraction vs the previous price —
# a garbage print. Mirrors infoway_service / zerodha_service spike guards.
_MAX_TICK_SPIKE_PCT = 0.5


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


class BinanceFeed:
    """Singleton crypto feed. Lives in the running backend process (leader)."""

    def __init__(self) -> None:
        self._ticks: dict[str, dict[str, Any]] = {}
        self._symbols: list[str] = []
        self._ws: Any = None
        self._connected = False
        self._last_rx = 0.0
        self._stop = False
        self._task: asyncio.Task[Any] | None = None

    # ── public accessors ──────────────────────────────────────────────
    def is_enabled(self) -> bool:
        return bool(getattr(settings, "BINANCE_CRYPTO_FEED", False))

    @property
    def is_connected(self) -> bool:
        return self._connected

    def get_tick(self, symbol: str | None) -> dict[str, Any] | None:
        if not symbol:
            return None
        return self._ticks.get(symbol.upper())

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {
            "enabled": self.is_enabled(),
            "connected": self._connected,
            "symbols": self._symbols,
            "tick_count": len(self._ticks),
            "last_rx_age_sec": round(now - self._last_rx, 1) if self._last_rx else None,
        }

    def _resolve_symbols(self) -> list[str]:
        raw = (getattr(settings, "BINANCE_CRYPTO_SYMBOLS", "") or "").strip()
        if not raw:
            # Fall back to the crypto list Infoway already uses — same Binance
            # USDT-pair names (BTCUSDT, ETHUSDT…), so no extra config needed.
            raw = getattr(settings, "INFOWAY_DEFAULT_CRYPTO", "") or ""
        seen: set[str] = set()
        out: list[str] = []
        for s in (x.strip().upper() for x in raw.split(",")):
            if s and s not in seen:
                seen.add(s)
                out.append(s)
        return out

    # ── lifecycle ─────────────────────────────────────────────────────
    async def start(self) -> None:
        if not self.is_enabled():
            logger.info("binance_feed_skipped: BINANCE_CRYPTO_FEED not set")
            return
        self._symbols = self._resolve_symbols()
        if not self._symbols:
            logger.warning("binance_feed_no_symbols_configured")
            return
        self._stop = False
        self._task = asyncio.create_task(self._run_loop(), name="binance_feed")
        logger.info("binance_feed_started symbols=%s", ",".join(self._symbols))

    async def stop(self) -> None:
        self._stop = True
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _run_loop(self) -> None:
        backoff = 1
        while not self._stop:
            connect_started = time.monotonic()
            try:
                await self._connect_once()
            except asyncio.CancelledError:
                break
            except Exception as e:  # noqa: BLE001
                logger.warning("binance_ws_error: %s", e)
            finally:
                self._connected = False
            if self._stop:
                break
            # Reset backoff only if the connection did real work before dropping.
            if time.monotonic() - connect_started >= _STABLE_CONNECTION_SEC:
                backoff = 1
            ceiling = min(backoff, _RECONNECT_CAP_SEC)
            wait = ceiling / 2 + random.uniform(0, ceiling / 2)  # full jitter
            await asyncio.sleep(wait)
            backoff = min(backoff * 2, _RECONNECT_CAP_SEC)

    async def _connect_once(self) -> None:
        # Combined stream: per symbol we take THREE streams so the price moves in
        # REAL TIME (sub-second), not once a second:
        #   @aggTrade   → last traded price; fires on every trade (fast)
        #   @bookTicker → best bid/ask; fires on every top-of-book change (fast)
        #   @ticker     → 24h change% / volume / OHLC (1 s cadence — fine for
        #                 these slow-moving stats)
        # The tick_loop (0.1 s) samples the resulting in-memory quote, so clients
        # get up to ~10 fresh updates/sec while the Binance msg flood stays cheap
        # (just an in-memory dict write).
        parts: list[str] = []
        for s in self._symbols:
            sl = s.lower()
            parts.append(f"{sl}@aggTrade")
            parts.append(f"{sl}@bookTicker")
            parts.append(f"{sl}@ticker")
        streams = "/".join(parts)
        url = f"{_WS_BASE}?streams={streams}"
        async with websockets.connect(
            url,
            ping_interval=20,   # our client-ping keeps the link warm; lib auto-pongs Binance pings
            ping_timeout=20,
            close_timeout=5,
            max_size=2**20,
        ) as ws:
            self._ws = ws
            self._connected = True
            self._last_rx = time.monotonic()
            logger.info("binance_ws_connected symbols=%d", len(self._symbols))
            wd = asyncio.create_task(self._watchdog(ws), name="binance_watchdog")
            try:
                async for raw in ws:
                    self._last_rx = time.monotonic()
                    if self._stop:
                        break
                    try:
                        msg = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
                    except Exception:
                        continue
                    self._handle(msg)
            finally:
                wd.cancel()
                try:
                    await wd
                except (asyncio.CancelledError, Exception):
                    pass

    async def _watchdog(self, ws: Any) -> None:
        # Force a reconnect if the socket goes silent (half-open) so a wedged
        # connection self-heals instead of freezing crypto prices at last value.
        while True:
            await asyncio.sleep(10)
            if time.monotonic() - self._last_rx > _STALE_RX_TIMEOUT_SEC:
                logger.warning("binance_stale_rx_forcing_reconnect")
                try:
                    await ws.close()
                except Exception:
                    pass
                return

    def _handle(self, msg: dict[str, Any]) -> None:
        stream = msg.get("stream") if isinstance(msg, dict) else None
        data = msg.get("data") if isinstance(msg, dict) else None
        if not isinstance(data, dict) or not stream:
            return
        sym = str(data.get("s") or "").upper()
        if not sym:
            return
        t = self._ticks.setdefault(sym, {})

        if stream.endswith("@aggTrade"):
            # Real-time last traded price.
            price = _f(data.get("p"))
            if price <= 0:
                return
            prev = _f(t.get("ltp"))
            if prev > 0 and abs(price - prev) / prev > _MAX_TICK_SPIKE_PCT:
                logger.warning(
                    "binance_bad_tick_skipped sym=%s prev=%s new=%s", sym, prev, price
                )
                return
            t["ltp"] = price
            if "change" in t:
                t["close_24h"] = price - _f(t.get("change"))
        elif stream.endswith("@bookTicker"):
            # Real-time best bid/ask.
            b = _f(data.get("b"))
            a = _f(data.get("a"))
            if b > 0:
                t["bid"] = b
            if a > 0:
                t["ask"] = a
        elif stream.endswith("@ticker"):
            # 24h rolling stats (1 s cadence) — change / volume / OHLC.
            t["change"] = _f(data.get("p"))
            t["change_pct"] = _f(data.get("P"))
            t["volume"] = _f(data.get("v"))
            t["open"] = _f(data.get("o"))
            t["high"] = _f(data.get("h"))
            t["low"] = _f(data.get("l"))
            # Seed ltp from the ticker's close if no @aggTrade has arrived yet,
            # so the overlay has a price to show from the very first frame.
            c = _f(data.get("c"))
            if c > 0 and not t.get("ltp"):
                t["ltp"] = c
            if t.get("ltp"):
                t["close_24h"] = _f(t.get("ltp")) - _f(t.get("change"))
        else:
            return
        t["ts"] = time.time()


binance = BinanceFeed()


# ── Crypto OPTIONS feed (Binance EAPI) ──────────────────────────────────
# Binance options are a SEPARATE API from spot (eapi.binance.com, symbols like
# BTC-260925-145000-C). Options have hundreds of strikes with slow-moving,
# often-illiquid prices, so instead of managing thousands of WS subscriptions
# we REST-poll `/eapi/v1/mark` — one call returns the fresh fair MARK PRICE for
# every listed contract. Mark price (not the thin last-trade) is the right B-book
# reference: it's always available for every strike and can't be skewed by a
# stale illiquid print. The admin's per-segment spread synthesises buy/sell from
# it (same crypto spread model as spot). Runs in the `global` feed process.
_OPT_MARK_URL = "https://eapi.binance.com/eapi/v1/mark"
_OPT_POLL_SEC = 3.0             # mark prices move slowly; 3s is plenty for options
_OPT_ERR_CAP_SEC = 30


class BinanceOptionsFeed:
    """Singleton crypto-options mark-price feed (REST poll of Binance EAPI).

    Same in-memory contract as ``BinanceFeed``: ``get_tick(symbol)`` returns the
    latest ``{ltp, bid, ask, mark_iv, delta, ts}`` keyed by the exact option
    symbol (``BTC-260925-145000-C``), so ``market_data_service._infoway_overlay``
    merges it identically. Only symbols whose underlying is in the configured
    prefix set (BTC/ETH by default) are stored.
    """

    def __init__(self) -> None:
        self._ticks: dict[str, dict[str, Any]] = {}
        self._stop = False
        self._task: asyncio.Task[Any] | None = None
        self._connected = False
        self._last_rx = 0.0

    def is_enabled(self) -> bool:
        return bool(getattr(settings, "BINANCE_OPTIONS_FEED", False))

    @property
    def is_connected(self) -> bool:
        return self._connected

    def get_tick(self, symbol: str | None) -> dict[str, Any] | None:
        if not symbol:
            return None
        return self._ticks.get(symbol.upper())

    def _prefixes(self) -> tuple[str, ...]:
        raw = (getattr(settings, "BINANCE_OPTIONS_UNDERLYINGS", "") or "").strip()
        assets = [a.strip().upper() for a in raw.split(",") if a.strip()] or ["BTC", "ETH"]
        return tuple(f"{a}-" for a in assets)

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {
            "enabled": self.is_enabled(),
            "connected": self._connected,
            "tick_count": len(self._ticks),
            "last_rx_age_sec": round(now - self._last_rx, 1) if self._last_rx else None,
        }

    async def start(self) -> None:
        if not self.is_enabled():
            logger.info("binance_options_feed_skipped: BINANCE_OPTIONS_FEED not set")
            return
        self._stop = False
        self._task = asyncio.create_task(self._run_loop(), name="binance_options_feed")
        logger.info("binance_options_feed_started")

    async def stop(self) -> None:
        self._stop = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _run_loop(self) -> None:
        import httpx

        prefixes = self._prefixes()
        backoff = 1
        async with httpx.AsyncClient(timeout=15.0) as client:
            while not self._stop:
                try:
                    r = await client.get(_OPT_MARK_URL)
                    r.raise_for_status()
                    self._ingest(r.json(), prefixes)
                    self._connected = True
                    self._last_rx = time.monotonic()
                    backoff = 1
                    await asyncio.sleep(_OPT_POLL_SEC)
                except asyncio.CancelledError:
                    break
                except Exception as e:  # noqa: BLE001
                    self._connected = False
                    logger.warning("binance_options_poll_error: %s", e)
                    await asyncio.sleep(min(backoff, _OPT_ERR_CAP_SEC))
                    backoff = min(backoff * 2, _OPT_ERR_CAP_SEC)

    def _ingest(self, data: Any, prefixes: tuple[str, ...]) -> None:
        if not isinstance(data, list):
            return
        now = time.time()
        for row in data:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("symbol") or "").upper()
            if not sym.startswith(prefixes):
                continue
            mp = _f(row.get("markPrice"))
            if mp <= 0:
                continue  # keep the last good price; never overwrite with 0
            t = self._ticks.setdefault(sym, {})
            t["ltp"] = mp
            # No real order-book from the mark endpoint — leave bid/ask = mark so
            # the admin's segment spread (mid ± half) synthesises both sides.
            t["bid"] = mp
            t["ask"] = mp
            t["mark_iv"] = _f(row.get("markIV"))
            t["delta"] = _f(row.get("delta"))
            t["ts"] = now


binance_options = BinanceOptionsFeed()
