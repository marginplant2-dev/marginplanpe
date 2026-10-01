"""Location-radius blocking — ban every IP that geolocates within a circle.

Super-admin enters an IP (or a lat/long) + a radius; we store the centre and, on
the whole-site gate, block any visitor whose IP geolocates inside any active
circle. IP geolocation is CITY-LEVEL and approximate (~10–50km error, worse for
mobile/CG-NAT/VPN) — a tight radius is best-effort, not exact. See GeoBlock.

GeoIP lookups use a local DB-IP/MaxMind .mmdb via geoip2 (in-process, fast). If
the DB file is absent, geo blocking is silently disabled.
"""

from __future__ import annotations

import logging
import math
import time

from beanie import PydanticObjectId

from app.core.config import settings
from app.models.geo_block import GeoBlock

logger = logging.getLogger("geo_block")

_reader = None
_reader_tried = False


def _get_reader():
    """Lazy-open the GeoIP reader once. Returns None if unavailable (no DB file
    / lib) so callers degrade to 'no geo info' instead of erroring."""
    global _reader, _reader_tried
    if _reader_tried:
        return _reader
    _reader_tried = True
    path = settings.GEOIP_DB_PATH
    if not path:
        return None
    try:
        import geoip2.database

        _reader = geoip2.database.Reader(path)
    except Exception as e:  # noqa: BLE001
        logger.warning("geoip_reader_unavailable path=%s err=%s", path, e)
        _reader = None
    return _reader


def geo_enabled() -> bool:
    return _get_reader() is not None


def latlong(ip: str) -> tuple[float, float] | None:
    """(lat, lon) for an IP, or None (private/unknown/unavailable)."""
    reader = _get_reader()
    if reader is None or not ip:
        return None
    try:
        c = reader.city(ip.strip())
    except Exception:
        return None
    lat, lon = c.location.latitude, c.location.longitude
    if lat is None or lon is None:
        return None
    return float(lat), float(lon)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in km between two (lat, lon) points."""
    r = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ── cached GLOBAL geo-block centres (for the whole-site gate) ───────────────
_CENTERS_TTL = 20.0
_centers_cache: tuple[float, list[tuple[float, float, float]]] | None = None  # (ts, [(lat,lon,radius)])


def _invalidate_centers_cache() -> None:
    global _centers_cache
    _centers_cache = None


async def _load_centers() -> list[tuple[float, float, float]]:
    out: list[tuple[float, float, float]] = []
    async for g in GeoBlock.find({"admin_id": None}):
        out.append((g.center_lat, g.center_lon, g.radius_km or 15.0))
    return out


async def is_geo_blocked(ip: str) -> bool:
    """True when `ip` geolocates inside any GLOBAL geo-block circle. Cached ~20s.
    Degrades to False when GeoIP is unavailable or the IP has no location."""
    global _centers_cache
    if not geo_enabled():
        return False
    now = time.time()
    if _centers_cache is None or now - _centers_cache[0] > _CENTERS_TTL:
        _centers_cache = (now, await _load_centers())
    centers = _centers_cache[1]
    if not centers:
        return False
    pt = latlong(ip)
    if pt is None:
        return False
    for lat, lon, radius in centers:
        if haversine_km(pt, (lat, lon)) <= radius:
            return True
    return False


# ── CRUD ────────────────────────────────────────────────────────────────
async def add(
    admin_id: PydanticObjectId | None,
    *,
    ip: str | None,
    lat: float | None,
    lon: float | None,
    radius_km: float,
    reason: str | None,
    created_by: PydanticObjectId | None,
    created_by_name: str | None,
) -> GeoBlock:
    """Add a geo-block. Either `ip` (geolocated to a centre) OR explicit
    lat/lon. Raises ValueError if neither resolves to a location."""
    label = None
    if lat is None or lon is None:
        if not ip:
            raise ValueError("Enter an IP or a latitude/longitude.")
        pt = latlong(ip)
        if pt is None:
            raise ValueError(
                "Could not locate that IP (private/unknown, or GeoIP DB missing)."
            )
        lat, lon = pt
        label = ip.strip()
    row = GeoBlock(
        admin_id=admin_id,
        center_lat=float(lat),
        center_lon=float(lon),
        radius_km=float(radius_km or 15.0),
        label=label,
        reason=reason,
        created_by=created_by,
        created_by_name=created_by_name,
    )
    await row.insert()
    if admin_id is None:
        _invalidate_centers_cache()
    return row


async def remove(admin_id: PydanticObjectId | None, block_id: str) -> bool:
    try:
        row = await GeoBlock.get(PydanticObjectId(block_id))
    except Exception:
        return False
    if row is None or row.admin_id != admin_id:
        return False
    await row.delete()
    if admin_id is None:
        _invalidate_centers_cache()
    return True


def _to_dict(row: GeoBlock, admin_label: str | None = None) -> dict:
    return {
        "id": str(row.id),
        "center_lat": row.center_lat,
        "center_lon": row.center_lon,
        "radius_km": row.radius_km,
        "label": row.label,
        "reason": row.reason,
        "admin_id": str(row.admin_id) if row.admin_id else None,
        "admin_label": admin_label,
        "created_by_name": row.created_by_name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def list_for_admin(admin_id: PydanticObjectId | None) -> list[dict]:
    rows = await GeoBlock.find(GeoBlock.admin_id == admin_id).sort("-created_at").to_list()
    return [_to_dict(r) for r in rows]
