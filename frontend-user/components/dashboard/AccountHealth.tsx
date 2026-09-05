"use client";

import { cn } from "@/lib/utils";

/**
 * Semicircular margin-usage gauge. Pure SVG, theme-token colours.
 *   usedPct 0–40  → Low  (green)
 *           40–70 → Medium (amber)
 *           70+   → High (red)
 */
export function AccountHealth({ usedPct }: { usedPct: number }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(usedPct) ? usedPct : 0));
  const risk =
    pct < 40
      ? { label: "Low", color: "#10b981", tone: "text-buy" }
      : pct < 70
        ? { label: "Medium", color: "#f59e0b", tone: "text-amber-500" }
        : { label: "High", color: "#ef4444", tone: "text-sell" };

  // Half-circle arc, radius 52, centred at (60,60), drawn left→right.
  const r = 52;
  const arc = Math.PI * r; // length of the semicircle
  const filled = (pct / 100) * arc;
  const path = `M 8 60 A ${r} ${r} 0 0 1 112 60`;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg viewBox="0 0 120 72" className="w-32">
          <path d={path} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-border" />
          <path
            d={path}
            fill="none"
            stroke={risk.color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${arc}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className={cn("text-sm font-bold", risk.tone)}>{risk.label} risk</div>
          <div className="text-[10px] text-muted-foreground">Good</div>
        </div>
      </div>
      <div className="flex-1 space-y-2 text-sm">
        <Line label="Margin usage" value={`${pct.toFixed(2)}%`} />
        <Line label="Risk level" value={risk.label} valueClass={risk.tone} />
        <Line label="Account health" value="Good" valueClass="text-buy" />
      </div>
    </div>
  );
}

function Line({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", valueClass ?? "text-foreground")}>{value}</span>
    </div>
  );
}
