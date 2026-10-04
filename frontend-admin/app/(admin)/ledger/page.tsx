"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Minus, X as XIcon, Search } from "lucide-react";
import { LedgerAdminAPI, UsersAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusPill } from "@/components/common/StatusPill";
import { formatINR, pnlColor } from "@/lib/utils";

export default function MasterLedgerPage() {
  return (
    <Suspense fallback={null}>
      <MasterLedgerInner />
    </Suspense>
  );
}

function MasterLedgerInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const queryUserId = searchParams?.get("user_id") ?? null;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [type, setType] = useState("");

  // Reset to page 1 when switching to a different user filter, otherwise an
  // admin landing here from a user link can hit an empty page if their
  // previous view was deep into another user's ledger.
  useEffect(() => {
    setPage(1);
  }, [queryUserId]);

  const { data: scopedUser } = useQuery({
    queryKey: ["admin", "user", queryUserId],
    queryFn: () => UsersAPI.detail(queryUserId!),
    enabled: !!queryUserId,
    staleTime: 5 * 60_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "ledger", { type, page, pageSize, queryUserId }],
    queryFn: () =>
      LedgerAdminAPI.list({
        transaction_type: type || undefined,
        user_id: queryUserId || undefined,
        page,
        page_size: pageSize,
      }),
  });

  const total = data?.meta?.total ?? 0;

  // ── Add Fund / Deduct Fund ────────────────────────────────────────────
  // Credits (+) or debits (−) a user's wallet via the ledger manual-entry
  // (ADJUSTMENT) endpoint, which actually moves available_balance. The admin
  // picks the user by code/name/mobile instead of pasting a raw ObjectId.
  const [fundMode, setFundMode] = useState<"add" | "deduct" | null>(null);
  const [selectedUser, setSelectedUser] = useState<{ id: string; label: string } | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUserSearch(userSearch), 250);
    return () => clearTimeout(t);
  }, [userSearch]);

  const { data: userSearchData, isFetching: userSearching } = useQuery({
    queryKey: ["admin", "ledger", "user-search", debouncedUserSearch],
    queryFn: () => UsersAPI.list({ q: debouncedUserSearch, page: 1, page_size: 10 }),
    enabled: fundMode !== null && debouncedUserSearch.trim().length >= 2,
  });
  const userResults: any[] = userSearchData?.items ?? [];

  function openFund(mode: "add" | "deduct") {
    setFundMode(mode);
    setAmount("");
    setReason("");
    setUserSearch("");
    // Landed here filtered by a user → pre-select them.
    if (queryUserId) {
      const su = scopedUser as any;
      setSelectedUser({
        id: queryUserId,
        label: su?.user_code ? `${su.user_code}${su.full_name ? ` · ${su.full_name}` : ""}` : queryUserId.slice(-8),
      });
    } else {
      setSelectedUser(null);
    }
  }
  function closeFund() {
    setFundMode(null);
    setSelectedUser(null);
    setUserSearch("");
    setAmount("");
    setReason("");
  }

  async function submitFund() {
    const amt = Number(amount);
    if (!selectedUser) return toast.error("Pick a user first");
    if (!(amt > 0)) return toast.error("Enter a valid amount");
    if (!reason.trim()) return toast.error("A reason is required (audit trail)");
    setPosting(true);
    try {
      await LedgerAdminAPI.manualEntry({
        user_id: selectedUser.id,
        amount: fundMode === "add" ? amt : -amt,
        transaction_type: "ADJUSTMENT",
        narration: reason.trim(),
      });
      toast.success(
        `${fundMode === "add" ? "Added" : "Deducted"} ${formatINR(amt)} ${fundMode === "add" ? "to" : "from"} ${selectedUser.label}`,
      );
      closeFund();
      qc.invalidateQueries({ queryKey: ["admin", "ledger"] });
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? e?.message ?? "Failed to post entry");
    } finally {
      setPosting(false);
    }
  }

  const cols: Column<any>[] = [
    { key: "created_at", header: "When", render: (r) => new Date(r.created_at).toLocaleString() },
    { key: "user_code", header: "User" },
    { key: "transaction_type", header: "Type", render: (r) => <StatusPill status={r.transaction_type} /> },
    { key: "narration", header: "Narration", className: "max-w-[300px] truncate" },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => <span className={pnlColor(r.amount)}>{formatINR(r.amount)}</span>,
    },
    { key: "balance_after", header: "Balance", align: "right", render: (r) => formatINR(r.balance_after) },
  ];

  return (
    <div className="space-y-4">
      {queryUserId && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Filtered by user:</span>
          <span className="font-semibold text-primary">
            {(scopedUser as any)?.user_code ?? queryUserId.slice(-8)}
            {(scopedUser as any)?.full_name ? ` · ${(scopedUser as any).full_name}` : ""}
          </span>
          <Link
            href="/ledger"
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            aria-label="Clear user filter"
          >
            <XIcon className="size-3" />
          </Link>
        </div>
      )}

      <PageHeader
        title="Master ledger"
        description={`${data?.meta?.total ?? 0} ledger entries`}
        actions={
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => {
                setPage(1);
                setType(e.target.value);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">All types</option>
              <option value="DEPOSIT">Deposit</option>
              <option value="WITHDRAWAL">Withdrawal</option>
              <option value="TRADE">Trade</option>
              <option value="BROKERAGE">Brokerage</option>
              <option value="CHARGES">Charges</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="BONUS">Bonus</option>
              <option value="PENALTY">Penalty</option>
            </select>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => openFund("add")}
            >
              <Plus className="size-4" /> Add fund
            </Button>
            <Button variant="outline" onClick={() => openFund("deduct")}>
              <Minus className="size-4" /> Deduct fund
            </Button>
          </div>
        }
      />

      {/* Add / Deduct fund dialog */}
      <Dialog open={fundMode !== null} onOpenChange={(o) => !o && closeFund()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fundMode === "add" ? "Add fund to a user" : "Deduct fund from a user"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* User picker */}
            <div className="space-y-1.5">
              <Label>User</Label>
              {selectedUser ? (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                  <span className="text-sm font-semibold">{selectedUser.label}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(null)}
                    aria-label="Change user"
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search code / name / mobile…"
                      className="pl-8"
                    />
                  </div>
                  {debouncedUserSearch.trim().length >= 2 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                      {userResults.length === 0 ? (
                        <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                          {userSearching ? "Searching…" : "No users found"}
                        </div>
                      ) : (
                        userResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              setSelectedUser({
                                id: u.id,
                                label: `${u.user_code}${u.full_name ? ` · ${u.full_name}` : ""}`,
                              })
                            }
                            className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-mono text-xs text-muted-foreground">{u.user_code}</span>
                              {u.full_name ? ` · ${u.full_name}` : ""}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">{u.mobile || ""}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Mandatory reason / audit trail"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {fundMode === "add"
                ? "Credits the user's wallet (available balance) immediately."
                : "Debits the user's wallet (available balance) immediately."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeFund}>
              Cancel
            </Button>
            <Button
              onClick={submitFund}
              disabled={posting}
              className={fundMode === "add" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-600 text-white hover:bg-red-700"}
            >
              {posting ? "Posting…" : fundMode === "add" ? "Add fund" : "Deduct fund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DataTable columns={cols} rows={data?.items} keyExtractor={(r) => r.id} loading={isFetching && !data} />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[50, 100, 200]}
      />
    </div>
  );
}
