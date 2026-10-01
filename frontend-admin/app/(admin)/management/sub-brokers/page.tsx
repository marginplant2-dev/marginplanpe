"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { BrokerMgmtAPI } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusPill } from "@/components/common/StatusPill";
import { useAdminAuthStore } from "@/stores/authStore";

/**
 * Super-admin Sub-Brokers section: every broker across every admin pool, so the
 * super-admin can see how many brokers/sub-brokers exist, under which admin, and
 * how many users each carries. Read-only roll-up — broker CRUD stays on the
 * per-admin Brokers page. Drill into a broker's users via the All Users page's
 * Admin → Broker filter.
 */
export default function SubBrokersPage() {
  const me = useAdminAuthStore((s) => s.admin);
  const isSuperAdmin = me?.role === "SUPER_ADMIN";
  const [q, setQ] = useState("");
  // "" = all brokers, "sub" = only true sub-brokers (a broker under a broker).
  const [scope, setScope] = useState<"" | "sub">("");

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "sub-brokers", { q, scope }],
    queryFn: () =>
      BrokerMgmtAPI.listAll({
        q: q || undefined,
        sub_only: scope === "sub",
        page: 1,
        page_size: 200,
      }),
    enabled: isSuperAdmin,
  });

  const total = data?.meta?.total ?? 0;

  const columns: Column<any>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.user_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.full_name || "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    { key: "mobile", header: "Mobile", render: (r) => <span className="text-xs">{r.mobile || "—"}</span> },
    {
      key: "type",
      header: "Type",
      render: (r) =>
        r.is_sub ? (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
            Sub-broker{r.parent_broker_name ? ` · ${r.parent_broker_name}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
            Broker
          </span>
        ),
    },
    { key: "admin", header: "Admin", render: (r) => <span className="text-xs">{r.assigned_admin_name || "Platform"}</span> },
    {
      key: "users",
      header: "Users",
      align: "right",
      render: (r) => (
        <span className="font-tabular tabular-nums text-xs">
          {r.user_count}
          {r.subtree_user_count != null && r.subtree_user_count !== r.user_count
            ? ` (${r.subtree_user_count} total)`
            : ""}
        </span>
      ),
    },
    {
      key: "pnl",
      header: "P&L share",
      align: "right",
      render: (r) => <span className="font-tabular tabular-nums text-xs">{r.pnl_share_pct ?? "0"}%</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
  ];

  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Sub-Brokers" />
        <p className="text-sm text-muted-foreground">This section is available to the super-admin only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sub-Brokers"
        description={`${total} broker${total === 1 ? "" : "s"} across all admin pools${
          scope === "sub" ? " (sub-brokers only)" : ""
        }`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code / email / mobile / name"
            className="pl-9"
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "" | "sub")}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">All brokers</option>
          <option value="sub">Sub-brokers only</option>
        </select>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={data?.items}
          keyExtractor={(r) => r.id}
          loading={isFetching && !data}
          empty="No brokers found."
        />
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {(data?.items ?? []).map((r: any) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.full_name || "—"}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{r.user_code}</div>
              </div>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{r.is_sub ? `Sub-broker${r.parent_broker_name ? ` · ${r.parent_broker_name}` : ""}` : "Broker"}</span>
              <span>Admin: {r.assigned_admin_name || "Platform"}</span>
              <span>
                Users: {r.user_count}
                {r.subtree_user_count != null && r.subtree_user_count !== r.user_count
                  ? ` (${r.subtree_user_count} total)`
                  : ""}
              </span>
              <span>P&L {r.pnl_share_pct ?? "0"}%</span>
            </div>
          </div>
        ))}
        {!isFetching && (data?.items ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No brokers found.</p>
        )}
      </div>
    </div>
  );
}
