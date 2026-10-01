"""Public IP gate — lets the frontend decide, before rendering any page,
whether the visitor's IP is banned from the whole site.

``GET /api/v1/ip-gate`` → ``{"blocked": true|false}`` for the caller's real IP
(resolved via CF-Connecting-IP etc.). The frontend middleware calls this on
page loads so a banned IP can't even open login/register/landing. Only the
PLATFORM (super-admin, admin_id=None) blocklist gates the whole site; per-admin
pool bans stay enforced at login + authenticated requests.

Mounted at /api/v1 from app/main.py. Unauthenticated by design.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.common import APIResponse
from app.services import geo_block_service, ip_block_service
from app.utils.net import client_ip

router = APIRouter(prefix="/ip-gate", tags=["ip-gate"])


@router.get("", response_model=APIResponse[dict])
async def ip_gate(request: Request):
    ip = client_ip(request)
    blocked = await ip_block_service.is_globally_blocked(ip) or await geo_block_service.is_geo_blocked(ip)
    return APIResponse(data={"blocked": blocked})
