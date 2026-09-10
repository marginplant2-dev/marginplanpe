"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Search,
  SendHorizonal,
  X,
} from "lucide-react";
import {
  SupportChatAPI,
  type SupportChatMessage,
  type SupportChatThread,
} from "@/lib/api";
import {
  WA,
  WaAvatar,
  WaBubble,
  WaDayChip,
  WaTicks,
  WaWallpaperStyles,
  waDayLabel,
  waListTime,
} from "@/components/support/wa";
import { cn } from "@/lib/utils";

export default function AdminSupportChatPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Conversation list ──
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ["support-chat", "threads", search, unreadOnly],
    queryFn: () =>
      SupportChatAPI.threads({ q: search || undefined, unread_only: unreadOnly }),
    refetchInterval: 20_000,
  });
  const threads = threadsData?.items ?? [];

  // ── Users with no thread yet, so the admin can send first ──
  const { data: candidates } = useQuery({
    queryKey: ["support-chat", "search-users", search],
    queryFn: () => SupportChatAPI.searchUsers(search),
    enabled: search.trim().length >= 2,
  });
  const newContacts = useMemo(
    () => (candidates?.items ?? []).filter((c) => !c.has_thread),
    [candidates],
  );

  // ── Open conversation ──
  const { data: chat, isLoading: chatLoading } = useQuery({
    queryKey: ["support-chat", "messages", activeUserId],
    queryFn: () => SupportChatAPI.messages(activeUserId as string),
    enabled: !!activeUserId,
    refetchInterval: 15_000,
  });
  const messages = useMemo(() => chat?.messages ?? [], [chat]);

  const activeUnread = chat?.thread?.unread_for_admin ?? 0;
  useEffect(() => {
    if (!activeUserId || activeUnread <= 0) return;
    SupportChatAPI.markRead(activeUserId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["support-chat", "threads"] });
        qc.invalidateQueries({ queryKey: ["support-chat", "messages", activeUserId] });
        qc.invalidateQueries({ queryKey: ["support-chat", "unread-total"] });
      })
      .catch(() => {
        /* badge stays; reopening retries */
      });
  }, [activeUserId, activeUnread, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeUserId]);

  const sendMut = useMutation({
    mutationFn: (vars: {
      userId: string;
      body: string;
      attachment: { url: string; name: string } | null;
    }) => SupportChatAPI.send(vars.userId, vars.body, vars.attachment),
    onSuccess: (msg, vars) => {
      qc.setQueryData(["support-chat", "messages", vars.userId], (old: any) =>
        old ? { ...old, messages: [...old.messages, msg] } : old,
      );
      // The thread may not have existed a second ago (first message sent from
      // search) — refresh the list so it appears at the top.
      qc.invalidateQueries({ queryKey: ["support-chat", "threads"] });
    },
    // Draft cleared synchronously in submit(); restore it if the send failed.
    onError: (e: any, vars) => {
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

  function submit() {
    if (!activeUserId || sendMut.isPending) return; // guard fast double send
    const body = draft.trim();
    if (!body && !pending) return;
    const attachment = pending;
    // Clear synchronously so a 2nd Enter in the same frame sees an empty draft
    // and bails — fixes the duplicate send + text lingering after send.
    setDraft("");
    setPending(null);
    sendMut.mutate({ userId: activeUserId, body, attachment });
  }

  // A broker granted `support` at VIEW reads their pool's chats but cannot
  // answer. Fall back to the list response (it carries the same flag) so the
  // composer is already correct on the first paint, and default to true only
  // while nothing has loaded — the send itself is still gated server-side.
  const canReply = chat?.can_reply ?? threadsData?.can_reply ?? true;

  const activeThread: SupportChatThread | undefined =
    chat?.thread ?? threads.find((t) => t.user_id === activeUserId);
  const activeName = activeThread?.user_name || activeThread?.user_code || "User";

  return (
    // Breaks out of the admin shell's page padding so the messenger is
    // edge-to-edge like a real chat client. Height subtracts the 56px top bar
    // (and, on phones, the 56px bottom nav + home indicator) using dvh so
    // mobile browser chrome doesn't clip the composer. Per-side margin classes,
    // not `-m-*`: a `sm:-m-4` shorthand would silently reset the base `-mb-20`
    // from 640px up, exactly where the bottom nav is still on screen.
    <div className="-mx-3 -mb-20 -mt-3 h-[calc(100dvh-3.5rem-3.5rem-env(safe-area-inset-bottom))] sm:-mx-4 sm:-mt-4 md:-mx-6 md:-mb-6 md:-mt-6 md:h-[calc(100dvh-3.5rem)]">
      <WaWallpaperStyles />
      <div
        className={cn(
          "grid h-full grid-cols-1 overflow-hidden md:grid-cols-[minmax(300px,32%)_1fr]",
          WA.panel,
        )}
      >
        {/* ══════════ Left: conversation list ══════════ */}
        <aside
          className={cn(
            "flex min-h-0 flex-col border-r",
            WA.border,
            WA.panel,
            // Phone: one pane at a time — the list hides when a chat is open.
            activeUserId ? "hidden md:flex" : "flex",
          )}
        >
          <header
            className={cn(
              "flex h-[60px] shrink-0 items-center gap-3 px-4",
              WA.header,
              WA.text,
            )}
          >
            <MessagesSquare className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
            <span className="text-[17px] font-medium">Support Chat</span>
            {threadsData?.total ? (
              <span className={cn("ml-auto text-[12px]", WA.sub)}>
                {threadsData.total}
              </span>
            ) : null}
          </header>

          <div className={cn("shrink-0 space-y-2 px-3 py-2", WA.panel)}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#54656f] dark:text-[#8696a0]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code or email"
                className={cn(
                  "h-[35px] w-full rounded-lg pl-11 pr-3 text-[14px] outline-none",
                  "bg-[#f0f2f5] text-[#111b21] placeholder:text-[#667781]",
                  "dark:bg-[#202c33] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]",
                )}
              />
            </div>
            <label
              className={cn(
                "flex w-fit cursor-pointer items-center gap-1.5 text-[12.5px]",
                WA.sub,
              )}
            >
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="accent-[#00a884]"
              />
              Unread only
            </label>
          </div>

          <div className={cn("wa-scroll min-h-0 flex-1 overflow-y-auto", WA.panel)}>
            {threadsLoading ? (
              <div className="flex justify-center p-8 text-[#8696a0]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : threads.length === 0 && newContacts.length === 0 ? (
              <p className={cn("p-8 text-center text-[14px]", WA.sub)}>
                {search ? "No matches in your pool." : "No conversations yet."}
              </p>
            ) : null}

            {threads.map((t) => {
              const active = activeUserId === t.user_id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveUserId(t.user_id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 text-left transition-colors",
                    active ? WA.active : WA.hover,
                  )}
                >
                  <WaAvatar name={t.user_name} code={t.user_code} id={t.user_id} />
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 flex-col justify-center gap-[2px] border-b py-[10px]",
                      WA.border,
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn("truncate text-[16px] leading-[21px]", WA.text)}
                      >
                        {t.user_name || t.user_code}
                      </span>
                      <span
                        className={cn(
                          "ml-auto shrink-0 text-[12px]",
                          t.unread_for_admin > 0 ? "text-[#00a884]" : WA.sub,
                        )}
                      >
                        {waListTime(t.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-1 truncate text-[13.5px] leading-[20px]",
                          WA.sub,
                        )}
                      >
                        {/* Our own last message carries its ticks in the list
                            row, same as WhatsApp. */}
                        {t.last_sender === "ADMIN" && (
                          <WaTicks read={t.unread_for_user === 0} />
                        )}
                        <span className="truncate">
                          {t.last_message_preview || "No messages yet"}
                        </span>
                      </span>
                      {t.unread_for_admin > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-[#00a884] px-[6px] py-[1px] text-[12px] font-medium leading-[18px] text-white">
                          {t.unread_for_admin}
                        </span>
                      )}
                    </div>
                    <span className={cn("truncate text-[11.5px]", WA.sub)}>
                      {t.user_code}
                    </span>
                  </div>
                </button>
              );
            })}

            {newContacts.length > 0 && (
              <>
                <p
                  className={cn(
                    "px-4 pb-1 pt-4 text-[14px] font-medium text-[#00a884]",
                  )}
                >
                  Start a new chat
                </p>
                {newContacts.map((c) => (
                  <button
                    key={c.user_id}
                    type="button"
                    onClick={() => setActiveUserId(c.user_id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 text-left transition-colors",
                      activeUserId === c.user_id ? WA.active : WA.hover,
                    )}
                  >
                    <WaAvatar name={c.user_name} code={c.user_code} id={c.user_id} />
                    <div
                      className={cn(
                        "flex min-w-0 flex-1 flex-col justify-center border-b py-[12px]",
                        WA.border,
                      )}
                    >
                      <span className={cn("truncate text-[16px]", WA.text)}>
                        {c.user_name || c.user_code}
                      </span>
                      <span className={cn("truncate text-[13px]", WA.sub)}>
                        {c.user_code}
                        {c.user_email ? ` · ${c.user_email}` : ""}
                      </span>
                    </div>
                    <MessageSquarePlus className="h-5 w-5 shrink-0 text-[#00a884]" />
                  </button>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* ══════════ Right: conversation ══════════ */}
        <section
          className={cn(
            "flex min-h-0 flex-col",
            activeUserId ? "flex" : "hidden md:flex",
          )}
        >
          {!activeUserId ? (
            // WhatsApp Web's empty state.
            <div className="wa-paper flex h-full flex-col items-center justify-center gap-3 border-b-[6px] border-b-[#25d366] px-8 text-center">
              <MessagesSquare className="h-16 w-16 text-[#54656f] opacity-40 dark:text-[#8696a0]" />
              <p className="text-[28px] font-light text-[#41525d] dark:text-[#e9edef]">
                Support Chat
              </p>
              <p className="max-w-md text-[14px] text-[#667781] dark:text-[#8696a0]">
                Pick a conversation on the left, or search a user to message them
                first. Replies reach them instantly in the app and as a push
                notification.
              </p>
            </div>
          ) : (
            <>
              <header
                className={cn(
                  "flex h-[60px] shrink-0 items-center gap-3 px-3 sm:px-4",
                  WA.header,
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveUserId(null)}
                  className="-ml-1 p-1 text-[#54656f] dark:text-[#aebac1] md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <WaAvatar
                  name={activeName}
                  code={activeThread?.user_code || ""}
                  id={activeUserId}
                  size={40}
                />
                <div className="min-w-0">
                  <p className={cn("truncate text-[16px] leading-[22px]", WA.text)}>
                    {activeName}
                  </p>
                  <p className={cn("truncate text-[12.5px] leading-[16px]", WA.sub)}>
                    {activeThread?.user_code}
                    {activeThread?.user_email ? ` · ${activeThread.user_email}` : ""}
                  </p>
                </div>
              </header>

              <div className="wa-paper wa-scroll min-h-0 flex-1 overflow-y-auto py-3">
                {chatLoading ? (
                  <div className="flex h-full items-center justify-center text-[#8696a0]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-8">
                    <p className="rounded-lg bg-[#ffeecd] px-4 py-2 text-center text-[13px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
                      No messages yet — send the first one.
                    </p>
                  </div>
                ) : (
                  messages.map((m: SupportChatMessage, i: number) => {
                    // "Mine" is the ADMIN side here — mirror of the user app.
                    const mine = m.sender === "ADMIN";
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
                          // Which operator replied — only worth showing on the
                          // first bubble of their run, and only on our side.
                          senderLabel={mine && tail ? m.sender_name || null : null}
                        />
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {!canReply ? (
                <div
                  className={cn(
                    "shrink-0 px-4 py-4 text-center text-[13px]",
                    WA.header,
                    WA.sub,
                  )}
                >
                  You have read-only access to support chats. Ask your admin for
                  Support at <span className="font-medium">EDIT</span> to reply.
                </div>
              ) : (
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
                      // Enter sends, Shift+Enter newlines — chat convention.
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
                  <button
                    type="button"
                    onClick={submit}
                    disabled={sendMut.isPending || (!draft.trim() && !pending)}
                    className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[#00a884] text-white transition-opacity disabled:opacity-40"
                    aria-label="Send message"
                  >
                    {sendMut.isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <SendHorizonal className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
