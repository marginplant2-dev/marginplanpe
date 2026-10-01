"""Company-logo resolution for instrument symbols.

No exchange or broker API publishes logos, so we proxy two public symbol-logo
CDNs through our own origin, cache the SVGs on disk (shared across api/worker/
beat), and let the UI degrade to initials when nothing is found. The HTTP
surface lives in ``app/api/v1/logo.py``.

Sources, in order:
  1. Dhan CDN — keyed directly by NSE symbol, covers the large majority.
  2. TradingView — keyed by a company "logoid" we resolve via symbol search,
     taking ONLY the hit whose symbol EXACTLY equals ours. A confidently wrong
     logo (a delisted/renamed ticker is a different company) is worse than none.

Indices are not companies: an explicit hand map (verified TradingView
``indices/<slug>`` logoids) is checked BEFORE any stock source so an index name
never fuzzy-matches a same-named stock.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import time

import httpx

logger = logging.getLogger("logo")

# Path-traversal guard. Real symbols contain & and - (M&M, BAJAJ-AUTO).
SYMBOL_RE = re.compile(r"^[A-Z0-9&_-]{1,24}$")

# Verified (HTTP 200) TradingView index logoids. Value None = a known index
# spelling TradingView has no correct logo for — return initials, never a
# stock fallback (e.g. MIDCPNIFTY fuzzy-resolves to finnifty's logo; BANKEX
# only matches a generic sector icon).
INDEX_LOGOIDS: dict[str, str | None] = {
    "NIFTY": "indices/nifty-50",
    "NIFTY50": "indices/nifty-50",
    "BANKNIFTY": "indices/nifty-bank-index",
    "SENSEX": "indices/bse-sensex",
    "FINNIFTY": "indices/finnifty",
    "MIDCPNIFTY": None,
    "BANKEX": None,
}

_DHAN_URL = "https://s3tv-symbol.dhan.co/symbols/{sym}.svg"
_TV_SEARCH = "https://symbol-search.tradingview.com/symbol_search/v3/"
_TV_LOGO = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"

_MAX_SVG = 200 * 1024          # a logo is a few KB; anything huge is suspect
_MISS_TTL = 24 * 3600          # negative-cache window
_HTTP_TIMEOUT = 8.0
_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# An SVG can carry script, and we serve it from our OWN origin, so it would run
# with our privileges. Reject any body matching these.
_UNSAFE_RE = re.compile(
    rb"<script|javascript:|\son\w+\s*=|<foreignObject|<iframe|<embed|<object",
    re.IGNORECASE,
)
_SVG_ROOT_RE = re.compile(rb"<svg[\s/>]", re.IGNORECASE)


def is_valid_symbol(symbol: str) -> bool:
    return bool(SYMBOL_RE.match(symbol or ""))


def is_safe_svg(body: bytes) -> bool:
    """True only if ``body`` is a plausible, script-free SVG safe to serve from
    our origin. Allows an optional XML prolog / DOCTYPE and leading comments
    (TradingView files start with ``<!-- by TradingView -->``) before <svg>."""
    if not body or len(body) > _MAX_SVG:
        return False
    if _UNSAFE_RE.search(body):
        return False
    head = body
    if head[:3] == b"\xef\xbb\xbf":        # UTF-8 BOM
        head = head[3:]
    head = head.lstrip()
    if head[:5].lower() == b"<?xml":        # prolog
        end = head.find(b"?>")
        if end == -1:
            return False
        head = head[end + 2:].lstrip()
    if head[:9].lower() == b"<!doctype":    # doctype
        end = head.find(b">")
        if end == -1:
            return False
        head = head[end + 1:].lstrip()
    while head[:4] == b"<!--":              # leading comments
        end = head.find(b"-->")
        if end == -1:
            return False
        head = head[end + 3:].lstrip()
    return bool(_SVG_ROOT_RE.match(head))


def parse_tv_logoid(payload: dict, symbol: str) -> str | None:
    """Logoid of the search hit whose symbol EXACTLY equals ``symbol`` (after
    stripping the <em>/</em> tags TradingView injects around matched text).
    Returns None on no exact match — never a fuzzy hit."""
    want = (symbol or "").upper()
    for hit in payload.get("symbols") or []:
        raw = hit.get("symbol") or ""
        clean = raw.replace("<em>", "").replace("</em>", "").strip().upper()
        if clean == want:
            return hit.get("logoid") or (hit.get("logo") or {}).get("logoid") or None
    return None


# ── disk cache ───────────────────────────────────────────────────────────
_cache_dir_resolved: str | None = None


def _cache_dir() -> str:
    global _cache_dir_resolved
    if _cache_dir_resolved:
        return _cache_dir_resolved
    from app.core.config import settings

    candidate = settings.LOGO_CACHE_DIR or os.path.join(
        tempfile.gettempdir(), "marginplant-logos"
    )
    try:
        os.makedirs(candidate, exist_ok=True)
        _cache_dir_resolved = candidate
    except OSError:
        fallback = os.path.join(tempfile.gettempdir(), "marginplant-logos")
        os.makedirs(fallback, exist_ok=True)
        logger.warning(
            "logo_cache_dir_fallback requested=%s using=%s", candidate, fallback
        )
        _cache_dir_resolved = fallback
    return _cache_dir_resolved


def _cached_svg(symbol: str) -> bytes | None:
    try:
        with open(os.path.join(_cache_dir(), f"{symbol}.svg"), "rb") as f:
            return f.read()
    except OSError:
        return None


def _is_missing(symbol: str) -> bool:
    try:
        age = time.time() - os.path.getmtime(
            os.path.join(_cache_dir(), f"{symbol}.missing")
        )
    except OSError:
        return False
    return age < _MISS_TTL


def _store_svg(symbol: str, body: bytes) -> None:
    d = _cache_dir()
    final = os.path.join(d, f"{symbol}.svg")
    tmp = os.path.join(d, f"{symbol}.svg.partial")
    try:
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, final)  # atomic — a concurrent reader never sees half
        try:
            os.remove(os.path.join(d, f"{symbol}.missing"))
        except OSError:
            pass
    except OSError:
        logger.warning("logo_store_failed symbol=%s", symbol, exc_info=True)


def _mark_missing(symbol: str) -> None:
    try:
        # open+write refreshes mtime so the 24h window restarts on each miss
        with open(os.path.join(_cache_dir(), f"{symbol}.missing"), "wb") as f:
            f.write(b"")
    except OSError:
        pass


# ── fetch ────────────────────────────────────────────────────────────────
async def _fetch_svg(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        r = await client.get(
            url,
            headers={"Accept": "image/svg+xml", "User-Agent": _UA},
            follow_redirects=True,
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    return r.content if is_safe_svg(r.content) else None


async def _tv_logoid(client: httpx.AsyncClient, symbol: str) -> str | None:
    try:
        r = await client.get(
            _TV_SEARCH,
            params={"text": symbol, "exchange": "NSE", "search_type": "stocks"},
            headers={"Origin": "https://www.tradingview.com", "User-Agent": _UA},
        )
        if r.status_code != 200:
            return None
        return parse_tv_logoid(r.json(), symbol)
    except Exception:
        return None


async def get_logo_svg(symbol: str) -> bytes | None:
    """Resolve ``symbol`` (already validated + upper-cased by the caller) to SVG
    bytes, or None if unavailable. Serves/stores the disk cache along the way."""
    symbol = symbol.upper()

    cached = _cached_svg(symbol)
    if cached is not None:
        return cached
    if _is_missing(symbol):
        return None

    # Index — checked before any stock source.
    if symbol in INDEX_LOGOIDS:
        logoid = INDEX_LOGOIDS[symbol]
        body = None
        if logoid:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                body = await _fetch_svg(client, _TV_LOGO.format(logoid=logoid))
        if body:
            _store_svg(symbol, body)
            return body
        _mark_missing(symbol)
        return None

    # Stock: Dhan first, then TradingView exact-match.
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        body = await _fetch_svg(client, _DHAN_URL.format(sym=symbol))
        if body:
            _store_svg(symbol, body)
            return body
        logoid = await _tv_logoid(client, symbol)
        if logoid:
            body = await _fetch_svg(client, _TV_LOGO.format(logoid=logoid))
            if body:
                _store_svg(symbol, body)
                return body

    _mark_missing(symbol)
    return None
