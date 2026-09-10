"""User Web Push endpoints — mirror of admin/push.py."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import CurrentUser
from app.models.push_subscription import PushKeys, PushSubjectType, PushSubscription
from app.schemas.common import APIResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["user-push"])


class _SubscribeBody(BaseModel):
    endpoint: str
    keys: PushKeys
    label: str | None = None


@router.get("/vapid-key", response_model=APIResponse[dict])
async def vapid_key(user: CurrentUser):
    return APIResponse(data={"public_key": settings.VAPID_PUBLIC_KEY})


@router.post("/subscribe", response_model=APIResponse[dict])
async def subscribe(
    body: _SubscribeBody,
    user: CurrentUser,
    user_agent: str | None = Header(default=None, alias="User-Agent"),
):
    existing = await PushSubscription.find_one(PushSubscription.endpoint == body.endpoint)
    if existing is not None:
        existing.subject_type = PushSubjectType.USER
        existing.subject_id = user.id
        existing.keys = body.keys
        existing.label = body.label or existing.label
        existing.user_agent = user_agent or existing.user_agent
        await existing.save()
        return APIResponse(data={"id": str(existing.id), "created": False})
    sub = PushSubscription(
        subject_type=PushSubjectType.USER,
        subject_id=user.id,
        endpoint=body.endpoint,
        keys=body.keys,
        label=body.label,
        user_agent=user_agent,
    )
    await sub.insert()
    return APIResponse(data={"id": str(sub.id), "created": True})


class _UnsubBody(BaseModel):
    endpoint: str


@router.post("/unsubscribe", response_model=APIResponse[dict])
async def unsubscribe(body: _UnsubBody, user: CurrentUser):
    sub = await PushSubscription.find_one(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.subject_id == user.id,
    )
    if sub is None:
        return APIResponse(data={"ok": True, "found": False})
    await sub.delete()
    return APIResponse(data={"ok": True, "found": True})


# ── Diagnostics ───────────────────────────────────────────────────────
# Web push fails silently by design: a missing VAPID pair, a phone that never
# subscribed, and a revoked OS permission all look identical from the app —
# nothing arrives and nothing errors. These two endpoints turn that into a
# fact so nobody has to guess which of the three it is.


@router.get("/status", response_model=APIResponse[dict])
async def push_status(user: CurrentUser):
    """What the SERVER knows about this user's push setup.

    `vapid_configured` false  -> server can never send to anyone; set the keys.
    `subscription_count` zero -> this device never registered; the usual cause
                                 is OS notification permission being denied,
                                 since `subscribeForWebPush()` returns early
                                 without it.
    Both fine but nothing arrives -> the drop is past us (OS-level block for
                                 the PWA, or a stale service worker).
    """
    subs = await PushSubscription.find(
        PushSubscription.subject_type == PushSubjectType.USER,
        PushSubscription.subject_id == user.id,
    ).to_list()
    return APIResponse(
        data={
            "vapid_configured": bool(settings.VAPID_PUBLIC_KEY)
            and bool(settings.VAPID_PRIVATE_KEY.get_secret_value()),
            "subscription_count": len(subs),
            "devices": [
                {
                    "label": s.label or s.user_agent or "Unknown device",
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in subs
            ],
        }
    )


@router.post("/test", response_model=APIResponse[dict])
async def push_test(user: CurrentUser):
    """Fire a real push at the caller's own devices.

    Scoped to self — there is no way to aim it at another user — so it is safe
    to expose in the app. It goes through the exact same `send_to_user` path a
    support reply uses, so if the test lands and a real reply doesn't, the bug
    is in the reply path, not the transport.
    """
    from app.services import push_service

    status = await push_status(user)
    data = dict(status.data or {})
    await push_service.send_to_user(
        user.id,
        title="Test notification",
        body="If you can see this, push notifications are working.",
        url="/support",
        tag=f"mp-test-{user.id}",
    )
    data["sent"] = data.get("vapid_configured") and data.get("subscription_count", 0) > 0
    return APIResponse(data=data)
