"""`resolve_branding_admin_for_user` chain-walk tests.

The regression this guards: the old `/me/branding` read `assigned_admin_id`
alone, so every client sitting under a BROKER resolved to None and the
frontend fell back to the PLATFORM brand — a broker's client saw MarginPlant
instead of the admin who owns them.

No DB: the walk only calls `User.get`, so a dict-backed fake covers it.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.user import UserRole, UserStatus
from app.services import branding_service


def node(
    _id: str,
    role: UserRole,
    *,
    broker: str | None = None,
    admin: str | None = None,
    status: UserStatus = UserStatus.ACTIVE,
):
    return SimpleNamespace(
        id=_id,
        role=role,
        status=status,
        assigned_broker_id=broker,
        assigned_admin_id=admin,
    )


@pytest.fixture
def graph(monkeypatch):
    """Install a fake `User.get` over a dict of nodes the test builds."""
    store: dict[str, SimpleNamespace] = {}

    async def _get(_id):
        return store.get(_id)

    monkeypatch.setattr(branding_service, "User", SimpleNamespace(get=_get))
    return store


async def resolve(user):
    return await branding_service.resolve_branding_admin_for_user(user)


@pytest.mark.asyncio
async def test_client_directly_under_admin(graph):
    admin = node("a1", UserRole.ADMIN)
    graph["a1"] = admin
    client = node("c1", UserRole.CLIENT, admin="a1")
    assert (await resolve(client)) is admin


@pytest.mark.asyncio
async def test_client_under_broker_resolves_parent_admin(graph):
    """The regression. Broker-pool rows often carry only assigned_broker_id."""
    admin = node("a1", UserRole.ADMIN)
    broker = node("b1", UserRole.BROKER, admin="a1")
    graph.update({"a1": admin, "b1": broker})
    client = node("c1", UserRole.CLIENT, broker="b1")
    assert (await resolve(client)) is admin, "broker's client fell back to platform brand"


@pytest.mark.asyncio
async def test_sub_broker_chain_still_reaches_admin(graph):
    """Brokers are stepped over, however many are stacked — they can't brand."""
    admin = node("a1", UserRole.ADMIN)
    parent = node("b1", UserRole.BROKER, admin="a1")
    sub = node("b2", UserRole.BROKER, broker="b1")
    graph.update({"a1": admin, "b1": parent, "b2": sub})
    client = node("c1", UserRole.CLIENT, broker="b2")
    assert (await resolve(client)) is admin


@pytest.mark.asyncio
async def test_super_admin_pool_resolves_super_admin(graph):
    sa = node("s1", UserRole.SUPER_ADMIN)
    graph["s1"] = sa
    client = node("c1", UserRole.CLIENT, admin="s1")
    assert (await resolve(client)) is sa


@pytest.mark.asyncio
async def test_no_chain_returns_none(graph):
    """Caller leaves the platform default in place rather than guessing."""
    assert (await resolve(node("c1", UserRole.CLIENT))) is None


@pytest.mark.asyncio
async def test_blocked_admin_is_not_used(graph):
    graph["a1"] = node("a1", UserRole.ADMIN, status=UserStatus.BLOCKED)
    client = node("c1", UserRole.CLIENT, admin="a1")
    assert (await resolve(client)) is None


@pytest.mark.asyncio
async def test_cycle_terminates(graph):
    """A corrupted chain must not hang the request."""
    b1 = node("b1", UserRole.BROKER, broker="b2")
    b2 = node("b2", UserRole.BROKER, broker="b1")
    graph.update({"b1": b1, "b2": b2})
    assert (await resolve(node("c1", UserRole.CLIENT, broker="b1"))) is None
