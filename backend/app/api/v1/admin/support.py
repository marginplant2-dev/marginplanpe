"""Per-admin support WhatsApp number — read + update for the calling admin.

Each admin-tier user (SUPER_ADMIN / ADMIN / BROKER, including nested
sub-brokers) can configure their OWN WhatsApp number that will be shown
to their downstream users on the apk's "Add funds → Support" button
(and any other Contact-support affordance). Resolution at the user end
walks up the parent_id chain, so a sub-broker who hasn't set their own
number inherits their parent broker's number; a client whose entire
broker chain is blank falls back to the platform-wide
`platform.support_whatsapp` PlatformSetting row.

Endpoints:
    GET  /admin/support — current admin's own number (empty string when unset)
    PUT  /admin/support — { "whatsapp": "<digits or +country digits>" }

Audit-logged as SETTING_CHANGE on the User entity so the existing audit
filter UI surfaces these rows alongside other per-user setting tweaks.
"""

from __future__ import annotations

import re as _re
import uuid as _uuid
from datetime import datetime as _dt
from pathlib import Path as _Path
from typing import Any

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from app.core.dependencies import CurrentAdmin, require_perm, scoped_user_filter
from app.models._base import PermissionLevel
from app.models.audit_log import AuditAction
from app.models.support_chat import SupportMessage, SupportSender, SupportThread
from app.models.user import User, UserRole, UserStatus
from app.schemas.common import APIResponse
from app.services import support_chat_service as _chat
from app.services.audit_service import log_event

router = APIRouter(prefix="/support", tags=["admin-support"])


class SupportPayload(BaseModel):
    whatsapp: str = Field(default="", max_length=32)


def _support_can_edit(admin: User) -> bool:
    """Whether this admin-tier actor may set their OWN support number.
    Admin / super-admin always can. A BROKER (incl. sub-broker) can only
    when granted the `support` permission at EDIT — this is the gate the
    operator wants: a broker without the grant can't override their
    clients' support number (they inherit the parent admin's instead)."""
    if admin.role != UserRole.BROKER:
        return True
    bp = admin.broker_permissions
    if bp is None:
        return False
    return getattr(bp, "support", PermissionLevel.OFF) == PermissionLevel.EDIT


@router.get("", response_model=APIResponse[dict])
async def get_my_support(admin: CurrentAdmin):
    """Returns the calling admin's stored WhatsApp number. Empty string
    when unset — the UI then renders the input as a placeholder and
    explains the inheritance fallback so the admin knows what the
    user actually sees today. `can_edit` tells the UI whether to enable
    the form (brokers need the `support` permission)."""
    return APIResponse(
        data={
            "whatsapp": (admin.support_whatsapp or "").strip(),
            "role": admin.role.value,
            "can_edit": _support_can_edit(admin),
        }
    )


@router.put("", response_model=APIResponse[dict])
async def set_my_support(
    payload: SupportPayload,
    admin: CurrentAdmin,
    request: Request,
):
    """Updates the calling admin's own support WhatsApp number. Each
    admin tier writes only its own row — there's no "set someone
    else's number" endpoint, by design: a super-admin manages the
    platform-wide fallback via PlatformSetting; brokers manage their
    own pool's number here.

    The value is stored verbatim (spacing, leading `+`, dashes all
    preserved) so the admin's chosen format round-trips intact when
    re-displayed in the form. Length cap of 32 chars accommodates the
    longest realistic shape `+CC XXX XXX-XXXX`.
    """
    # Broker gate: only a broker granted `support` at EDIT may set its own
    # number. Without the grant the write is rejected so the broker can't
    # override what its clients see — they inherit the parent admin's number.
    if not _support_can_edit(admin):
        raise HTTPException(
            status_code=403,
            detail="Your admin hasn't enabled the Support permission for you.",
        )

    new_value = (payload.whatsapp or "").strip()
    old_value = (admin.support_whatsapp or "").strip()
    if new_value == old_value:
        return APIResponse(
            data={
                "whatsapp": new_value,
                "role": admin.role.value,
                "can_edit": True,
            }
        )

    # Refuse obviously-broken numbers. The apk's `buildWhatsappUrl`
    # silently hides the button when digits.length < 8, so blocking
    # the same shape at write time avoids storing a value the user app
    # can never display. Empty string is fine — that's the "clear"
    # action which restores inheritance from the parent admin.
    if new_value:
        digits = "".join(ch for ch in new_value if ch.isdigit())
        if len(digits) < 8:
            raise HTTPException(
                status_code=400,
                detail="WhatsApp number is too short. Include the country code (e.g. +91…).",
            )

    user_doc = await User.get(admin.id)
    if user_doc is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    user_doc.support_whatsapp = new_value or None
    await user_doc.save()

    await log_event(
        action=AuditAction.SETTING_CHANGE,
        entity_type="User",
        entity_id=admin.id,
        actor_id=admin.id,
        target_user_id=admin.id,
        old_values={"support_whatsapp": old_value},
        new_values={"support_whatsapp": new_value},
        metadata={"field": "support_whatsapp"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return APIResponse(
        data={"whatsapp": new_value, "role": admin.role.value, "can_edit": True}
    )


# ── Home-page notification ticker (per-admin, cascades to clients) ──

class TickerPayload(BaseModel):
    messages: list[str] = Field(default_factory=list)


@router.get("/ticker", response_model=APIResponse[dict])
async def get_my_ticker(admin: CurrentAdmin):
    """This admin's home-page ticker lines. Empty ⇒ the ticker is hidden for
    their users (unless a parent admin has one — the app resolves that)."""
    return APIResponse(
        data={"messages": list(admin.ticker_messages or []), "role": admin.role.value}
    )


@router.put("/ticker", response_model=APIResponse[dict])
async def set_my_ticker(payload: TickerPayload, admin: CurrentAdmin):
    """Replace this admin's ticker lines. Frontend sends the full list (add /
    remove happen client-side). Blanks dropped; capped at 20 lines × 300 chars
    so a runaway paste can't bloat the marquee. Empty list clears the ticker."""
    cleaned = [m.strip()[:300] for m in (payload.messages or []) if m and m.strip()][:20]
    user_doc = await User.get(admin.id)
    if user_doc is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    user_doc.ticker_messages = cleaned
    await user_doc.save()
    await log_event(
        action=AuditAction.SETTING_CHANGE,
        entity_type="User",
        entity_id=admin.id,
        actor_id=admin.id,
        target_user_id=admin.id,
        new_values={"ticker_count": len(cleaned)},
    )
    return APIResponse(
        data={"messages": cleaned},
        message=(f"{len(cleaned)} ticker line(s) live." if cleaned else "Ticker cleared."),
    )


# ── Terms & Conditions (per-admin, cascades to downstream clients) ──

class TermsPayload(BaseModel):
    text: str = Field(default="", max_length=20000)
    enabled: bool = False


@router.get("/terms", response_model=APIResponse[dict])
async def get_my_terms(admin: CurrentAdmin):
    return APIResponse(
        data={
            "text": admin.terms_text or "",
            "enabled": bool(admin.terms_enabled),
            "role": admin.role.value,
        }
    )


@router.put("/terms", response_model=APIResponse[dict])
async def set_my_terms(
    payload: TermsPayload,
    admin: CurrentAdmin,
    request: Request,
):
    """Update T&C text + enabled toggle. Enabling with empty text is
    rejected. Changing text resets downstream clients' accept marker
    so they re-accept on next visit (scoped by admin tier)."""
    new_text = (payload.text or "").strip()
    new_enabled = bool(payload.enabled)
    if new_enabled and not new_text:
        raise HTTPException(
            status_code=400,
            detail="Cannot enable T&C with empty text — add content first or toggle off.",
        )

    user_doc = await User.get(admin.id)
    if user_doc is None:
        raise HTTPException(status_code=404, detail="Admin user not found")

    old_text = user_doc.terms_text or ""
    old_enabled = bool(user_doc.terms_enabled)
    user_doc.terms_text = new_text or None
    user_doc.terms_enabled = new_enabled
    await user_doc.save()

    if new_text != old_text and new_text:
        # Reset every downstream CLIENT's terms_accepted_at so they
        # re-confirm the new version. Pools can be 1000s of rows, and
        # the update_many can take 5-30s on a cold MongoDB connection.
        # Fire-and-forget via asyncio.create_task so the API response
        # comes back immediately — without this the request hung long
        # enough for nginx to 504 the FIRST save, which surfaced in
        # the browser as a CORS error (504 has no Access-Control-
        # Allow-Origin header). Re-acceptance is eventually-consistent
        # — clients will see the new modal on their next page load
        # whenever the background reset finishes (typically a second
        # or two later).
        import asyncio

        from app.models._base import UserRole as _UR

        async def _cascade_reset() -> None:
            try:
                coll = User.get_motor_collection()
                if admin.role.value == _UR.BROKER.value:
                    await coll.update_many(
                        {"broker_ancestry": admin.id, "role": _UR.CLIENT.value},
                        {"$set": {"terms_accepted_at": None}},
                    )
                elif admin.role.value == _UR.ADMIN.value:
                    await coll.update_many(
                        {"assigned_admin_id": admin.id, "role": _UR.CLIENT.value},
                        {"$set": {"terms_accepted_at": None}},
                    )
                else:
                    await coll.update_many(
                        {"role": _UR.CLIENT.value},
                        {"$set": {"terms_accepted_at": None}},
                    )
            except Exception:  # noqa: BLE001
                import logging

                logging.getLogger(__name__).exception(
                    "terms_cascade_reset_failed admin_id=%s", admin.id
                )

        asyncio.create_task(_cascade_reset())

    await log_event(
        action=AuditAction.SETTING_CHANGE,
        entity_type="User",
        entity_id=admin.id,
        actor_id=admin.id,
        target_user_id=admin.id,
        old_values={"terms_enabled": old_enabled, "terms_text_len": len(old_text)},
        new_values={"terms_enabled": new_enabled, "terms_text_len": len(new_text)},
        metadata={"field": "terms"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return APIResponse(
        data={"text": new_text, "enabled": new_enabled, "role": admin.role.value}
    )


# ── Support chat (admin/broker side of the WhatsApp-style thread) ──────
#
# Route order matters: the literal paths (/chat/threads, /chat/search-users,
# /chat/unread-total, /chat/upload) MUST be declared before /chat/{user_id},
# otherwise FastAPI matches "threads" as a user_id and every list call 404s.
#
# Scoping is not re-implemented here. `scoped_user_filter(admin)` is the same
# clause the Users page uses, and SupportThread mirrors the three User fields
# it keys on, so it applies to the thread collection verbatim. A broker with
# the `support` permission therefore sees exactly the chats of exactly the
# users they already see on /users, and never one row more.

CHAT_UPLOAD_ROOT = _Path("uploads") / "support"
CHAT_ALLOWED_EXTS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf",
    # Voice notes — MediaRecorder emits webm/mp4(m4a)/ogg depending on browser.
    ".webm", ".m4a", ".mp4", ".mp3", ".ogg", ".oga", ".wav", ".aac",
}
CHAT_MAX_BYTES = 8 * 1024 * 1024


class AdminChatSendPayload(BaseModel):
    body: str = Field(default="", max_length=4000)
    attachment_url: str | None = None
    attachment_name: str | None = None


def _can_reply(admin: User) -> bool:
    """Non-raising mirror of ``require_perm("support", "write")``.

    The dependency raises, which is right for enforcement but useless for
    RENDERING: a broker granted `support` at VIEW can open the conversation
    list and read every message, but every send is rejected. Without this the
    composer looked live, the broker typed a reply and got a 403 — the write
    gate has to be visible in the UI, not just enforced at the edge.

    Kept in lockstep with `dependencies.require_perm` by hand; if that gains a
    tier this must too.
    """
    if admin.role == UserRole.SUPER_ADMIN:
        return True
    if admin.role in {UserRole.ADMIN, UserRole.EMPLOYEE}:
        return bool(getattr(admin.admin_permissions, "support", False))
    if admin.role == UserRole.BROKER:
        bp = admin.broker_permissions
        if bp is None:
            return False
        level = getattr(bp, "support", PermissionLevel.OFF)
        return (
            level if isinstance(level, PermissionLevel) else PermissionLevel(level)
        ) == PermissionLevel.EDIT
    return False


def _and_scope(base: dict[str, Any], scope: dict[str, Any]) -> dict[str, Any]:
    """Merge a scope clause into a query without clobbering it.

    The scope is an `$or` for an ADMIN who owns brokers, and a search box is
    also an `$or` — assigning both to the same dict key silently drops the
    first, which is how a scoping bug turns into a data leak. AND them.
    """
    if "$or" in scope:
        base.setdefault("$and", []).append(scope)
    else:
        base.update(scope)
    return base


async def _drop_out_of_scope(
    admin: User, rows: list[SupportThread]
) -> list[SupportThread]:
    """Re-check one PAGE of threads against the live User collection.

    The thread's `assigned_admin_id` / `broker_ancestry` are a denormalised
    MIRROR, refreshed only when someone sends in that thread or opens it. A
    user transferred between pools therefore keeps a stale mirror until the
    next activity — and `admin_management_service.reassign_user` already
    documents this exact failure mode biting the dashboards once before.

    Rather than hooking every present and future transfer path, the mirror is
    treated as an INDEX and the User collection as the authority: the page is
    at most `page_size` (<=100) rows, so one extra indexed `_id: {$in: ...}`
    query confirms them all. That also makes the list agree with
    `_user_in_scope`, which already checks the live collection — otherwise a
    row could be listed and then 404 on click.

    Message content was never exposed by the stale mirror (opening is checked
    live); what leaked was the row itself — name, code and the last-message
    preview — to a pool that no longer owns the user.
    """
    if not rows:
        return rows
    ids = [t.user_id for t in rows]
    q = _and_scope({"_id": {"$in": ids}}, dict(await scoped_user_filter(admin)))
    allowed = {
        doc["_id"]
        async for doc in User.get_motor_collection().find(q, {"_id": 1})
    }
    return [t for t in rows if t.user_id in allowed]


async def _user_in_scope(admin: User, user_id: PydanticObjectId) -> User:
    """Resolve a target user, 404-ing when they fall outside the caller's
    pool. Same 404 (not 403) for missing and for out-of-scope on purpose: a
    broker probing ids shouldn't learn which ones exist."""
    scope = await scoped_user_filter(admin)
    q = _and_scope({"_id": user_id}, dict(scope))
    doc = await User.get_motor_collection().find_one(q, {"_id": 1})
    if doc is None:
        raise HTTPException(status_code=404, detail="User not found in your pool")
    target = await User.get(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found in your pool")
    return target


@router.get("/chat/threads", response_model=APIResponse[dict])
async def list_chat_threads(
    admin: CurrentAdmin,
    q: str | None = None,
    unread_only: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    _: None = Depends(require_perm("support", "read")),
):
    """Conversation list, newest-activity first. `q` filters the visible
    threads by name / code / email; finding a user who has NEVER chatted is
    /chat/search-users instead."""
    query: dict[str, Any] = {}
    _and_scope(query, dict(await scoped_user_filter(admin)))
    if q and q.strip():
        rx = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
        query.setdefault("$and", []).append(
            {"$or": [{"user_name": rx}, {"user_code": rx}, {"user_email": rx}]}
        )
    if unread_only:
        query["unread_for_admin"] = {"$gt": 0}

    total = await SupportThread.find(query).count()
    rows = (
        await SupportThread.find(query)
        .sort("-last_message_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )
    rows = await _drop_out_of_scope(admin, rows)
    return APIResponse(
        data={
            "items": [_chat.serialise_thread(t) for t in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "can_reply": _can_reply(admin),
        }
    )


@router.get("/chat/unread-total", response_model=APIResponse[dict])
async def chat_unread_total(
    admin: CurrentAdmin,
    _: None = Depends(require_perm("support", "read")),
):
    """Nav-badge number: how many of MY threads have unread user messages.
    Thread count, not message count, so the badge matches the number of
    highlighted rows in the list."""
    query: dict[str, Any] = {"unread_for_admin": {"$gt": 0}}
    _and_scope(query, dict(await scoped_user_filter(admin)))
    return APIResponse(data={"unread_threads": await SupportThread.find(query).count()})


@router.get("/chat/search-users", response_model=APIResponse[dict])
async def search_chat_users(
    admin: CurrentAdmin,
    q: str = Query(default=""),
    limit: int = Query(default=15, ge=1, le=50),
    _: None = Depends(require_perm("support", "read")),
):
    """Find a user in the caller's pool to START a conversation with.

    This is the "admin messages the user first" entry point: it searches the
    USER collection (not threads), so someone who has never written in still
    shows up. `has_thread` lets the UI say "open chat" vs "new chat".
    """
    if not q.strip():
        return APIResponse(data={"items": []})

    rx = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
    query: dict[str, Any] = {
        # Client-tier only: an admin does not open a support chat with another
        # admin or broker. Mirrors the /admin/users role exclusion.
        "role": {
            "$nin": [
                UserRole.SUPER_ADMIN.value,
                UserRole.ADMIN.value,
                UserRole.BROKER.value,
            ]
        },
        "status": {"$ne": UserStatus.CLOSED.value},
        "is_demo": {"$ne": True},
        "$and": [
            {"$or": [{"full_name": rx}, {"user_code": rx}, {"email": rx}, {"mobile": rx}]}
        ],
    }
    _and_scope(query, dict(await scoped_user_filter(admin)))

    rows = (
        await User.get_motor_collection()
        .find(query, {"_id": 1, "full_name": 1, "user_code": 1, "email": 1})
        .limit(limit)
        .to_list(length=limit)
    )
    ids = [r["_id"] for r in rows]
    existing = set()
    if ids:
        async for t in SupportThread.get_motor_collection().find(
            {"user_id": {"$in": ids}}, {"user_id": 1}
        ):
            existing.add(t["user_id"])

    return APIResponse(
        data={
            "items": [
                {
                    "user_id": str(r["_id"]),
                    "user_name": r.get("full_name") or "",
                    "user_code": r.get("user_code") or "",
                    "user_email": r.get("email") or "",
                    "has_thread": r["_id"] in existing,
                }
                for r in rows
            ]
        }
    )


@router.post("/chat/upload", response_model=APIResponse[dict])
async def upload_admin_chat_attachment(
    admin: CurrentAdmin,
    file: UploadFile = File(...),
    _: None = Depends(require_perm("support", "write")),
):
    """Stage an image / PDF for an admin reply. Filed under the ADMIN's own id
    so an operator's uploads never land inside a user's upload folder."""
    ext = (_Path(file.filename or "").suffix or "").lower()
    if ext not in CHAT_ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {sorted(CHAT_ALLOWED_EXTS)}",
        )
    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > CHAT_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {CHAT_MAX_BYTES // (1024 * 1024)} MB)",
        )
    out_dir = CHAT_UPLOAD_ROOT / "admin" / str(admin.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{_uuid.uuid4().hex}{ext}"
    (out_dir / fname).write_bytes(contents)
    return APIResponse(
        data={
            "url": f"/uploads/support/admin/{admin.id}/{fname}",
            "name": file.filename or fname,
            "size": len(contents),
        }
    )


@router.get("/chat/{user_id}", response_model=APIResponse[dict])
async def get_user_chat(
    user_id: str,
    admin: CurrentAdmin,
    before: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    _: None = Depends(require_perm("support", "read")),
):
    """One user's conversation. Returns an empty message list (and a freshly
    created thread) when the admin is opening a brand-new chat from search."""
    try:
        uid = PydanticObjectId(user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid user id") from e
    target = await _user_in_scope(admin, uid)
    thread = await _chat.get_or_create_thread(target)

    q: dict[str, Any] = {"user_id": uid}
    if before:
        try:
            q["created_at"] = {"$lt": _dt.fromisoformat(before.replace("Z", "+00:00"))}
        except ValueError:
            pass
    rows = await SupportMessage.find(q).sort("-created_at").limit(limit).to_list()
    return APIResponse(
        data={
            "thread": _chat.serialise_thread(thread),
            "messages": [_chat.serialise_message(m) for m in reversed(rows)],
            "can_reply": _can_reply(admin),
        }
    )


@router.post("/chat/{user_id}", response_model=APIResponse[dict])
async def send_user_chat(
    user_id: str,
    payload: AdminChatSendPayload,
    admin: CurrentAdmin,
    _: None = Depends(require_perm("support", "write")),
):
    """Reply to a user, or OPEN the conversation by sending the first message
    after finding them via /chat/search-users. One endpoint for both: the
    thread is created on demand, so there is no separate "start chat" call
    that could leave an empty thread behind when the send then fails."""
    try:
        uid = PydanticObjectId(user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid user id") from e
    target = await _user_in_scope(admin, uid)
    try:
        msg = await _chat.send(
            target,
            SupportSender.ADMIN,
            payload.body,
            attachment_url=payload.attachment_url,
            attachment_name=payload.attachment_name,
            actor=admin,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return APIResponse(data=_chat.serialise_message(msg))


@router.post("/chat/{user_id}/read", response_model=APIResponse[dict])
async def mark_user_chat_read(
    user_id: str,
    admin: CurrentAdmin,
    _: None = Depends(require_perm("support", "read")),
):
    """Clear this thread's admin badge and blue-tick the user's messages."""
    try:
        uid = PydanticObjectId(user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid user id") from e
    await _user_in_scope(admin, uid)
    return APIResponse(data={"marked": await _chat.mark_read(uid, SupportSender.ADMIN)})
