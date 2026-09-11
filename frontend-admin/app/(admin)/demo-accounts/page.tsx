"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Phone, RotateCcw } from "lucide-react";
import { DemoLeadsAPI } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";

// created_at / last_login_at arrive as naive-UTC ISO (no tz) from Mongo — pin
// Z so the browser reads them as UTC before formatting to IST.
function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z");
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export default function DemoAccountsPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  // Debounce the search box so we don't fire a query per keystroke.
  function onSearchChange(v: string) {
    setSearch(v);
    setPage(1);
    // simple debounce
    window.clearTimeout((onSearchChange as any)._t);
    (onSearchChange as any)._t = window.setTimeout(() => setDebounced(v.trim()), 300);
  }

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["demo-leads", debounced, page],
    queryFn: () => DemoLeadsAPI.list({ search: debounced || undefined, page, page_size: 50 }),
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.page_size || 50)));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Demo Accounts"
        description="Everyone who tried your demo — the name and mobile they entered before starting."
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-primary" />
              <span className="font-semibold tabular-nums">{total}</span>
              <span className="text-muted-foreground">demo leads</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search name or mobile"
                  className="h-9 pl-9"
                />
              </div>
              <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => refetch()}>
                <RotateCcw className={"size-4 " + (isFetching ? "animate-spin" : "")} />
              </Button>
            </div>
          </div>

          {/* ── Desktop table ── */}
          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Mobile</th>
                  <th className="px-3 py-2 text-center font-medium">Logins</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{r.name}</td>
                    <td className="px-3 py-2.5">
                      <a href={`tel:${r.mobile}`} className="font-tabular text-primary hover:underline">
                        {r.mobile}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-center font-tabular tabular-nums">{r.login_count}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmt(r.last_login_at)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmt(r.created_at)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      No demo leads yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="mt-4 space-y-2 sm:hidden">
            {items.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {r.login_count}× login
                  </span>
                </div>
                <a
                  href={`tel:${r.mobile}`}
                  className="mt-1 flex items-center gap-1.5 font-tabular text-sm text-primary"
                >
                  <Phone className="size-3.5" /> {r.mobile}
                </a>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Last seen {fmt(r.last_login_at)} · First {fmt(r.created_at)}
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="py-10 text-center text-muted-foreground">No demo leads yet.</div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
