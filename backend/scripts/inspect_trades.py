"""Read-only: dump a user's Trade fills for a symbol so we can see exactly
what the Closed-tab FIFO blotter (list_closed_trade_events_fifo) reconstructs
from. The Closed tab reads TRADE rows (quantity + pnl_inr), NOT the Position
doc — so this is the source of truth for what the user sees.

Usage (backend/, venv active):
    python -m scripts.inspect_trades CL04229808 NATURALGAS26SEPFUT
"""

from __future__ import annotations

import asyncio
import sys

from app.core.database import close_database, init_database
from app.models.trade import Trade
from app.models.user import User


async def main() -> None:
    if len(sys.argv) < 3:
        print("usage: python -m scripts.inspect_trades <user_code> <symbol_contains>")
        return
    user_code, needle = sys.argv[1], sys.argv[2].upper()

    await init_database()
    try:
        user = await User.find_one({"user_code": user_code})
        if user is None:
            print(f"[abort] no user with user_code = {user_code}")
            return
        print(f"USER: {user.full_name}  ({user_code})  id={user.id}\n")

        trades = await (
            Trade.find(Trade.user_id == user.id).sort("+executed_at").to_list()
        )
        hits = [t for t in trades if needle in (t.instrument.symbol or "").upper()]
        if not hits:
            print(f"[none] no trades matching '{needle}'")
            return

        print(f"{len(hits)} trade fill(s) matching '{needle}' "
              "(chronological):\n")
        for t in hits:
            kind = "CLOSE" if t.pnl_inr is not None else "OPEN "
            print(f"  [{kind}] {t.trade_number}")
            print(f"          id            {t.id}")
            print(f"          action        {t.action.value}")
            print(f"          quantity      {t.quantity}")
            print(f"          price         {t.price}")
            print(f"          value         {t.value}")
            print(f"          brokerage     {t.brokerage}")
            print(f"          pnl_inr       {t.pnl_inr}")
            print(f"          superseded    {t.superseded_by_reopen}")
            print(f"          executed_at   {t.executed_at}")
            print()
    finally:
        await close_database()


if __name__ == "__main__":
    asyncio.run(main())
