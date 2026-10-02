"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, CornerDownRight, ChevronLeft } from "lucide-react";
import { BrokerMgmtAPI, TradingAPI } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusPill } from "@/components/common/StatusPill";
import { useAdminAuthStore } from "@/stores/authStore";
import { cn, formatINR } from "@/lib/utils";

/**
 * Super-admin Sub-Brokers section: every broker across every admin pool, in a
 * master-detail layout (mirrors the per-admin Brokers page). Read-only roll-up
 * — click a broker on the left, its profile + permissions open on the right.
 */

const PERMISSION_LABELS: Array<{ key: string; label: string }> = [
  { key: "users", label: "Users" },
  { key: "kyc", label: "KYC review" },
  { key: "deposits", label: "Deposits" },
  { key: "withdrawals", label: "Withdrawals" },
  { key: "banks", label: "Bank accounts" },
  { key: "segment_settings", label: "Segment settings" },
  { key: "risk", label: "Risk management" },
  { key: "netting", label: "Netting overrides" },
  { key: "trading_view", label: "Positions & Orders" },
  { key: "ledger", label: "Ledger" },
  { key: "reports", label: "Reports" },
  { key: "brokerage", label: "Brokerage" },
  { key: "sub_brokers", label: "Sub-brokers" },
  { key: "bonuses", label: "Bonuses" },
  { key: "user_password", label: "Change password" },
  { key: "support", label: "Support" },
];

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value ?? "—"}</div>
    </div>
  );
}

function PermChip({ label, level }: { label: string; level: string }) {
  const lv = String(level || "OFF").toUpperCase();
  const tone =
    lv === "EDIT"
      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      : lv === "VIEW"
        ? "bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/20"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      {label} · {lv}
    </span>
  );
}

function Pager({
  page,
  totalPages,
  busy,
  onPage,
}: {
  page: number;
  totalPages: number;
  busy?: boolean;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={page <= 1 || busy}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border border-border px-3 py-1.5 font-medium disabled:opacity-40"
      >
        Prev
      </button>
      <span className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages || busy}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border border-border px-3 py-1.5 font-medium disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export default function SubBrokersPage() {
  const me = useAdminAuthStore((s) => s.admin);
  const isSuperAdmin = me?.role === "SUPER_ADMIN";
  const isAdmin = me?.role === "ADMIN";
  const isBroker = me?.role === "BROKER";
  const canView = isSuperAdmin || isAdmin || isBroker;
  const [q, setQ] = useState("");
  // Super-admin defaults to "all brokers" (the cross-pool roll-up); an admin /
  // broker defaults to "sub-brokers only" since that's the whole point of this
  // section for them.
  const [scope, setScope] = useState<"" | "sub">(isSuperAdmin ? "" : "sub");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Top filter: pick a broker → show only ITS sub-brokers. "" = all.
  const [parentFilter, setParentFilter] = useState<string>("");
  // Mobile master-detail: show the list, then the detail on tap (with a Back).
  const [mobileDetail, setMobileDetail] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "sub-brokers", { q, scope, role: me?.role }],
    queryFn: async () => {
      // Super-admin: cross-pool roll-up (every broker across every admin pool).
      if (isSuperAdmin) {
        return BrokerMgmtAPI.listAll({
          q: q || undefined,
          sub_only: scope === "sub",
          page: 1,
          page_size: 200,
        });
      }
      // Admin / broker: their OWN pool's brokers + sub-brokers. The list carries
      // `assigned_broker_id` per broker; a sub-broker is one with that set, and
      // its parent name is resolved from the same list (no extra request).
      const res = await BrokerMgmtAPI.list({
        q: q || undefined,
        include_sub: true,
        page: 1,
        page_size: 200,
      });
      const all: any[] = res?.items ?? [];
      const idToName = new Map<string, string>(
        all.map((b) => [String(b.id), b.full_name || b.user_code]),
      );
      const enriched = all.map((b) => ({
        ...b,
        is_sub: !!b.assigned_broker_id,
        parent_broker_name: b.assigned_broker_id
          ? idToName.get(String(b.assigned_broker_id)) ?? null
          : null,
      }));
      const filtered = scope === "sub" ? enriched.filter((b) => b.is_sub) : enriched;
      return { items: filtered, meta: { total: filtered.length } };
    },
    enabled: canView,
  });

  const items: any[] = data?.items ?? [];

  // Parent-broker dropdown options — every broker that has at least one
  // sub-broker in the list (id + name resolved from the subs themselves).
  const parentOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of items) {
      if (b.is_sub && b.assigned_broker_id) {
        m.set(String(b.assigned_broker_id), b.parent_broker_name || String(b.assigned_broker_id));
      }
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    );
  }, [items]);

  // Apply the top broker filter client-side.
  const displayItems = useMemo(
    () => (parentFilter ? items.filter((b) => String(b.assigned_broker_id) === parentFilter) : items),
    [items, parentFilter],
  );
  const total = displayItems.length;

  // Auto-select the first broker when the (filtered) list changes.
  useEffect(() => {
    if (displayItems.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !displayItems.some((b) => b.id === selectedId)) {
      setSelectedId(displayItems[0].id);
    }
  }, [displayItems, selectedId]);

  const selected = useMemo(
    () => displayItems.find((b) => b.id === selectedId) ?? null,
    [displayItems, selectedId],
  );

  // Detail tabs — Profile / Overview / Clients, mirroring the Brokers page.
  const [tab, setTab] = useState<"profile" | "overview" | "clients">("profile");
  useEffect(() => { setTab("profile"); }, [selectedId]);

  // Overview — money rollup (deposits/withdrawals/brokerage) via the shared
  // broker report, and the broker's closed trades (open/close/P&L/brokerage),
  // paged 15. Both lazy-load only when the Overview tab is open.
  const { data: report } = useQuery({
    queryKey: ["admin", "broker-report", selectedId],
    queryFn: () => BrokerMgmtAPI.report(selectedId as string),
    enabled: !!selectedId && tab === "overview",
  });
  const [tradePage, setTradePage] = useState(1);
  useEffect(() => { setTradePage(1); }, [selectedId]);
  const { data: closed, isFetching: closedFetching } = useQuery({
    queryKey: ["admin", "broker-closed-trades", selectedId, tradePage],
    queryFn: () =>
      TradingAPI.positionsPaged({ status: "CLOSED", broker_id: selectedId, page: tradePage, page_size: 15 }),
    enabled: !!selectedId && tab === "overview",
    placeholderData: (prev) => prev,
  });

  // Clients — the broker's whole subtree (its clients + sub-brokers' clients).
  const [clientPage, setClientPage] = useState(1);
  useEffect(() => { setClientPage(1); }, [selectedId]);
  const { data: clients } = useQuery({
    queryKey: ["admin", "broker-clients", selectedId, clientPage],
    queryFn: () => BrokerMgmtAPI.listSubtreeUsers(selectedId as string, { page: clientPage, page_size: 15 }),
    enabled: !!selectedId && tab === "clients",
    placeholderData: (prev) => prev,
  });

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title="Sub-Brokers" />
        <p className="text-sm text-muted-foreground">You don't have access to this section.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sub-Brokers"
        description={
          isSuperAdmin
            ? "Every broker across all admin pools — select one to see its details."
            : "Your brokers' sub-brokers — each shows the broker it sits under."
        }
        actions={
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
            {total} total
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* ── Left: search + list ── (hidden on mobile once a broker is open) */}
        <div className={cn("rounded-xl border border-border bg-card", mobileDetail && "hidden lg:block")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Code, name, email, mobile…"
                className="pl-9"
              />
            </div>
            {/* Top filter: pick a broker → only its sub-brokers. */}
            {parentOptions.length > 0 && (
              <select
                value={parentFilter}
                onChange={(e) => setParentFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-medium"
              >
                <option value="">All brokers' sub-brokers</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    Under {p.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "" | "sub")}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">All brokers</option>
              <option value="sub">Sub-brokers only</option>
            </select>
            <div className="text-xs text-muted-foreground">{displayItems.length} shown</div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {displayItems.map((b) => {
              const active = b.id === selectedId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(b.id);
                    setMobileDetail(true);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active ? "bg-primary/10" : "hover:bg-muted/50",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          String(b.status).toUpperCase() === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground",
                        )}
                      />
                      <span className="truncate font-semibold">{b.full_name || b.user_code}</span>
                      {b.is_sub && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-500">
                          Sub
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{b.user_code}</div>
                    {/* Highlight which broker this sub-broker sits under. */}
                    {b.is_sub && b.parent_broker_name && (
                      <div className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <CornerDownRight className="size-3 shrink-0" />
                        <span className="truncate">under {b.parent_broker_name}</span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-tabular text-sm font-bold tabular-nums">{b.user_count ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">users</div>
                  </div>
                </button>
              );
            })}
            {!isFetching && displayItems.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No sub-brokers found.</p>
            )}
          </div>
        </div>

        {/* ── Right: selected broker detail ── (full screen on mobile) */}
        <div className={cn("rounded-xl border border-border bg-card", !mobileDetail && "hidden lg:block")}>
          {!selected ? (
            <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-muted-foreground">
              Select a broker to see details.
            </div>
          ) : (
            <div className="p-4 sm:p-6">
              <button
                type="button"
                onClick={() => setMobileDetail(false)}
                className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground lg:hidden"
              >
                <ChevronLeft className="size-4" /> Back to list
              </button>
              {/* Header */}
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold">{selected.full_name || selected.user_code}</h2>
                <StatusPill status={selected.status} />
                {selected.is_sub && (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-500">
                    Sub-broker
                  </span>
                )}
              </div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">{selected.user_code}</div>

              {/* Tabs — Profile / Overview / Clients (same as the Brokers page). */}
              <div className="mt-5 flex gap-5 border-b border-border">
                {(["profile", "overview", "clients"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "-mb-px border-b-2 pb-2 text-sm font-medium capitalize transition-colors",
                      tab === t
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* ── Profile ── */}
              {tab === "profile" && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-border p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Details
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                      <Field label="Code" value={selected.user_code} />
                      <Field label="Name" value={selected.full_name} />
                      <Field label="Email" value={selected.email} />
                      <Field label="Mobile" value={selected.mobile} />
                      <Field label="Type" value={selected.is_sub ? "Sub-broker" : "Broker"} />
                      {isSuperAdmin && (
                        <Field label="Admin pool" value={selected.assigned_admin_name || "Platform"} />
                      )}
                      {selected.is_sub && (
                        <Field
                          label="Parent broker"
                          value={
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                              <CornerDownRight className="size-3" />
                              {selected.parent_broker_name || "—"}
                            </span>
                          }
                        />
                      )}
                      <Field label="PnL share" value={`${selected.pnl_share_pct ?? "0"}%`} />
                      <Field label="Brokerage share" value={`${selected.brokerage_share_pct ?? "0"}%`} />
                      <Field
                        label="Direct users"
                        value={
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3.5 text-muted-foreground" />
                            {selected.user_count ?? 0}
                          </span>
                        }
                      />
                      <Field label="Subtree users" value={selected.subtree_user_count ?? selected.user_count ?? 0} />
                      <Field label="Online payment" value={selected.payment_gateway_enabled ? "On" : "Off"} />
                      <Field label="Created" value={fmtDate(selected.created_at)} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Permissions
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PERMISSION_LABELS.map((p) => (
                        <PermChip
                          key={p.key}
                          label={p.label}
                          level={(selected.permissions && selected.permissions[p.key]) || "OFF"}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Overview ── */}
              {tab === "overview" && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Deposits</div>
                      <div className="mt-1 font-tabular text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatINR(Number(report?.wallet?.total_deposits ?? 0))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Withdrawals</div>
                      <div className="mt-1 font-tabular text-base font-bold tabular-nums text-red-600 dark:text-red-400">
                        {formatINR(Number(report?.wallet?.total_withdrawals ?? 0))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Brokerage</div>
                      <div className="mt-1 font-tabular text-base font-bold tabular-nums text-primary">
                        {formatINR(Number(report?.wallet?.total_brokerage ?? 0))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">Closed trades</div>
                      <div className="text-xs text-muted-foreground">{closed?.total ?? 0} total</div>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="px-3 py-2 font-medium">Closed</th>
                            <th className="px-3 py-2 font-medium">User</th>
                            <th className="px-3 py-2 font-medium">Symbol</th>
                            <th className="px-3 py-2 font-medium">Side</th>
                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                            <th className="px-3 py-2 text-right font-medium">Open</th>
                            <th className="px-3 py-2 text-right font-medium">Close</th>
                            <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                            <th className="px-3 py-2 text-right font-medium">Brokerage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(closed?.rows ?? []).map((t: any) => {
                            const cur = t.currency_quote === "USD" ? "$" : "₹";
                            const pnl = Number(t.realized_pnl ?? 0);
                            const buy = String(t.opened_side).toUpperCase() === "BUY";
                            return (
                              <tr key={t.id} className="border-b border-border/60">
                                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmtDate(t.closed_at)}</td>
                                <td className="px-3 py-2">
                                  <div className="truncate font-medium">{t.user_name || "—"}</div>
                                  <div className="truncate font-mono text-[10px] text-muted-foreground">{t.user_code}</div>
                                </td>
                                <td className="px-3 py-2">{t.symbol}</td>
                                <td className="px-3 py-2">
                                  <span className={buy ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-red-600 dark:text-red-400"}>
                                    {t.opened_side ?? "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-tabular tabular-nums">{t.opening_quantity ?? t.quantity}</td>
                                <td className="px-3 py-2 text-right font-tabular tabular-nums">{cur}{t.avg_price}</td>
                                <td className="px-3 py-2 text-right font-tabular tabular-nums">{cur}{t.ltp}</td>
                                <td className={cn("whitespace-nowrap px-3 py-2 text-right font-tabular font-semibold tabular-nums", pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                                  {pnl >= 0 ? "+" : "-"}{formatINR(Math.abs(pnl))}
                                </td>
                                <td className="px-3 py-2 text-right font-tabular tabular-nums text-muted-foreground">{formatINR(Number(t.charges ?? 0))}</td>
                              </tr>
                            );
                          })}
                          {!closedFetching && (closed?.rows ?? []).length === 0 && (
                            <tr>
                              <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                No closed trades yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={tradePage} totalPages={closed?.total_pages ?? 1} busy={closedFetching} onPage={setTradePage} />
                  </div>
                </div>
              )}

              {/* ── Clients ── */}
              {tab === "clients" && (
                <div className="mt-4">
                  <div className="mb-2 text-sm text-muted-foreground">
                    {clients?.meta?.total ?? clients?.items?.length ?? 0} clients under this {selected.is_sub ? "sub-broker" : "broker"} (sub-brokers' clients included).
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Code</th>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Mobile</th>
                          <th className="px-3 py-2 font-medium">Role</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(clients?.items ?? []).map((u: any) => (
                          <tr key={u.id} className="border-b border-border/60">
                            <td className="px-3 py-2 font-mono text-xs">{u.user_code}</td>
                            <td className="px-3 py-2">{u.full_name || "—"}</td>
                            <td className="px-3 py-2">{u.mobile || "—"}</td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{u.role}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={String(u.status).toUpperCase() === "ACTIVE" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                                {u.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmtDate(u.created_at)}</td>
                          </tr>
                        ))}
                        {(clients?.items ?? []).length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                              No clients yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={clientPage} totalPages={clients?.meta?.total_pages ?? 1} onPage={setClientPage} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
