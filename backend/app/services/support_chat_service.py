"""Support-chat send / read plumbing shared by the user and admin routers.

Both directions funnel through `send()` so the thread counters, the preview
line, the WS fan-out and the web-push can never disagree between the two call
sites — the classic way a chat ends up with a badge that says 3 while the
list shows 4.

Delivery is three-layer and each layer is independently best-effort:

  1. Mongo write   — source of truth. If this fails the send fails.
  2. Redis pub/sub — live update into an OPEN tab (user socket + admin
     socket). Swallowed on failure; the receiver's next poll catches up.
  3. Web push      — wakes a closed / backgrounded PWA. Swallowed on failure;
     no-ops entirely when VAPID is unconfigured (dev).

Scope on the admin side is NOT re-derived here — the thread carries a mirror
of the User row's assignment fields, so the routers apply
`dependencies.scoped_user_filter` to the thread collection directly.
"""

from __future__ import annotations

import logging
from typing import Any

from beanie import PydanticObjectId

from app.core.redis_client import publish
from app.models.support_chat import SupportMessage, SupportSender, SupportThread
from app.models.user import User
from app.utils.time_utils import now_utc

logger = logging.getLogger(__name__)

# Preview line in the conversation list. WhatsApp truncates around here too;
# anything longer is ellipsed by CSS anyway, so storing more is waste.
PREVIEW_LEN = 120

MAX_BODY_LEN = 4000


def _preview(body: str, attachment_name: str | None) -> str:
    """Conversation-list preview. An image-only message shows a paperclip the
    way every chat app does, rather than rendering an empty row."""
    text = (body or "").strip().replace("\n", " ")
    if attachment_name and not text:
        return f"[file] {attachment_name}"[:PREVIEW_LEN]
    if attachment_name and text:
        return f"[file] {text}"[:PREVIEW_LEN]
    return text[:PREVIEW_LEN]


async def get_or_create_thread(user: User) -> SupportThread:
    """Fetch this user's thread, creating it on first contact.

    The identity + scope snapshot is REFRESHED on every call, not only at
    creation. Without that, a user transferred to another admin would keep
    showing up in the OLD admin's conversation list forever (and never appear
    in the new one's), because the thread's mirror of `assigned_admin_id`
    would still hold the stale owner. Refreshing on the send path keeps the
    mirror eventually-consistent with the User row for free.
    """
    thread = await SupportThread.find_one(SupportThread.user_id == user.id)
    snapshot: dict[str, Any] = {
        "user_code": user.user_code or "",
        "user_name": user.full_name or "",
        "user_email": user.email or "",
        "assigned_admin_id": user.assigned_admin_id,
        "assigned_broker_id": user.assigned_broker_id,
        "broker_ancestry": list(user.broker_ancestry or []),
    }
    if thread is None:
        thread = SupportThread(user_id=user.id, **snapshot)
        await thread.insert()
        return thread

    if any(getattr(thread, k) != v for k, v in snapshot.items()):
        for k, v in snapshot.items():
            setattr(thread, k, v)
        await thread.save()
    return thread


async def send(
    user: User,
    sender: SupportSender,
    body: str,
    *,
    attachment_url: str | None = None,
    attachment_name: str | None = None,
    actor: User | None = None,
) -> SupportMessage:
    """Append one message to `user`'s thread and fan it out.

    `user` is always the END USER the thread belongs to — for an admin reply
    that is the recipient, not the sender. `actor` is the admin / broker who
    typed it (None for a user-sent message), recorded so a pool with several
    operators can see who answered.
    """
    body = (body or "").strip()[:MAX_BODY_LEN]
    if not body and not attachment_url:
        raise ValueError("Message must have text or an attachment")

    thread = await get_or_create_thread(user)

    msg = SupportMessage(
        thread_id=thread.id,
        user_id=user.id,
        sender=sender,
        sender_id=actor.id if actor is not None else None,
        sender_name=(actor.full_name if actor is not None else user.full_name) or "",
        body=body,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
    )
    await msg.insert()

    thread.last_message_at = msg.created_at or now_utc()
    thread.last_message_preview = _preview(body, attachment_name)
    thread.last_sender = sender
    # Only the RECEIVING side's badge moves. Sending is not reading, but you
    # never owe yourself an unread either.
    if sender == SupportSender.USER:
        thread.unread_for_admin += 1
    else:
        thread.unread_for_user += 1
    await thread.save()

    await _fanout(thread, msg, user)
    return msg


async def _fanout(thread: SupportThread, msg: SupportMessage, user: User) -> None:
    """Live delivery. Every branch is swallowed — a Redis or VAPID hiccup must
    never fail a message that is already durably written."""
    payload = {
        "type": "support_message",
        "user_id": str(thread.user_id),
        "thread_id": str(thread.id),
        "message": serialise_message(msg),
        "unread_for_user": thread.unread_for_user,
        "unread_for_admin": thread.unread_for_admin,
    }

    if msg.sender == SupportSender.ADMIN:
        # -> the user's open tab, then their phone.
        try:
            await publish(f"user:{thread.user_id}:support", payload)
        except Exception:  # pragma: no cover
            logger.exception("support_user_publish_failed user=%s", thread.user_id)
        try:
            from app.services import push_service

            await push_service.send_to_user(
                thread.user_id,
                title="Support replied",
                body=thread.last_message_preview or "New message",
                url="/support",
                # One tag for the whole thread so a burst of replies collapses
                # into a single tray entry instead of stacking N of them.
                tag="support-chat",
            )
        except Exception:  # pragma: no cover
            logger.exception("support_user_push_failed user=%s", thread.user_id)
        return

    # USER -> the owning admins / brokers only. `send_to_user_owners` resolves
    # assigned_admin_id + broker_ancestry (super-admins only for platform-
    # direct users), the same scoping the conversation list uses, so one
    # pool's operator is never pinged about another pool's chat.
    recipient_ids: list[PydanticObjectId] = []
    try:
        from app.services import push_service

        recipient_ids = await push_service.send_to_user_owners(
            thread.user_id,
            title=f"Support: {user.full_name or user.user_code}",
            body=thread.last_message_preview or "New message",
            url="/support-chat",
            tag=f"support-chat-{thread.user_id}",
        )
    except Exception:  # pragma: no cover
        logger.exception("support_admin_push_failed user=%s", thread.user_id)

    try:
        from app.services.admin_events import publish_admin_event

        # `admin:events` is a single global channel, so the payload carries the
        # resolved recipient ids and the AdminWsBridge filters client-side
        # before popping a toast. Query invalidation stays unconditional — it's
        # server-scoped anyway — but the TOAST must not fire for an admin who
        # cannot even open that chat.
        await publish_admin_event(
            "support_message",
            {
                **payload,
                "user_name": user.full_name,
                "user_code": user.user_code,
                "recipient_admin_ids": [str(i) for i in recipient_ids],
            },
        )
    except Exception:  # pragma: no cover
        logger.exception("support_admin_publish_failed user=%s", thread.user_id)


async def mark_read(user_id: PydanticObjectId, reader: SupportSender) -> int:
    """Stamp `read_at` on every unread message from the OPPOSITE side and zero
    the reader's badge. Returns how many messages flipped.

    This is the blue tick: the sender's bubbles turn double-blue once the other
    party opens the thread. The counterpart is notified over WS so the ticks
    update live rather than on the next poll.
    """
    thread = await SupportThread.find_one(SupportThread.user_id == user_id)
    if thread is None:
        return 0

    other = SupportSender.ADMIN if reader == SupportSender.USER else SupportSender.USER
    now = now_utc()
    res = await SupportMessage.get_motor_collection().update_many(
        {"user_id": user_id, "sender": other.value, "read_at": None},
        {"$set": {"read_at": now}},
    )
    flipped = int(getattr(res, "modified_count", 0) or 0)

    if reader == SupportSender.USER:
        thread.unread_for_user = 0
    else:
        thread.unread_for_admin = 0
    await thread.save()

    if flipped:
        # Tell the OTHER side their ticks went blue.
        seen_payload = {
            "type": "support_seen",
            "user_id": str(user_id),
            "seen_by": reader.value,
            "read_at": now.isoformat(),
        }
        try:
            if reader == SupportSender.ADMIN:
                await publish(f"user:{user_id}:support", seen_payload)
            else:
                from app.services.admin_events import publish_admin_event

                await publish_admin_event("support_seen", seen_payload)
        except Exception:  # pragma: no cover
            logger.exception("support_seen_publish_failed user=%s", user_id)

    return flipped


def serialise_message(m: SupportMessage) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "sender": m.sender.value,
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "sender_name": m.sender_name,
        "body": m.body,
        "attachment_url": m.attachment_url,
        "attachment_name": m.attachment_name,
        "read_at": m.read_at.isoformat() if m.read_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def serialise_thread(t: SupportThread) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "user_id": str(t.user_id),
        "user_code": t.user_code,
        "user_name": t.user_name,
        "user_email": t.user_email,
        "last_message_at": t.last_message_at.isoformat() if t.last_message_at else None,
        "last_message_preview": t.last_message_preview,
        "last_sender": t.last_sender.value if t.last_sender else None,
        "unread_for_user": t.unread_for_user,
        "unread_for_admin": t.unread_for_admin,
    }
