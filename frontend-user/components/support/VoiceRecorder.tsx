"use client";

import { useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

// Record a voice note via MediaRecorder and hand the finished File to the
// caller (which uploads + sends it as an audio attachment). Browser picks the
// container: Chrome/Firefox → webm, Safari/iOS → mp4(m4a).
function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const cands = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const c of cands) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);

  function cleanup() {
    (streamRef.current?.getTracks() || []).forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function start() {
    if (disabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice recording isn't supported on this device");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        cleanup();
        setRecording(false);
        const dur = secs;
        setSecs(0);
        if (cancelRef.current) return;
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 512) return; // accidental tap — nothing worth sending
        const file = new File([blob], `voice-${Date.now()}.${extFor(type)}`, { type });
        onRecorded(file);
        void dur;
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setSecs(0);
      timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch (e: unknown) {
      cleanup();
      setRecording(false);
      const name = (e as { name?: string })?.name;
      toast.error(
        name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Could not start recording",
      );
    }
  }

  function stop(cancel: boolean) {
    cancelRef.current = cancel;
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setRecording(false);
      setSecs(0);
    }
  }

  if (recording) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => stop(true)}
          aria-label="Cancel recording"
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-500/10"
        >
          <Trash2 className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-red-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => stop(false)}
          aria-label="Send voice message"
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[#00a884] text-white"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      aria-label="Record voice message"
      className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 disabled:opacity-40 dark:text-[#8696a0] dark:hover:bg-white/5"
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}
