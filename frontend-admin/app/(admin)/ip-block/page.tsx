"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Trash2, Globe, ShieldAlert } from "lucide-react";
import { IpBlockAPI, type BlockedIp } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { useAdminAuthStore } from "@/stores/authStore";
import { canSee, isSuperAdmin } from "@/lib/permissions";

// Mongo timestamps arrive naive-UTC — pin Z before formatting to IST.
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

function RangeBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
      range
    </span>
  );
}

export default function IpBlockPage() {
  const qc = useQueryClient();
  const admin = useAdminAuthStore((s) => s.admin);
  const superAdmin = isSuperAdmin(admin);
  const allowed = canSee(admin, "ip_blocking");

  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [asRange, setAsRange] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: mine = [], isFetching } = useQuery({
    queryKey: ["ip-block", "mine"],
    queryFn: IpBlockAPI.list,
    enabled: allowed,
    refetchInterval: 30_000,
  });

  const { data: all = [] } = useQuery({
    queryKey: ["ip-block", "all"],
    queryFn: IpBlockAPI.listAll,
    enabled: allowed && superAdmin,
    refetchInterval: 30_000,
  });

  const addMut = useMutation({
    mutationFn: () => IpBlockAPI.add(ip.trim(), reason.trim() || undefined, asRange),
    onSuccess: () => {
      setIp("");
      setReason("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["ip-block"] });
    },
    onError: (e: any) => setErr(e?.message || "Could not block that IP"),
  });

  const removeMut = useMutation({
    mutationFn: (ip: string) => IpBlockAPI.remove(ip),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ip-block"] }),
  });

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title="IP Block" description="Ban IPs from your pool." />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You don&apos;t have permission to manage IP blocks.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="IP Block"
        description="Ban an IP address — anyone in your pool signing in from it is blocked (login refused and any live session kicked)."
      />

      {/* Add form */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                IP address
              </label>
              <Input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="IP or range — e.g. 106.78.2.68 or 106.78.2.0/24"
                className="h-9 font-tabular"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ip.trim()) addMut.mutate();
                }}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Reason (optional)
              </label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. multi-account / abuse"
                className="h-9"
              />
            </div>
            <Button
              onClick={() => addMut.mutate()}
              disabled={!ip.trim() || addMut.isPending}
              className="h-9 gap-1.5"
            >
              <Ban className="size-4" /> Block IP
            </Button>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm text-muted-foreground sm:items-center">
            <input
              type="checkbox"
              checked={asRange}
              onChange={(e) => setAsRange(e.target.checked)}
              className="mt-0.5 size-4 accent-primary sm:mt-0"
            />
            <span>
              Block the whole range (recommended for mobile) — a single IP is expanded to its
              block (IPv4 /24, IPv6 /64), so a user who keeps changing IP stays blocked.
            </span>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Tip: mobile users hop IPs and often use IPv6 (long addresses like 2402:3a80:…), so
            one exact IP rarely stops them. To ban a specific person for good, block their
            account in <span className="font-medium">All users</span>.
          </p>
          {err && <p className="mt-2 text-sm text-red-500">{err}</p>}
        </CardContent>
      </Card>

      {/* My blocklist */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <ShieldAlert className="size-4 text-primary" />
            <span className="font-semibold tabular-nums">{mine.length}</span>
            <span className="text-muted-foreground">
              blocked IP{mine.length === 1 ? "" : "s"} in your pool
            </span>
          </div>
          <IpTable rows={mine} onRemove={(ip) => removeMut.mutate(ip)} removing={removeMut.isPending} />
          {mine.length === 0 && !isFetching && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No IPs blocked yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Super-admin: master list across all pools */}
      {superAdmin && all.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <Globe className="size-4 text-violet-500" />
              <span className="font-semibold">All blocks across every pool</span>
              <span className="text-muted-foreground">({all.length})</span>
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-medium">IP</th>
                    <th className="px-3 py-2 font-medium">Blocked in pool</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">By</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-tabular font-medium">{r.ip}<RangeBadge show={r.is_cidr} /></td>
                      <td className="px-3 py-2.5">{r.admin_label || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.reason || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.created_by_name || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{fmt(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 sm:hidden">
              {all.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-tabular font-medium">{r.ip}<RangeBadge show={r.is_cidr} /></span>
                    <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-500">
                      {r.admin_label || "—"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{r.reason || "No reason"}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {r.created_by_name || "—"} · {fmt(r.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IpTable({
  rows,
  onRemove,
  removing,
}: {
  rows: BlockedIp[];
  onRemove: (ip: string) => void;
  removing: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Added by</th>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                <td className="px-3 py-2.5 font-tabular font-medium">{r.ip}<RangeBadge show={r.is_cidr} /></td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.reason || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.created_by_name || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{fmt(r.created_at)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-red-500"
                    disabled={removing}
                    onClick={() => onRemove(r.ip)}
                  >
                    <Trash2 className="size-3.5" /> Unblock
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-tabular font-medium">{r.ip}<RangeBadge show={r.is_cidr} /></span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-red-500"
                disabled={removing}
                onClick={() => onRemove(r.ip)}
              >
                <Trash2 className="size-3.5" /> Unblock
              </Button>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{r.reason || "No reason"}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {r.created_by_name || "—"} · {fmt(r.created_at)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
