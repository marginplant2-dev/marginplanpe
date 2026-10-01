"""GeoBlock — a lat/long centre + radius the super-admin has banned.

A visitor whose IP geolocates INSIDE the circle (centre, radius_km) can't open
the site — the whole-site IP gate checks these alongside the IP blocklist.

IMPORTANT: this is IP-based geolocation, which is CITY-LEVEL and approximate
(~10–50km error, worse for mobile/CG-NAT/VPN). It is NOT exact GPS — a tight
radius will both miss real locals and catch distant users. Stored centre comes
from geolocating the IP the admin entered (or an explicit lat/long).

``admin_id=None`` = platform/super-admin (the only scope the whole-site gate
enforces today), mirroring BlockedIP.
"""

from __future__ import annotations

from beanie import PydanticObjectId
from pymongo import ASCENDING, IndexModel

from app.models._base import TimestampMixin


class GeoBlock(TimestampMixin):
    admin_id: PydanticObjectId | None = None
    center_lat: float
    center_lon: float
    radius_km: float = 15.0
    # Human label — the IP/city the centre came from, for the admin list.
    label: str | None = None
    reason: str | None = None
    created_by: PydanticObjectId | None = None
    created_by_name: str | None = None

    class Settings:
        name = "geo_blocks"
        indexes = [
            IndexModel([("admin_id", ASCENDING)]),
        ]
