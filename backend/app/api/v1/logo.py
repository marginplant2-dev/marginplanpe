"""Public instrument-logo proxy.

``GET /api/v1/logo/{symbol}`` serves a company logo SVG for an instrument from
our own origin (never hotlinking the vendor): one place to change the source,
one cache, and a vendor blocking us costs a row of initials — not a row of
broken images. Unauthenticated by design: an ``<img>`` can't send an auth
header, and logos are not user-scoped.

Mounted at ``/api/v1`` from ``app/main.py``. See ``services/logo_service.py``.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.config import settings
from app.services import logo_service

router = APIRouter(prefix="/logo", tags=["logo"])

# Even if a safety check is ever missed, opening the URL directly runs nothing.
_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
_HEADERS_200 = {
    "Cache-Control": "public, max-age=86400",
    "Content-Security-Policy": _CSP,
    "X-Content-Type-Options": "nosniff",
}
# Cache the negative result too, so a screen full of unknown names doesn't
# re-request every render.
_HEADERS_MISS = {"Cache-Control": "public, max-age=86400"}


def _normalize(symbol: str) -> str:
    # Rows pass a bare symbol, but strip an "EXCHANGE:" prefix defensively.
    return (symbol or "").split(":")[-1].strip().upper()


@router.get("/{symbol}")
async def get_logo(symbol: str) -> Response:
    if not settings.LOGO_PROXY_ENABLED:
        return Response(status_code=404, headers=_HEADERS_MISS)

    sym = _normalize(symbol)
    if not logo_service.is_valid_symbol(sym):
        # Cache the rejection so a bad src isn't re-hit on every render.
        return Response(status_code=400, headers=_HEADERS_MISS)

    svg = await logo_service.get_logo_svg(sym)
    if svg is None:
        return Response(status_code=404, headers=_HEADERS_MISS)
    return Response(content=svg, media_type="image/svg+xml", headers=_HEADERS_200)
