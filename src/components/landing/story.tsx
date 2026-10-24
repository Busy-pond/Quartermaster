"use client";

/**
 * The landing page's six-step story. Each step lights up once it scrolls into
 * view and stays lit, so the rail reads like a ledger filling in. Under reduced
 * motion (or without IntersectionObserver) every step is lit from the start.
 */
import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    title: "Ask",
    body: "A volunteer says what the event needs, in plain words.",
    note: "“6 folding tables for Saturday’s beach cleanup.”",
  },
  {
    title: "Dry run",
    body: "The agent compares retailers on price per unit and dry-runs the order against the mandate before proposing anything.",
    note: "dry run · 6 × $44.97 = $269.82 · walmart.com",
  },
  {
    title: "Engine decides",
    body: "Eleven fixed rules, M0 to M10, run in code on whole cents. The AI can’t change the answer.",
    note: "M9 · $269.82 is over the $250.00 auto-approve limit → needs the treasurer",
  },
  {
    title: "Treasurer signs",
    body: "Inside the limits it’s pre-approved. Above them, only the mandate’s approver can sign, and the rules run again first.",
    note: "approved by the treasurer · rules re-checked",
  },
  {
    title: "PayPal pays",
    body: "The order is captured in the PayPal sandbox with an idempotency key, and a verified webhook confirms it.",
    note: "PayPal-Request-Id set · webhook signature verified",
  },
  {
    title: "Receipt filed",
    body: "A trust receipt records who asked, what was compared, which rules passed and the PayPal IDs.",
    note: "budget updated · receipt on file",
  },
];

export function Story() {
  const listRef = useRef<HTMLOListElement>(null);
  const [lit, setLit] = useState<boolean[]>(() => STEPS.map(() => false));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      setLit(STEPS.map(() => true));
      return;
    }
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-step]") ?? []);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.step);
          setLit((prev) => (prev[i] ? prev : prev.map((v, j) => v || j === i)));
          io.unobserve(e.target);
        }
      },
      // A step counts once its top passes 60% of the way down the screen.
      { rootMargin: "0px 0px -40% 0px" },
    );
    items.forEach((el) => io.observe(el));
    setReady(true);
    return () => io.disconnect();
  }, []);

  const count = lit.filter(Boolean).length;

  return (
    <ol ref={listRef} className="story relative mt-10" data-ready={ready || undefined}>
      <span aria-hidden className="story-rail" style={{ "--fill": count / STEPS.length } as React.CSSProperties} />
      {STEPS.map((s, i) => (
        <li key={s.title} data-step={i} data-lit={lit[i] || undefined} className="story-step relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 pb-10 last:pb-0 sm:gap-x-6">
          <span className="story-dot grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-card font-display font-bold">{i + 1}</span>
          <div className="min-w-0 pt-1">
            <h3 className="text-xl font-bold">{s.title}</h3>
            <p className="mt-1 max-w-[38rem] leading-relaxed text-muted">{s.body}</p>
            <p className="story-note mt-3 inline-block max-w-full rounded-md border border-dashed border-line bg-card px-3 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">{s.note}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
