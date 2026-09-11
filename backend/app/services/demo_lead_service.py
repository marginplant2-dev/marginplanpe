"""Capture + list demo leads (name + phone left before a demo session).

Dedup is per (admin_id, mobile): the same number starting a demo again bumps
`login_count` on the existing row instead of creating a duplicate.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from beanie import PydanticObjectId

from app.models.demo_lead import DemoLead
from app.utils.time_utils import now_utc

logger = logging.getLogger(__name__)


def _norm_mobile(raw: str) -> str:
    """Digits only, last 10 (drops +91 / 0 prefixes) so the same phone always
    dedups to one row regardless of how it was typed."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


async def capture(*, admin_id: PydanticObjectId | None, name: str, mobile: str) -> None:
    """Upsert a lead. Best-effort: never let a lead write break demo login."""
    mob = _norm_mobile(mobile)
    nm = (name or "").strip()[:80]
    if not mob:
        return
    try:
        existing = await DemoLead.find_one(
            DemoLead.admin_id == admin_id, DemoLead.mobile == mob
        )
        if existing is not None:
            existing.login_count = (existing.login_count or 0) + 1
            existing.last_login_at = now_utc()
            if nm:
                existing.name = nm
            await existing.save()
            return
        await DemoLead(admin_id=admin_id, name=nm or "—", mobile=mob).insert()
    except Exception:
        # A racing duplicate trips the unique (admin_id, mobile) index — that's
        # fine, the other writer already recorded this lead.
        logger.debug("demo_lead_capture_noop admin=%s mobile=%s", admin_id, mob)


async def list_for_admin(
    *,
    admin_id: PydanticObjectId | None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Newest-active-first page of leads for one pool."""
    q: dict[str, Any] = {"admin_id": admin_id}
    if search and search.strip():
        s = re.escape(search.strip())
        q["$or"] = [
            {"name": {"$regex": s, "$options": "i"}},
            {"mobile": {"$regex": s, "$options": "i"}},
        ]
    total = await DemoLead.find(q).count()
    page = max(1, page)
    rows = (
        await DemoLead.find(q)
        .sort("-last_login_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": str(r.id),
                "name": r.name,
                "mobile": r.mobile,
                "login_count": r.login_count,
                "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
