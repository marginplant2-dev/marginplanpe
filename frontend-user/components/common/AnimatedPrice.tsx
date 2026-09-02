"use client";

/**
 * AnimatedPrice — DISPLAY-ONLY smooth price cell.
 *
 * HARD RULE: this is purely visual. It NEVER writes back into any store or
 * state — it only paints an animated view of a real `value` prop. Every piece
 * of trading logic (order execution price, P&L, margin, SL/TP triggers) keeps
 * reading the REAL store/server value elsewhere; the number a user acts on is
 * always the real quote, never an animation frame.
 *
 * How it stays cheap even with dozens of instances on a weak phone:
 *   • The number is painted IMPERATIVELY via ref.textContent inside a
 *     requestAnimationFrame loop. The JSX <span> is childless +
 *     suppressHydrationWarning, so React NEVER re-renders per frame — no render
 *     storm regardless of feed rate.
 *   • GLIDE: the shown number rolls from its previous value to the new real
 *     value over ~150ms (easeOutCubic). A fresh tick mid-glide just re-targets,
 *     so a fast feed is chased smoothly instead of snapping.
 *   • FLASH: on change the TEXT briefly tints green/red then eases back to its
 *     own base colour via a `from`-only CSS keyframe (auto-returns, no bg box).
 */

import { useEffect, useRef } from "react";

interface Props {
  value: number | null | undefined;
  digits?: number;
  className?: string;
  /** Smoothly roll the shown number to the new value (default true). */
  glide?: boolean;
  /** Tint the text green/red on change (default true). Pass false on big
   *  coloured action buttons (Buy/Sell) where a colour flash would clash. */
  flash?: boolean;
  /** Optional prefix printed before the number, e.g. "₹ " or "$ ". */
  prefix?: string;
  /** Shown when value is null/NaN. */
  placeholder?: string;
  /** Custom formatter for the (possibly fractional, mid-glide) number. When
   *  given it fully controls the string — `digits`/`prefix` are ignored. Use to
   *  match an existing segment-aware formatter exactly. */
  format?: (n: number) => string;
}

const GLIDE_MS = 150;

export function AnimatedPrice({
  value,
  digits = 2,
  className,
  glide = true,
  flash = true,
  prefix = "",
  placeholder = "—",
  format,
}: Props) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef<number | null>(null); // the value currently painted
  const targetRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);
  const startAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const fmt = (n: number) =>
    format
      ? format(n)
      : prefix +
        n.toLocaleString("en-IN", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  useEffect(() => {
    const el = spanRef.current;
    if (el == null) return;

    const v =
      typeof value === "number" && Number.isFinite(value) ? value : null;

    if (v == null) {
      shownRef.current = null;
      targetRef.current = null;
      el.textContent = placeholder;
      return;
    }

    const prev = shownRef.current;

    // FLASH — restart the keyframe by removing + reflow + re-adding the class.
    if (flash && prev != null && v !== prev) {
      el.classList.remove("price-flash-up", "price-flash-down");
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add(v > prev ? "price-flash-up" : "price-flash-down");
    }

    // No glide, or first paint → snap.
    if (!glide || prev == null) {
      shownRef.current = v;
      targetRef.current = v;
      el.textContent = fmt(v);
      return;
    }

    // GLIDE — (re)target from whatever is on screen right now to v over 150ms.
    targetRef.current = v;
    fromRef.current = shownRef.current ?? v;
    startAtRef.current = performance.now();

    if (rafRef.current == null) {
      const step = (now: number) => {
        const target = targetRef.current;
        if (target == null || spanRef.current == null) {
          rafRef.current = null;
          return;
        }
        const t = Math.min(1, (now - startAtRef.current) / GLIDE_MS);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const cur = fromRef.current + (target - fromRef.current) * eased;
        shownRef.current = cur;
        spanRef.current.textContent = fmt(cur);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          shownRef.current = target;
          spanRef.current.textContent = fmt(target);
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(step);
    }
    // If a raf is already running it reads the refs above → chases the new
    // target smoothly (no snap, no second loop).
  }, [value, digits, glide, flash, prefix, placeholder]);

  // Cancel any in-flight frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return <span ref={spanRef} className={className} suppressHydrationWarning />;
}
