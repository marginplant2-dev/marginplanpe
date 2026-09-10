"""WhatsApp-style support chat — one thread per user, messages under it.

Two documents rather than an embedded message array: a thread that has run
for a year holds thousands of messages, and Mongo's 16 MB doc cap plus the
cost of rewriting the whole array on every send make embedding the wrong
shape. The thread doc stays small (counters + last-message preview) so the
admin's conversation LIST is a single indexed query with no $lookup.

The scope fields (`assigned_admin_id` / `assigned_broker_id` /
`broker_ancestry`) are DENORMALISED off the User row and deliberately carry
the SAME field names as the User collection. That lets
`dependencies.scoped_user_filter(admin)` — the one clause that decides which
users an admin/broker/employee owns — be applied to this collection verbatim.
Reusing it is what keeps "which chats does this broker see" from ever
drifting away from "which users does this broker see" on the Users page.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Indexed, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.models._base import StrEnum, TimestampMixin


class SupportSender(StrEnum):
    USER = "USER"
    ADMIN = "ADMIN"


class SupportThread(TimestampMixin):
    """One row per end-user. Created lazily — either by the user opening
    /support and sending, or by an admin searching them up and sending the
    first message (the operator-requested "admin starts the conversation"
    flow). Both paths funnel through
    `support_chat_service.get_or_create_thread`.
    """

    user_id: Indexed(PydanticObjectId, unique=True)  # type: ignore[valid-type]

    # Identity snapshot — the admin's conversation list renders name + code
    # per row and the search box matches against them. Snapshotted so the
    # list is one query instead of an N+1 User lookup per thread.
    user_code: str = ""
    user_name: str = ""
    user_email: str = ""

    # Scope mirror — same names as User, see module docstring.
    assigned_admin_id: PydanticObjectId | None = None
    assigned_broker_id: PydanticObjectId | None = None
    broker_ancestry: list[PydanticObjectId] = Field(default_factory=list)

    # Conversation-list rendering: preview line + sort key + who spoke last.
    last_message_at: datetime | None = None
    last_message_preview: str = ""
    last_sender: SupportSender | None = None

    # Unread badges. Two counters because the same thread is read
    # independently by the two sides — the user clearing their badge must
    # not clear the admin's.
    unread_for_user: int = 0
    unread_for_admin: int = 0

    class Settings:
        name = "support_threads"
        indexes = [
            # Admin conversation list: scope clause + newest-first. One index
            # per scope shape so every branch of `_pool_clause` stays covered.
            IndexModel([("assigned_admin_id", ASCENDING), ("last_message_at", DESCENDING)]),
            IndexModel([("assigned_broker_id", ASCENDING), ("last_message_at", DESCENDING)]),
            IndexModel([("broker_ancestry", ASCENDING), ("last_message_at", DESCENDING)]),
            IndexModel([("last_message_at", DESCENDING)]),
            IndexModel([("user_code", ASCENDING)]),
        ]


class SupportMessage(TimestampMixin):
    """A single chat bubble.

    `read_at` is the blue-tick: set on the OPPOSITE side's messages when a
    reader opens the thread. A message with `read_at=None` renders one grey
    tick, with a value renders two blue ticks — the sender sees their own
    messages' state, exactly like WhatsApp.

    No TTL: unlike notifications, a support conversation is a compliance
    record — an operator has to be able to show what was promised to a user
    six months ago. Deletion, if ever needed, is a deliberate admin action.
    """

    thread_id: PydanticObjectId
    # Denormalised so "this user's messages" never needs the thread first —
    # both the user endpoint and the admin endpoint key off user_id.
    user_id: PydanticObjectId

    sender: SupportSender
    # Which admin/broker actually typed it. None for USER messages. Kept so a
    # multi-admin pool can see WHO replied, not just "admin".
    sender_id: PydanticObjectId | None = None
    sender_name: str = ""

    body: str = ""
    # Image / document sent alongside (or instead of) text. Path under the
    # existing /uploads StaticFiles mount, same shape as KYC proofs.
    attachment_url: str | None = None
    attachment_name: str | None = None

    read_at: datetime | None = None

    class Settings:
        name = "support_messages"
        indexes = [
            IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("thread_id", ASCENDING), ("created_at", ASCENDING)]),
            # Mark-read sweep: unread messages from one side of one thread.
            IndexModel([("user_id", ASCENDING), ("sender", ASCENDING), ("read_at", ASCENDING)]),
        ]
