"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, X, Check, Trash2, ChevronLeft } from "lucide-react";
import { InstrumentAPI, MarketwatchAPI, SegmentSettingsAPI } from "@/lib/api";
import { useMarketStream } from "@/lib/useMarketStream";
import { cn } from "@/lib/utils";
import { InstrumentIcon } from "./InstrumentIcon";
import { InstrumentRow, livePrice, formatExpiryShort } from "./instrumentRow";

interface Props {
  activeToken: string | null;
  onSelect: (
    token: string,
    seed?: {
      ltp?: number | null;
      bid?: number | null;
      ask?: number | null;
      symbol?: string | null;
      exchange?: string | null;
      segment?: string | null;
    },
  ) => void;
}

// Segment tabs for the "Add scripts" screen (Zerodha-style). `admin` is the
// backend segment-settings row used to hide a segment the pool disabled.
type AddSeg = { key: string; label: string; segments: string; admin: string };
const ADD_SEGMENTS: AddSeg[] = [
  { key: "nse_fut", label: "Futures", admin: "NSE_FUT", segments: "NSE_FUTURE,NSE_INDEX_FUTURE" },
  { key: "nse_opt", label: "Options", admin: "NSE_OPT", segments: "NSE_INDEX_OPTION_BUY,NSE_INDEX_OPTION_SELL,NSE_STOCK_OPTION_BUY,NSE_STOCK_OPTION_SELL" },
  { key: "nse_eq", label: "NSE EQ", admin: "NSE_EQ", segments: "NSE_EQUITY" },
  { key: "bse_eq", label: "BSE EQ", admin: "BSE_EQ", segments: "BSE_EQUITY" },
  { key: "mcx_fut", label: "MCX", admin: "MCX_FUT", segments: "MCX_FUTURE" },
  { key: "mcx_opt", label: "MCX OPT", admin: "MCX_OPT", segments: "MCX_OPTION_BUY,MCX_OPTION_SELL" },
  { key: "indices", label: "Indices", admin: "INDICES", segments: "INDICES" },
  { key: "forex", label: "Forex", admin: "FOREX", segments: "FOREX" },
  { key: "crypto", label: "Crypto", admin: "CRYPTO", segments: "CRYPTO_PERPETUAL,CRYPTO_SPOT,CRYPTO_FUTURE" },
  { key: "commodities", label: "Commodities", admin: "COMMODITIES", segments: "COMMODITIES" },
  { key: "stocks", label: "Stocks", admin: "STOCKS", segments: "STOCKS" },
];

export function MobileWatchlist({ activeToken, onSelect }: Props) {
  const qc = useQueryClient();
  const [selectedWlId, setSelectedWlId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: watchlists } = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => MarketwatchAPI.list(),
    staleTime: 30_000,
  });

  // Keep a valid selection as lists load / change.
  useEffect(() => {
    if (!watchlists || watchlists.length === 0) return;
    if (!selectedWlId || !watchlists.some((w: any) => w.id === selectedWlId)) {
      setSelectedWlId(watchlists[0].id);
    }
  }, [watchlists, selectedWlId]);

  const activeWl = useMemo(
    () => watchlists?.find((w: any) => w.id === selectedWlId) ?? watchlists?.[0] ?? null,
    [watchlists, selectedWlId],
  );

  // Live quotes for the selected watchlist's items.
  const { data: wlQuotes } = useQuery({
    queryKey: ["watchlist-quotes", activeWl?.id],
    queryFn: () => MarketwatchAPI.quotes(activeWl!.id),
    enabled: !!activeWl?.id,
    refetchInterval: 3000,
    staleTime: 2000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const itemTokens = useMemo(
    () => (activeWl?.items ?? []).map((it: any) => String(it.instrument_token)).slice(0, 40),
    [activeWl],
  );
  const streamQuotes = useMarketStream(addOpen ? [] : itemTokens);
  const quoteByToken = useMemo(() => {
    const m = new Map<string, any>();
    for (const q of wlQuotes ?? []) m.set(String(q.instrument_token ?? q.token), q);
    streamQuotes.forEach((q, tok) => m.set(tok, q));
    return m;
  }, [wlQuotes, streamQuotes]);

  // Item-id lookup so a swipe/remove can resolve the WatchlistItem id.
  const itemIdByToken = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of activeWl?.items ?? []) {
      if (it?.instrument_token && it?.id) m.set(String(it.instrument_token), String(it.id));
    }
    return m;
  }, [activeWl]);

  async function removeFromWl(token: string) {
    if (!activeWl?.id) return;
    const itemId = itemIdByToken.get(String(token));
    if (!itemId) return;
    try {
      await MarketwatchAPI.removeItem(activeWl.id, itemId);
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      qc.invalidateQueries({ queryKey: ["watchlist-quotes"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    }
  }

  async function createWatchlist() {
    const name = window.prompt("New watchlist name");
    if (!name || !name.trim()) return;
    try {
      const res = await MarketwatchAPI.create(name.trim());
      await qc.invalidateQueries({ queryKey: ["watchlists"] });
      if (res?.id) setSelectedWlId(res.id);
      toast.success(`Created "${name.trim()}"`, { duration: 1500 });
    } catch (e: any) {
      toast.error(e?.message || "Could not create watchlist");
    }
  }

  async function deleteWatchlist(id: string, name: string) {
    if (!window.confirm(`Delete watchlist "${name}"? Its scripts will be removed.`)) return;
    try {
      await MarketwatchAPI.delete(id);
      await qc.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedWlId(null);
      toast.success("Watchlist deleted", { duration: 1500 });
    } catch (e: any) {
      toast.error(e?.message || "Could not delete");
    }
  }

  const rows = wlQuotes ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Watchlist selector — tabs per watchlist + create. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(watchlists ?? []).map((w: any) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedWlId(w.id)}
              onDoubleClick={() => deleteWatchlist(w.id, w.name)}
              title="Double-tap to delete"
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-bold transition-colors",
                activeWl?.id === w.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-foreground/70 hover:bg-muted/40",
              )}
            >
              {w.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={createWatchlist}
          aria-label="New watchlist"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Items of the selected watchlist. */}
      <div
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain scrollbar-thin"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {rows.length === 0 ? (
          <div className="grid h-40 place-items-center px-6 text-center text-xs text-muted-foreground">
            <div>
              <p className="mb-3">No scripts in this watchlist yet.</p>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                <Plus className="size-4" /> Add scripts
              </button>
            </div>
          </div>
        ) : (
          rows.map((q: any) => {
            const token = String(q.instrument_token ?? q.token ?? "");
            const live = quoteByToken.get(token);
            const bid = livePrice(live?.bid) ?? livePrice(q.bid);
            const ask = livePrice(live?.ask) ?? livePrice(q.ask);
            const ltp =
              livePrice(live?.ltp) ??
              livePrice(q.ltp) ??
              livePrice(live?.last_ltp) ??
              livePrice(q.last_ltp);
            const changePct = live?.change_pct ?? q.change_pct ?? null;
            return (
              <InstrumentRow
                key={token}
                token={token}
                symbol={q.symbol}
                exchange={q.exchange}
                segment={q.segment ?? q.instrument_type}
                expiry={q.expiry ?? null}
                bid={bid}
                ask={ask}
                ltp={ltp}
                changePct={changePct}
                priced
                isActive={token === String(activeToken)}
                onSelect={() =>
                  onSelect(token, {
                    ltp,
                    bid,
                    ask,
                    symbol: q.symbol,
                    exchange: q.exchange,
                    segment: q.segment ?? q.instrument_type,
                  })
                }
                onDelete={() => removeFromWl(token)}
                rightAction={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromWl(token);
                    }}
                    aria-label={`Remove ${q.symbol}`}
                    className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted/40 hover:text-red-500"
                  >
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            );
          })
        )}
      </div>

      {/* Sticky Add-scripts button (Zerodha-style). */}
      {rows.length > 0 && (
        <div className="shrink-0 border-t border-border p-2.5">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground active:scale-[0.99]"
          >
            <Plus className="size-4" /> Add scripts
          </button>
        </div>
      )}

      {addOpen && activeWl?.id && (
        <AddScriptsSheet
          watchlistId={activeWl.id}
          watchlistName={activeWl.name}
          addedTokens={new Set((activeWl.items ?? []).map((it: any) => String(it.instrument_token)))}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ── Full-screen "Add scripts" search (segment tabs + search) ──────────
function AddScriptsSheet({
  watchlistId,
  watchlistName,
  addedTokens,
  onClose,
}: {
  watchlistId: string;
  watchlistName: string;
  addedTokens: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [segKey, setSegKey] = useState("nse_fut");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  // Local optimistic add/remove overlay on top of the server set.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 180);
    return () => clearTimeout(t);
  }, [search]);

  const { data: inactiveRows } = useQuery({
    queryKey: ["segment-settings", "inactive"],
    queryFn: () => SegmentSettingsAPI.inactive(),
    staleTime: 30_000,
  });
  const inactiveSet = useMemo(() => new Set(inactiveRows ?? []), [inactiveRows]);
  const segments = useMemo(
    () => ADD_SEGMENTS.filter((s) => !inactiveSet.has(s.admin)),
    [inactiveSet],
  );
  useEffect(() => {
    if (!segments.find((s) => s.key === segKey) && segments[0]) setSegKey(segments[0].key);
  }, [segments, segKey]);
  const seg = segments.find((s) => s.key === segKey) ?? segments[0];

  const { data: hits, isFetching } = useQuery<any[]>({
    queryKey: ["add-scripts", seg?.segments, debounced],
    queryFn: () =>
      InstrumentAPI.search(debounced || undefined, undefined, seg?.segments, 50),
    enabled: !!seg,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  function isAdded(token: string): boolean {
    const tok = String(token);
    if (pending.has(tok)) return pending.get(tok)!;
    return addedTokens.has(tok);
  }

  async function toggle(token: string, symbol: string) {
    const tok = String(token);
    const added = isAdded(tok);
    setPending((p) => new Map(p).set(tok, !added));
    try {
      if (added) {
        // Resolve item id from the freshest watchlist snapshot.
        const lists = qc.getQueryData<any[]>(["watchlists"]);
        const wl = lists?.find((w) => w.id === watchlistId);
        const item = wl?.items?.find((it: any) => String(it.instrument_token) === tok);
        if (item?.id) await MarketwatchAPI.removeItem(watchlistId, item.id);
      } else {
        await MarketwatchAPI.addItem(watchlistId, tok);
      }
      await qc.invalidateQueries({ queryKey: ["watchlists"] });
      qc.invalidateQueries({ queryKey: ["watchlist-quotes"] });
    } catch (e: any) {
      setPending((p) => {
        const n = new Map(p);
        n.delete(tok);
        return n;
      });
      toast.error(e?.message || (added ? "Failed to remove" : "Failed to add"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header + search */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted/40"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search scripts in ${seg?.label ?? ""}…`}
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear"
                className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted/40"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="truncate px-3 pb-1.5 text-[11px] text-muted-foreground">
          Adding to <span className="font-semibold text-foreground">{watchlistName}</span>
        </div>
        {/* Segment tabs */}
        <div className="-mb-px flex gap-1.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegKey(s.key)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-bold uppercase tracking-wide transition-colors",
                segKey === s.key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-foreground/70 hover:bg-muted/40",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results — name-only picker with +/✓ */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" style={{ WebkitOverflowScrolling: "touch" }}>
        {(hits ?? []).length === 0 ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">
            {isFetching ? "Loading…" : "No scripts found"}
          </div>
        ) : (
          (hits ?? []).map((s: any) => {
            const token = String(s.token);
            const added = isAdded(token);
            const expiry = formatExpiryShort(s.expiry);
            return (
              <div
                key={token}
                className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5"
              >
                <InstrumentIcon
                  symbol={s.symbol}
                  isCrypto={/^CRYPTO/i.test(s.segment || s.instrument_type || "")}
                  isForex={/^FOREX/i.test(s.segment || s.instrument_type || "")}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold tracking-tight">{s.symbol}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {s.exchange}
                    {expiry ? ` · ${expiry}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(token, s.symbol)}
                  aria-label={added ? `Remove ${s.symbol}` : `Add ${s.symbol}`}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border transition-colors",
                    added
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-500"
                      : "border-primary/50 text-primary hover:bg-primary/10",
                  )}
                >
                  {added ? <Check className="size-4" /> : <Plus className="size-4" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
