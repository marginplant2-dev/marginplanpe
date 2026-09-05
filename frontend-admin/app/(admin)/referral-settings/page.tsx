"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gift, Save } from "lucide-react";
import { ReferralSettingsAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";

export default function ReferralSettingsPage() {
  const { data } = useQuery({
    queryKey: ["admin", "referral-settings"],
    queryFn: () => ReferralSettingsAPI.get(),
  });

  const [enabled, setEnabled] = useState(true);
  const [reward, setReward] = useState("");
  const [minDep, setMinDep] = useState("");

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setReward(String(Number(data.reward_amount ?? 0)));
    setMinDep(String(Number(data.min_deposit ?? 0)));
  }, [data]);

  const mut = useMutation({
    mutationFn: () =>
      ReferralSettingsAPI.update({
        enabled,
        reward_amount: Number(reward) || 0,
        min_deposit: Number(minDep) || 0,
      }),
    onSuccess: () => toast.success("Referral settings saved"),
    onError: (e: any) => toast.error(e?.message || "Failed to save"),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Referral Settings"
        description="Set the reward your users earn for a successful referral, and the minimum deposit that qualifies it."
      />

      <Card className="max-w-lg">
        <CardContent className="space-y-5 p-5">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Gift className="size-4 text-primary" /> Referral programme
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-5 cursor-pointer accent-primary"
            />
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="reward">Reward per successful referral (₹)</Label>
            <Input
              id="reward"
              type="number"
              min={0}
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              placeholder="e.g. 100"
            />
            <p className="text-[11px] text-muted-foreground">
              Credited straight to the referrer’s wallet (withdrawable) once qualified.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mindep">Minimum deposit to qualify (₹)</Label>
            <Input
              id="mindep"
              type="number"
              min={0}
              value={minDep}
              onChange={(e) => setMinDep(e.target.value)}
              placeholder="e.g. 500"
            />
            <p className="text-[11px] text-muted-foreground">
              The referred user must deposit at least this much AND open ≥ 1 trade before
              the reward is paid.
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Applies to <b>your pool</b>. A referred user joins the referrer’s same
            broker/admin. Reward + min-deposit are read from the referrer’s admin (you).
          </div>

          <div className="flex justify-end">
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              <Save className="size-4" /> {mut.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
