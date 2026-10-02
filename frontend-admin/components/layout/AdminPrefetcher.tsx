"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DashboardAPI,
  UsersAPI,
  PayinOutAPI,
  TradingAPI,
  InstrumentAdminAPI,
  RiskAPI,
  ReportsAdminAPI,
  SettingsAPI,
  BrokerageAPI,
  BrokerMgmtAPI,
  ManagementAPI,
  LedgerAdminAPI,
  MoneyAPI,
  ReferralSettingsAPI,
  PlatformReportsAPI,
} from "@/lib/api";
import {
  DEFAULT_PERIOD,
  periodKey,
  periodToParams,
} from "@/components/admin/money/MoneyShared";

// Fires once on admin layout mount and warms every sidebar
// destination so navigating between sections paints from cache
// instead of running a fresh fetch on first visit. Keys mirror
// the defaults each page uses verbatim — any drift will produce
// a cache miss and the page will fetch normally.
export function AdminPrefetcher() {
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;

      // Tier 1 — dashboard and headline counts (visible first thing
      // after login). Fire these in parallel right away.
      void Promise.allSettled([
        qc.prefetchQuery({
          queryKey: ["admin", "dashboard", "stats"],
          queryFn: () => DashboardAPI.stats(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "dashboard", "alerts"],
          queryFn: () => DashboardAPI.riskAlerts(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "positions", "pnl-summary"],
          queryFn: () => TradingAPI.pnlSummary(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "dashboard", "referral-stats"],
          queryFn: () => ReferralSettingsAPI.stats(),
        }),
      ]);

      // Brief stagger so the dashboard's own queries get the wire
      // first — the rest fill in over the next second or so.
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled) return;

      // Tier 2 — the rest of the sidebar. Each prefetch matches its
      // page's default query key exactly; otherwise we'd populate a
      // sibling key and the page would still spin.
      void Promise.allSettled([
        qc.prefetchQuery({
          // MUST match users/page.tsx:109 exactly (q/status/mode/page/pageSize/
          // adminId/brokerId) — the old key had `role` + pageSize 20 and no
          // mode/adminId/brokerId, so it hashed differently and the users list
          // still cold-fetched ("Loading…") on first visit.
          queryKey: [
            "admin",
            "users",
            { q: "", status: "", mode: "live", page: 1, pageSize: 15, adminId: "", brokerId: "" },
          ],
          queryFn: () => UsersAPI.list({ mode: "live", page: 1, page_size: 15 }),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "deposits", undefined],
          queryFn: () => PayinOutAPI.deposits(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "withdrawals", undefined],
          queryFn: () => PayinOutAPI.withdrawals(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "bank-accounts"],
          queryFn: () => PayinOutAPI.bankAccounts(),
        }),
        qc.prefetchQuery({
          // MUST match orders/page.tsx apiParams for the default "pending" tab
          // (page/page_size/user_id/q/statuses). The old {status,page,userId}
          // shape never matched, so the trading monitor cold-fetched.
          queryKey: [
            "admin",
            "orders",
            { page: 1, page_size: 50, user_id: undefined, q: undefined, statuses: "PENDING,OPEN,PARTIAL" },
          ],
          queryFn: () =>
            TradingAPI.orders({ page: 1, page_size: 50, statuses: "PENDING,OPEN,PARTIAL" }),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "positions", "OPEN", null],
          queryFn: () => TradingAPI.positions({ status: "OPEN" }),
        }),
        qc.prefetchQuery({
          queryKey: [
            "admin",
            "instruments",
            { q: "", exchange: "", page: 1 },
          ],
          queryFn: () => InstrumentAdminAPI.list({ page: 1, page_size: 50 }),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "risk", "global"],
          queryFn: () => RiskAPI.getGlobal(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "risk", "users-with-overrides"],
          queryFn: () => RiskAPI.usersWithOverrides(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "settings", "platform"],
          queryFn: () => SettingsAPI.platformList(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "holidays", new Date().getFullYear()],
          queryFn: () => SettingsAPI.holidays(new Date().getFullYear()),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "backups"],
          queryFn: () => SettingsAPI.backupList(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "brokerage"],
          queryFn: () => BrokerageAPI.list(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "reports", "users"],
          queryFn: () => ReportsAdminAPI.users(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "reports", "financial"],
          queryFn: () => ReportsAdminAPI.financial(),
        }),
        qc.prefetchQuery({
          queryKey: ["admin", "reports", "trades"],
          queryFn: () => ReportsAdminAPI.trades(),
        }),
      ]);

      // Tier 3 — heavy sections the prefetcher used to miss entirely, so they
      // always cold-fetched ("Loading…") on first visit. Keys copied VERBATIM
      // from each page. Staggered after Tier 2 so the first-screen data wins
      // the wire.
      await new Promise((r) => setTimeout(r, 300));
      if (cancelled) return;
      void Promise.allSettled([
        // management/sub-admins/page.tsx:176 → ["admin","sub-admins", q=""]
        qc.prefetchQuery({
          queryKey: ["admin", "sub-admins", ""],
          queryFn: () => ManagementAPI.listSubAdmins({ page: 1, page_size: 100 }),
        }),
        // management/brokers/page.tsx → ["admin","brokers", q="", brokerPage=1]
        qc.prefetchQuery({
          queryKey: ["admin", "brokers", "", 1],
          queryFn: () => BrokerMgmtAPI.list({ page: 1, page_size: 15 }),
        }),
        // ledger/page.tsx:51 → ["admin","ledger",{type:"",page:1,pageSize:50,queryUserId:undefined}]
        qc.prefetchQuery({
          queryKey: ["admin", "ledger", { type: "", page: 1, pageSize: 50, queryUserId: undefined }],
          queryFn: () => LedgerAdminAPI.list({ page: 1, page_size: 50 }),
        }),
        // money-transactions/page.tsx:40 → ["admin","money","users", periodKey(DEFAULT_PERIOD)]
        qc.prefetchQuery({
          queryKey: ["admin", "money", "users", periodKey(DEFAULT_PERIOD)],
          queryFn: () => MoneyAPI.users(periodToParams(DEFAULT_PERIOD)),
        }),
        // reports/admin/page.tsx:38 → ["admin","platform-reports"] (heavy, hard-blocks)
        qc.prefetchQuery({
          queryKey: ["admin", "platform-reports"],
          queryFn: () => PlatformReportsAPI.get(),
        }),
      ]);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [qc]);

  return null;
}
