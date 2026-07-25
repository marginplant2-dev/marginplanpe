"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { ReportPdfButton } from "@/components/common/ReportPdfButton";
import { DateRangeBar, toIsoFrom, toIsoTo, type DateRange } from "@/components/common/DateRangeBar";
import { Card } from "@/components/ui/card";

// Reports = ONE deliverable: pick a date range and download the tradebook.
// The operator removed every other report section (P&L / Brokerage / Margin)
// and the on-page trade list/table/pagination — this page is intentionally
// just the range picker + the download buttons, identical on mobile and web.
export default function TradebookPage() {
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: iso(from), to: iso(to) };
  });

  // limit=2000 (the endpoint's max) so the Simple PDF never truncates to the
  // server default of 500 rows now that the on-screen table (which used to send
  // limit) is gone. Full Tradebook fetches its own rows and needs no limit.
  const params = useMemo(
    () => ({ from_date: toIsoFrom(range.from), to_date: toIsoTo(range.to), limit: 2000 }),
    [range],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tradebook"
        description="Choose a date range and download your trade book."
      />

      <DateRangeBar value={range} onChange={setRange} />

      <Card className="p-4">
        <div className="text-sm font-medium">Download tradebook</div>
        <div className="mt-1 text-xs text-muted-foreground">
          For the selected period ({range.from} → {range.to}).
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <ReportPdfButton kind="tradebook" params={{ ...params }} label="Simple PDF" />
          <ReportPdfButton
            kind="tradebook/full"
            params={{ from_date: toIsoFrom(range.from), to_date: toIsoTo(range.to) }}
            label="Full Tradebook"
          />
        </div>
      </Card>
    </div>
  );
}
