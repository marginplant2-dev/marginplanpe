"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Share2, Gift, Users, Wallet, Check } from "lucide-react";
import { ReferralAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { formatINR } from "@/lib/utils";

export default function ReferPage() {
  const { data } = useQuery({ queryKey: ["referral"], queryFn: () => ReferralAPI.mine() });
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const link = useMemo(() => {
    if (typeof window === "undefined" || !data?.referral_code) return "";
    return `${window.location.origin}/register?rc=${data.referral_code}`;
  }, [data?.referral_code]);

  const reward = Number(data?.reward_amount ?? 0);
  const minDep = Number(data?.min_deposit ?? 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — long-press to copy");
    }
  }

  async function copyCode() {
    if (!data?.referral_code) return;
    try {
      await navigator.clipboard.writeText(data.referral_code);
      setCodeCopied(true);
      toast.success("Referral code copied");
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — long-press to copy");
    }
  }

  async function share() {
    const text = `Join me on this trading app — sign up with my link and start trading:\n${link}`;
    try {
      if (navigator.share) await navigator.share({ title: "Refer & Earn", text, url: link });
      else await copy();
    } catch {
      /* user cancelled share sheet */
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Refer & Earn" description="Invite friends and earn when they start trading." />

      {/* Earnings cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="size-4 text-primary" /> Successful referrals
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {data?.successful_referrals ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="size-4 text-emerald-500" /> Total earned
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-500">
              {formatINR(Number(data?.total_earned ?? 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Referral link */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="text-sm font-semibold">Your referral link</div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs">{link || "…"}</code>
            <button
              onClick={copy}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Copy link"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={copy}>
              <Copy className="size-4" /> Copy link
            </Button>
            <Button onClick={share}>
              <Share2 className="size-4" /> Share
            </Button>
          </div>

          {/* Referral CODE — prominent + own copy button. A friend can type this
              straight into the "Referral code" box on the register page. */}
          <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
            <div className="text-[11px] text-muted-foreground">Referral code</div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="font-mono text-xl font-bold tracking-[0.2em] text-primary">
                {data?.referral_code ?? "…"}
              </span>
              <button
                onClick={copyCode}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                aria-label="Copy referral code"
              >
                {codeCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {codeCopied ? "Copied" : "Copy code"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Friend can enter this code on the sign-up page.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Conditions */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="size-4 text-primary" /> How it works
          </div>
          {data?.enabled === false ? (
            <p className="text-sm text-muted-foreground">
              Referrals are currently turned off. Please check back later.
            </p>
          ) : (
            <ol className="space-y-1.5 text-sm text-muted-foreground">
              <li>1. Share your link with a friend.</li>
              <li>2. They sign up and <b>deposit at least {formatINR(minDep)}</b>.</li>
              <li>3. They <b>open at least 1 trade</b>.</li>
              <li>
                4. You get <b className="text-emerald-500">{formatINR(reward)}</b> added
                straight to your wallet — withdrawable.
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Referral list */}
      {(data?.referrals?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="p-2">
            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Your referrals</div>
            <div className="divide-y divide-border">
              {data.referrals.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.deposit_met ? "✓ Deposited" : "• Not deposited"} ·{" "}
                      {r.trade_met ? "✓ Traded" : "• No trade"}
                    </div>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold " +
                      (r.status === "PAID"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {r.status === "PAID" ? `Earned ${formatINR(Number(r.reward))}` : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
