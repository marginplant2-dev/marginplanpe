"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { WalletAPI } from "@/lib/api";
import { formatINR } from "@/lib/utils";

/**
 * Divinepay UPI online pay-in — the auto-crediting deposit flow, rendered in
 * place of the manual bank-QR wizard when the super-admin enabled the gateway
 * for this user's pool. Two steps:
 *   1. amount → "Pay ₹X" opens the hosted checkout in a new tab.
 *   2. verify → paste the 12-digit UTR; the GATEWAY's success verdict credits
 *      the wallet (never the client's word). The 20 s server reconcile loop
 *      also auto-credits a paid order if the user never verifies.
 */
export function GatewayDepositFlow({
  onClose,
  onSuccess,
  adminMin,
  gatewayMin,
}: {
  onClose: () => void;
  onSuccess?: () => void;
  adminMin: number;
  gatewayMin: number;
}) {
  const effMin = Math.max(Number(adminMin) || 0, Number(gatewayMin) || 100);
  const [amtStr, setAmtStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<{ order_id: string; payment_url: string; amount: string } | null>(null);
  const [utr, setUtr] = useState("");

  const amount = Number(amtStr) || 0;

  async function pay() {
    if (amount < effMin) return toast.error(`Minimum deposit is ${formatINR(effMin)}`);
    if (busy) return;
    setBusy(true);
    try {
      const res = await WalletAPI.createGatewayDeposit(amount);
      setOrder({ order_id: res.order_id, payment_url: res.payment_url, amount: res.amount });
      window.open(res.payment_url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message || "Could not start payment");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!order) return;
    if (!/^\d{12}$/.test(utr.trim())) return toast.error("Enter the 12-digit UPI reference (UTR)");
    if (busy) return;
    setBusy(true);
    try {
      const res = await WalletAPI.submitGatewayUtr(order.order_id, utr.trim());
      if (res.status === "success" || res.credited || res.already_credited) {
        toast.success("Payment confirmed — wallet credited");
        onSuccess?.();
        onClose();
      } else {
        toast.message("Not confirmed yet", {
          description: "We haven't received your payment from the bank yet. It credits automatically once confirmed — try Verify again in a moment.",
        });
      }
    } catch (e: any) {
      toast.error(e?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-sm font-semibold">Add funds · UPI</div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
          <X className="size-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
        {!order ? (
          // ── Step 1: amount ──────────────────────────────────────────
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Enter amount</label>
              <div className="mt-1.5 flex items-center rounded-xl border border-border bg-muted/40 px-3">
                <span className="text-lg font-bold text-muted-foreground">₹</span>
                <input
                  inputMode="numeric"
                  autoFocus
                  value={amtStr}
                  onChange={(e) => setAmtStr(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  className="w-full bg-transparent px-2 py-3 text-2xl font-bold outline-none"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Min {formatINR(effMin)} · instant credit after payment
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[500, 1000, 2000, 5000].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmtStr(String((Number(amtStr) || 0) + n))}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  +{formatINR(n)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={pay}
              disabled={busy || amount < effMin}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#16A34A] to-[#22C55E] text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Starting…" : `Pay ${amount > 0 ? formatINR(amount) : ""}`}
            </button>
          </div>
        ) : (
          // ── Step 2: verify UTR ──────────────────────────────────────
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold">{formatINR(Number(order.amount))}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono text-[11px]">{order.order_id}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => window.open(order.payment_url, "_blank", "noopener,noreferrer")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 text-sm font-semibold text-primary hover:bg-primary/10"
            >
              <ExternalLink className="size-4" /> Reopen payment page
            </button>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Enter the 12-digit UPI reference (UTR) after paying
              </label>
              <input
                inputMode="numeric"
                maxLength={12}
                value={utr}
                onChange={(e) => setUtr(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="123456789012"
                className="mt-1.5 w-full rounded-xl border border-border bg-muted/40 px-3 py-3 font-mono text-lg tracking-widest outline-none focus:border-primary/50"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Find the 12-digit UTR / reference number in your UPI app's payment receipt.
              </p>
            </div>

            <button
              type="button"
              onClick={verify}
              disabled={busy || utr.trim().length !== 12}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#16A34A] to-[#22C55E] text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {busy ? "Verifying…" : "Verify & credit"}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">
              Already paid? It also credits automatically within a minute.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
