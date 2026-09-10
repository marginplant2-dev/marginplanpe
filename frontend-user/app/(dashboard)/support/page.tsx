"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Paperclip, SendHorizonal, Sprout, X } from "lucide-react";
import { API_URL } from "@/lib/constants";
import { useBranding } from "@/lib/branding-context";
import { useAuthStore } from "@/stores/authStore";
import { SupportChatAPI, type SupportChatMessage } from "@/lib/api";
import {
  WA,
  WaBubble,
  WaDayChip,
  WaWallpaperStyles,
  waDayLabel,
} from "@/components/support/wa";
import { VoiceRecorder } from "@/components/support/VoiceRecorder";
import { cn } from "@/lib/utils";

export default function SupportChatPage() {
  const qc = useQueryClient();
  const router = useRouter();
  // Demo accounts don't get support chat — bounce to the dashboard even on a
  // direct URL hit.
  const isDemo = !!useAuthStore((s) => s.user)?.is_demo;
  useEffect(() => {
    if (isDemo) router.replace("/dashboard");
  }, [isDemo, router]);
  const { branding } = useBranding();
  const supportName = branding?.brand_name?.trim() || "Support";
  const logoUrl = branding?.logo_url ? `${API_URL}${branding.logo_url}` : null;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["support", "chat"],
    queryFn: () => SupportChatAPI.get(),
    // The WS bridge is the primary live path; this poll is the fallback for a
    // dropped socket. Slow on purpose — a chat that lags 20s on a dead socket
    // is fine, one that polls every 2s from every open tab is not.
    refetchInterval: 20_000,
  });

  const messages = useMemo(() => data?.messages ?? [], [data]);

  // Mark read whenever the visible thread has unread admin messages. Runs on
  // mount AND on every arriving message, so a reply landing while the page is
  // already open still clears the badge and blue-ticks the admin's side.
  const unread = data?.thread?.unread_for_user ?? 0;
  useEffect(() => {
    if (unread <= 0) return;
    SupportChatAPI.markRead()
      .then(() => {
        qc.invalidateQueries({ queryKey: ["support", "chat"] });
        qc.invalidateQueries({ queryKey: ["support", "chat", "unread"] });
      })
      .catch(() => {
        /* badge stays; next open retries */
      });
  }, [unread, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMut = useMutation({
    mutationFn: (vars: {
      body: string;
      attachment: { url: string; name: string } | null;
      tempId?: string;
    }) => SupportChatAPI.send(vars.body, vars.attachment),
    onSuccess: (msg, vars) => {
      // Swap the optimistic bubble for the server's authoritative row (or just
      // append if there was none, e.g. a voice note sent without a temp).
      qc.setQueryData(["support", "chat"], (old: any) => {
        if (!old) return old;
        const has = vars.tempId && old.messages.some((m: any) => m.id === vars.tempId);
        return {
          ...old,
          messages: has
            ? old.messages.map((m: any) => (m.id === vars.tempId ? msg : m))
            : [...old.messages, msg],
        };
      });
    },
    // Roll back the optimistic bubble and restore the draft so nothing is lost.
    onError: (e: any, vars) => {
      if (vars.tempId) {
        qc.setQueryData(["support", "chat"], (old: any) =>
          old ? { ...old, messages: old.messages.filter((m: any) => m.id !== vars.tempId) } : old,
        );
      }
      setDraft((d) => d || vars.body);
      if (vars.attachment) setPending((p) => p || vars.attachment);
      toast.error(e?.message || "Could not send");
    },
  });

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try {
      const res = await SupportChatAPI.upload(f);
      setPending({ url: res.url, name: res.name });
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Voice note — upload the recording then send it as an audio attachment
  // (empty body). Reuses the same upload + send path as file attachments.
  async function sendVoice(file: File) {
    if (sendMut.isPending || uploading) return;
    setUploading(true);
    try {
      const res = await SupportChatAPI.upload(file);
      sendMut.mutate({ body: "", attachment: { url: res.url, name: res.name } });
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send voice message");
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (sendMut.isPending) return; // guard against a fast double Enter/tap
    const body = draft.trim();
    if (!body && !pending) return;
    const attachment = pending;
    // Clear the input SYNCHRONOUSLY so a second Enter fired in the same frame
    // sees an empty draft and bails — this is what stopped the duplicate send
    // + the text lingering after send.
    setDraft("");
    setPending(null);
    // Optimistic bubble — show the message INSTANTLY, reconcile on success.
    // Without this the bubble only appeared after the server round-trip, which
    // read as a 2-3 s lag on a slow link.
    const tempId = `temp-${Date.now()}`;
    qc.setQueryData(["support", "chat"], (old: any) =>
      old
        ? {
            ...old,
            messages: [
              ...old.messages,
              {
                id: tempId,
                sender: "USER",
                sender_id: null,
                sender_name: "",
                body,
                attachment_url: attachment?.url ?? null,
                attachment_name: attachment?.name ?? null,
                read_at: null,
                created_at: new Date().toISOString(),
              },
            ],
          }
        : old,
    );
    sendMut.mutate({ body, attachment, tempId });
  }

  return (
    // Breaks out of the dashboard shell's padding so the messenger is
    // edge-to-edge. dvh keeps the composer above mobile browser chrome; the
    // subtractions are the 56px top bar, the 56px bottom nav and the iOS home
    // indicator. Per-side margin classes, not `-m-*`: a `md:-m-6` shorthand
    // would silently reset the base `-mb-24` at that breakpoint.
    <div className="-mx-4 -mb-24 -mt-4 h-[calc(100dvh-3.5rem-3.5rem-env(safe-area-inset-bottom))] md:-mx-6 md:-mb-6 md:-mt-6 md:h-[calc(100dvh-3.5rem)]">
      <WaWallpaperStyles />
      <div className={cn("flex h-full flex-col overflow-hidden", WA.panel)}>
        {/* ── Header ── conversation header, WhatsApp layout: back arrow on
            phones, round avatar, name, presence line. The avatar carries the
            broker's own logo when they've uploaded one, so a white-labelled
            tenant sees their brand answering, not ours. */}
        <header
          className={cn(
            "flex h-[60px] shrink-0 items-center gap-3 px-2 sm:px-4",
            WA.header,
          )}
        >
          <button
            type="button"
            onClick={() => router.back()}
            className="p-1 text-[#54656f] dark:text-[#aebac1] md:hidden"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full",
              // A logo sits on white so uploads with a transparent or light
              // background stay legible; the glyph fallback keeps the
              // messenger green. object-CONTAIN, not cover: a wordmark logo
              // is usually wide and cover would crop it to its middle.
              logoUrl ? "bg-white" : "bg-[#00a884] text-white",
            )}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={supportName}
                className="h-full w-full object-contain p-[3px]"
              />
            ) : (
              // Same mark BrandLogo falls back to, so an unbranded tenant
              // gets one consistent glyph across the header and the chat
              // rather than a sprout in one place and a headset in the other.
              <Sprout className="h-5 w-5" strokeWidth={2.5} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[16px] leading-[22px]", WA.text)}>
              {supportName}
            </p>
            <p className="truncate text-[12.5px] leading-[16px] text-[#667781] dark:text-[#8696a0]">
              {/* Honest presence line: we don't track operator sessions, so
                  this states the response expectation rather than faking an
                  "online" dot the backend can't back up. */}
              Typically replies within a few minutes
            </p>
          </div>
        </header>

        {/* ── Messages ── */}
        <div className="wa-paper wa-scroll min-h-0 flex-1 overflow-y-auto py-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-[#8696a0]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-8">
              <p className="max-w-sm rounded-lg bg-[#ffeecd] px-4 py-2.5 text-center text-[13px] leading-[19px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
                Send us a message and our team will reply right here. You can
                attach a screenshot too.
              </p>
            </div>
          ) : (
            messages.map((m: SupportChatMessage, i: number) => {
              const mine = m.sender === "USER";
              const prev = messages[i - 1];
              const showDay =
                !prev || waDayLabel(prev.created_at) !== waDayLabel(m.created_at);
              // Tail only on the first bubble of a consecutive run.
              const tail = showDay || !prev || prev.sender !== m.sender;
              return (
                <div key={m.id}>
                  {showDay && <WaDayChip label={waDayLabel(m.created_at)} />}
                  <WaBubble
                    m={m}
                    mine={mine}
                    tail={tail}
                    // Show the POOL BRAND on the first bubble of an admin run —
                    // never the operator's personal name / role ("Super Admin",
                    // "Broker"). The user should only ever see the brand answering.
                    senderLabel={!mine && tail ? supportName : null}
                  />
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Composer ── */}
        <div className={cn("shrink-0 px-3 py-[10px]", WA.header)}>
          {pending && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[13px] text-[#111b21] dark:bg-[#2a3942] dark:text-[#e9edef]">
              <Paperclip className="h-4 w-4 shrink-0" />
              <span className="truncate">{pending.name}</span>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="ml-auto text-[#667781] hover:text-[#111b21] dark:text-[#8696a0] dark:hover:text-[#e9edef]"
                aria-label="Remove attachment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="shrink-0 p-2 text-[#54656f] disabled:opacity-50 dark:text-[#8696a0]"
              aria-label="Attach a file"
            >
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Paperclip className="h-6 w-6 -rotate-45" />
              )}
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Type a message"
              className={cn(
                "max-h-[100px] min-h-[42px] flex-1 resize-none rounded-lg px-4 py-[11px] text-[15px] leading-[20px] outline-none",
                "bg-white text-[#111b21] placeholder:text-[#667781]",
                "dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]",
              )}
            />
            {draft.trim() || pending ? (
              <button
                type="button"
                onClick={submit}
                disabled={sendMut.isPending}
                className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[#00a884] text-white transition-opacity disabled:opacity-40"
                aria-label="Send message"
              >
                {sendMut.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <SendHorizonal className="h-5 w-5" />
                )}
              </button>
            ) : (
              // Empty box → mic (WhatsApp behaviour). Record → auto-send.
              <VoiceRecorder onRecorded={sendVoice} disabled={sendMut.isPending || uploading} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
