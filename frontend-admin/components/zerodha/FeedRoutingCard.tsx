"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";
import { ZerodhaAPI } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Kite exchange codes the operator routes. NIFTY opts = NFO, SENSEX opts = BFO,
// all MCX futures/options = MCX. (Map by Kite exchange code, not SegmentType.)
const EXCHANGES: { code: string; label: string }[] = [
  { code: "NSE", label: "NSE (equity)" },
  { code: "BSE", label: "BSE (equity)" },
  { code: "NFO", label: "NFO (NSE F&O)" },
  { code: "BFO", label: "BFO (SENSEX F&O)" },
  { code: "CDS", label: "CDS (currency)" },
  { code: "MCX", label: "MCX (commodities)" },
];

type AcctHealth = {
  account_index: number;
  label: string;
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  last_tick_age_sec: number | null;
};

function HealthPill({ acct }: { acct?: AcctHealth }) {
  const healthy = !!acct?.healthy;
  const configured = !!acct?.configured;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        !configured
          ? "border-neutral-700 bg-neutral-900 text-neutral-400"
          : healthy
            ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-400"
            : "border-red-600/40 bg-red-500/10 text-red-400",
      )}
    >
      {healthy ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
      <span className="font-semibold">Account {acct?.label ?? "?"}</span>
      <span className="opacity-80">
        {!configured
          ? "not configured"
          : healthy
            ? `HEALTHY${acct?.last_tick_age_sec != null ? ` · tick ${acct.last_tick_age_sec}s` : ""}`
            : acct?.connected
              ? "UNHEALTHY (stale)"
              : "DISCONNECTED"}
      </span>
    </div>
  );
}

export function FeedRoutingCard() {
  const qc = useQueryClient();
  const { data } = useQuery<any>({
    queryKey: ["zerodha-routing"],
    queryFn: () => ZerodhaAPI.routing(),
    refetchInterval: 3000, // live health/route pulse
  });

  const cfg = data?.config;
  const live = data?.live;

  const [map, setMap] = useState<Record<string, number>>({});
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  // Seed local edit state from server once (and whenever the doc changes and
  // we're not mid-edit — simple: only seed when map is empty).
  useEffect(() => {
    if (cfg?.exchange_account_map && Object.keys(map).length === 0) {
      setMap({ ...cfg.exchange_account_map });
      setFailoverEnabled(!!cfg.failover_enabled);
    }
  }, [cfg, map]);

  const save = async () => {
    setSaving(true);
    try {
      await ZerodhaAPI.updateRouting({
        exchange_account_map: map,
        failover_enabled: failoverEnabled,
      });
      toast.success("Feed routing saved");
      qc.invalidateQueries({ queryKey: ["zerodha-routing"] });
    } catch (e: any) {
      toast.error(e?.message || "Save failed (super-admin only)");
    } finally {
      setSaving(false);
    }
  };

  const testDisconnect = async (account: number) => {
    try {
      await ZerodhaAPI.failoverTestDisconnect(account);
      toast.success(`Account ${account === 0 ? "A" : "B"} WS dropped — watch failover`);
      qc.invalidateQueries({ queryKey: ["zerodha-routing"] });
    } catch (e: any) {
      toast.error(e?.message || "Test disconnect failed");
    }
  };

  const activeFailovers: Record<string, number> = live?.active_failovers || {};
  const effective: Record<string, number> = live?.effective_route || {};
  const hasFailover = Object.keys(activeFailovers).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-500" />
          Feed Routing &amp; Failover
        </CardTitle>
        <CardDescription>
          Normal: Account A = NSE/BSE (+ F&amp;O), Account B = MCX. If one account fails, the
          other streams everything automatically — <b>data never stops</b>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live health */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HealthPill acct={live?.accounts?.A} />
          <HealthPill acct={live?.accounts?.B} />
        </div>

        {/* Active failover banner */}
        {hasFailover && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <ShieldAlert className="h-4 w-4" />
            <span>
              Failover ACTIVE:{" "}
              {Object.entries(activeFailovers)
                .map(([ex, acct]) => `${ex} → Account ${acct === 0 ? "A" : "B"}`)
                .join(", ")}
            </span>
          </div>
        )}

        {/* Per-exchange routing */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Exchange → desired account
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EXCHANGES.map(({ code, label }) => {
              const desired = map[code] ?? 0;
              const eff = effective[code];
              const failedOver = eff != null && eff !== desired;
              return (
                <div
                  key={code}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-neutral-200">{label}</span>
                    {failedOver && (
                      <span className="text-xs text-amber-400">
                        now on {eff === 0 ? "A" : "B"} (failover)
                      </span>
                    )}
                  </div>
                  <select
                    value={desired}
                    onChange={(e) => setMap((m) => ({ ...m, [code]: Number(e.target.value) }))}
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                  >
                    <option value={0}>Account A</option>
                    <option value={1}>Account B</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Failover toggle */}
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={failoverEnabled}
            onChange={(e) => setFailoverEnabled(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          Automatic failover enabled
          <span className="text-neutral-500">
            (off = kill-switch: Account A carries everything)
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save routing"}
          </Button>
          {/* Off-market test helpers */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-neutral-500">Off-market test:</span>
            <Button variant="outline" size="sm" onClick={() => testDisconnect(0)}>
              Drop A
            </Button>
            <Button variant="outline" size="sm" onClick={() => testDisconnect(1)}>
              Drop B
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
