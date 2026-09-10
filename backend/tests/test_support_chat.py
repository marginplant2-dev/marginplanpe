"""Support-chat scoping + preview unit tests.

`_and_scope` is the one place a support-chat bug becomes a DATA LEAK rather
than a cosmetic glitch: the admin pool clause is an `$or` whenever an ADMIN
owns brokers, and the search box is also an `$or`. Assigning both to the same
dict key drops the first silently — and if the one that gets dropped is the
scope, a broker's search suddenly matches every user on the platform.

No DB, no fixtures — both functions under test are pure.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.api.v1.admin.support import _and_scope, _can_reply
from app.models._base import PermissionLevel
from app.models.user import UserRole
from app.services.support_chat_service import PREVIEW_LEN, _preview

# The two clause shapes `_pool_clause` can return, verbatim.
FLAT_SCOPE = {"assigned_admin_id": "admin1"}
OR_SCOPE = {
    "$or": [
        {"assigned_admin_id": "admin1"},
        {"assigned_broker_id": {"$in": ["b1"]}},
        {"broker_ancestry": {"$in": ["b1"]}},
    ]
}
SEARCH_OR = {"$or": [{"user_name": "rx"}, {"user_code": "rx"}]}


def test_flat_scope_merges_into_query():
    q = _and_scope({"unread_for_admin": {"$gt": 0}}, dict(FLAT_SCOPE))
    assert q["assigned_admin_id"] == "admin1"
    assert q["unread_for_admin"] == {"$gt": 0}


def test_or_scope_survives_alongside_a_search_or():
    """The regression this file exists for: scope `$or` + search `$or`."""
    q: dict = {}
    _and_scope(q, dict(OR_SCOPE))
    # Router adds the search clause the same way the real endpoint does.
    q.setdefault("$and", []).append(SEARCH_OR)

    assert OR_SCOPE in q["$and"], "scope clause was dropped — every pool leaks"
    assert SEARCH_OR in q["$and"], "search clause was dropped"
    # Crucially the scope did NOT land on a top-level `$or` that the search
    # could then overwrite.
    assert "$or" not in q


def test_flat_scope_plus_search_keeps_both():
    q: dict = {}
    _and_scope(q, dict(FLAT_SCOPE))
    q.setdefault("$and", []).append(SEARCH_OR)
    assert q["assigned_admin_id"] == "admin1"
    assert SEARCH_OR in q["$and"]


def test_preview_text_only():
    assert _preview("  hello there  ", None) == "hello there"


def test_preview_newlines_collapse():
    # The list row is one line; a pasted multi-line message must not break it.
    assert "\n" not in _preview("line one\nline two", None)


def test_preview_attachment_only():
    out = _preview("", "receipt.png")
    assert "receipt.png" in out


def test_preview_truncates():
    assert len(_preview("x" * 500, None)) == PREVIEW_LEN


# ── Reply gate ────────────────────────────────────────────────────────
# `_can_reply` decides whether the admin UI renders a live composer. It must
# agree exactly with `require_perm("support", "write")`, which is what the
# send endpoint actually enforces — if the two drift, a broker either sees a
# composer that 403s on every send, or is refused a reply they're entitled to.

def _actor(role, *, admin_perm=None, broker_level=None):
    return SimpleNamespace(
        role=role,
        admin_permissions=SimpleNamespace(support=admin_perm)
        if admin_perm is not None
        else None,
        broker_permissions=SimpleNamespace(support=broker_level)
        if broker_level is not None
        else None,
    )


def test_super_admin_always_replies():
    assert _can_reply(_actor(UserRole.SUPER_ADMIN)) is True


def test_admin_needs_the_support_section():
    assert _can_reply(_actor(UserRole.ADMIN, admin_perm=True)) is True
    assert _can_reply(_actor(UserRole.ADMIN, admin_perm=False)) is False


def test_employee_follows_its_granted_sections():
    assert _can_reply(_actor(UserRole.EMPLOYEE, admin_perm=True)) is True
    assert _can_reply(_actor(UserRole.EMPLOYEE, admin_perm=False)) is False


def test_broker_view_is_read_only():
    """The gap this guards: VIEW passes the READ dep, so the broker reaches
    the conversation — but every send is refused. The composer must be off."""
    assert _can_reply(_actor(UserRole.BROKER, broker_level=PermissionLevel.VIEW)) is False


def test_broker_edit_can_reply():
    assert _can_reply(_actor(UserRole.BROKER, broker_level=PermissionLevel.EDIT)) is True


def test_broker_off_and_missing_perms_are_denied():
    assert _can_reply(_actor(UserRole.BROKER, broker_level=PermissionLevel.OFF)) is False
    # Fail-closed: a broker row created before the field existed.
    assert _can_reply(_actor(UserRole.BROKER)) is False


def test_client_tier_can_never_reply():
    assert _can_reply(_actor(UserRole.CLIENT)) is False
