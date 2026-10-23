"use client";

import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Markdown } from "@/components/markdown";
import { DecisionPanel } from "@/components/decision";
import { BudgetBar } from "@/components/budget-bar";
import { Stamp } from "@/components/stamp";
import type { Decision, Reason } from "@/lib/mandates/engine";

const SUGGESTIONS = [
  { text: "We need 200 reusable water bottles and 20 pairs of gloves for the Dec 12 beach cleanup, under $300.", hint: "Over budget on purpose: watch it find what fits" },
  { text: "Get 10 folding tables for the beach cleanup.", hint: "Goes to the treasurer for approval" },
  { text: "Order 40 litter pickers for the cleanup drive.", hint: "A straightforward order" },
];

type Option = {
  optionId: string;
  title: string;
  vendor: string;
  priceDollars: number;
  unitsPerListing: number;
  pricePerUnitDollars: number;
  availability: string | null;
  imageUrl: string | null;
  url: string | null;
};
type SearchResult = { source: "channel3" | "fixture"; note?: string; options: Option[] };
type ProposalResult = {
  error?: string;
  paymentId: string;
  outcome: Decision["outcome"];
  clause: string;
  clauseName: string;
  message: string;
  reasons: Reason[];
  totalDollars: number;
  remainingAfterDollars: number;
  remainingBeforeDollars: number;
  capDollars: number;
  vendor: string;
  lines?: { description: string; quantity: number; unitPriceDollars: number }[];
  approvalUrl: string | null;
};
type CheckResult = { totalDollars?: number; outcome?: string; withinRequesterBudget?: boolean | null; error?: string; vendor?: string };
/** AI SDK v6 tool parts are typed "tool-<name>"; this reads them without depending on generated types. */
type ToolPart = { type: string; state: string; output?: unknown; errorText?: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const cents = (n: number) => Math.round(n * 100);

const TOOL_LABEL: Record<string, string> = {
  listMandates: "Reading spending mandates",
  readPolicy: "Reading the spending policy",
  searchPolicy: "Searching the spending policy",
  purchaseHistory: "Checking past purchases",
  verifyProducts: "Checking live prices with KERNEL",
  searchProducts: "Searching retailers",
  checkPurchase: "Checking the budget and mandate",
  proposePurchase: "Proposing the order",
};

function Products({ r }: { r: SearchResult }) {
  return (
    <div className="mt-2">
      {r.source === "fixture" && <p className="mb-2 text-xs text-warn">{r.note ?? "Sample products (offline)"}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {r.options.map((o, i) => (
          <div key={o.optionId} className="card enter-up flex gap-3 p-3" style={{ "--i": i } as CSSProperties}>
            {o.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.imageUrl} alt="" className="h-14 w-14 rounded-md object-contain" />
            ) : (
              <div aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-paper font-display text-lg font-bold text-muted">
                {o.vendor.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 text-sm">
              <p className="line-clamp-2 font-medium">{o.title}</p>
              <p className="mt-0.5 text-muted">
                <span className="amount font-medium text-ink">{usd(o.priceDollars)}</span>
                {o.unitsPerListing > 1 && <span className="amount"> ({usd(o.pricePerUnitDollars)} each)</span>} from {o.vendor}
                {o.availability === "OutOfStock" && <span className="text-bad">, out of stock</span>}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Proposal({ r }: { r: ProposalResult }) {
  const [showRules, setShowRules] = useState(r.outcome !== "allow");
  if (r.error) return <p className="mt-2 text-sm text-bad">{r.error}</p>;
  const decision: Decision = { outcome: r.outcome, clause: r.clause, message: r.message, reasons: r.reasons ?? [], remainingAfterCents: cents(r.remainingAfterDollars) };
  return (
    <div className="slip enter-up mt-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Order from {r.vendor}</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{usd(r.totalDollars)}</p>
          {r.lines && (
            <ul className="mt-2 space-y-0.5 text-sm text-muted">
              {r.lines.map((l, i) => (
                <li key={i}>
                  {l.quantity} × {l.description} at {usd(l.unitPriceDollars)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Stamp kind={r.outcome} size="md" className="mt-1 shrink-0" />
      </div>

      {r.capDollars > 0 && (
        <div className="mt-4">
          <BudgetBar capCents={cents(r.capDollars)} spentCents={cents(r.capDollars - r.remainingBeforeDollars)} orderCents={cents(r.totalDollars)} />
        </div>
      )}

      <div className="mt-4 border-t border-dashed border-line pt-3">
        <button
          className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
          onClick={() => setShowRules((v) => !v)}
          aria-expanded={showRules}
        >
          {showRules ? "Hide the mandate check" : "Show the mandate check"}
        </button>
        {showRules && (
          <div className="mt-3">
            <DecisionPanel decision={decision} compact />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {r.approvalUrl && (
          <Link href={`/approve/${r.paymentId}`} className="btn-primary">
            {r.outcome === "allow" ? "Complete payment" : "Send to the treasurer"}
          </Link>
        )}
        <Link href={`/receipts/${r.paymentId}`} className="btn-ghost">
          Open trust receipt
        </Link>
      </div>
    </div>
  );
}

/** One step in the agent's trail: a pulsing dot while running, a tick when done. */
function TrailStep({ label, state, note, tone = "muted" }: { label: string; state: "running" | "done" | "error"; note?: string; tone?: "muted" | "warn" | "bad" }) {
  return (
    <div className="enter-up flex items-center gap-3 py-1 pl-1 text-sm">
      <span
        aria-hidden
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${
          state === "running" ? "trail-dot-live border-brand bg-white" : state === "error" ? "border-bad bg-bad" : "border-brand bg-brand"
        }`}
      >
        {state === "done" && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
            <path d="M2.5 6.2l2.2 2.1L9.5 3.7" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : state === "running" ? "text-ink" : "text-muted"}>
        {label}
        {state === "running" && "…"}
        {note && <span className="text-muted"> {note}</span>}
      </span>
    </div>
  );
}

export default function ChatPage() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  // Posts { id, messages } to /api/chat by default.
  const { messages, sendMessage, status, error, regenerate } = useChat({ id: chatId });
  const busy = status === "submitted" || status === "streaming";
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest output in view while the agent works.
  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  }

  const lastId = messages.at(-1)?.id;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Request supplies</h1>
          <p className="mt-1 text-muted">Say what the event needs. The agent finds it, checks the budget, and drafts the order.</p>
        </div>
        {messages.length > 0 && (
          <button className="btn-ghost shrink-0" onClick={() => setChatId(crypto.randomUUID())}>
            New request
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="mt-8 grid gap-3">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={s.text}
              className="card enter-up group block w-full p-4 text-left transition-[border-color,translate] duration-200 hover:-translate-y-0.5 hover:border-ink/40"
              style={{ "--i": i } as CSSProperties}
              onClick={() => send(s.text)}
            >
              <span className="block">{s.text}</span>
              <span className="mt-1 block text-sm text-muted group-hover:text-brand">{s.hint}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={m.role === "user" ? "enter-up max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-white" : "w-full"}>
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  if (m.role === "user")
                    return (
                      <p key={i} className="whitespace-pre-wrap leading-relaxed">
                        {part.text}
                      </p>
                    );
                  const streaming = status === "streaming" && m.id === lastId && i === m.parts.length - 1;
                  return (
                    <div key={i} className={`my-3 ${streaming ? "caret" : ""}`}>
                      <Markdown text={part.text} />
                    </div>
                  );
                }
                if (!part.type.startsWith("tool-")) return null; // step markers, reasoning
                const t = part as unknown as ToolPart;
                const name = t.type.slice("tool-".length);
                const label = TOOL_LABEL[name] ?? name;
                if (t.state === "output-error") return <TrailStep key={i} label={`${label} failed`} note={t.errorText} state="error" tone="bad" />;
                if (t.state !== "output-available") return <TrailStep key={i} label={label} state="running" />;
                if (name === "searchProducts") {
                  const r = t.output as SearchResult;
                  return (
                    <div key={i}>
                      <TrailStep label={`Found ${r.options.length} options`} state="done" />
                      <Products r={r} />
                    </div>
                  );
                }
                if (name === "proposePurchase") return <Proposal key={i} r={t.output as ProposalResult} />;
                if (name === "checkPurchase") {
                  const c = t.output as CheckResult;
                  const ok = c.outcome !== "deny" && c.withinRequesterBudget !== false && !c.error;
                  const note = c.error ?? (ok ? "fits" : c.outcome === "deny" ? "blocked by the mandate, adjusting" : "over the requested budget, adjusting");
                  return (
                    <TrailStep
                      key={i}
                      label={`Dry run${c.totalDollars != null ? ` ${usd(c.totalDollars)}` : ""}${c.vendor ? ` at ${c.vendor}` : ""}:`}
                      note={note}
                      state="done"
                      tone={ok ? "muted" : "warn"}
                    />
                  );
                }
                return <TrailStep key={i} label={label} state="done" />;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && <TrailStep label="Thinking" state="running" />}
        {error && (
          <div className="card enter-up border-bad/30 bg-bad-soft p-3 text-sm text-bad">
            {error.message || "Something went wrong."}{" "}
            <button className="font-medium underline" onClick={() => regenerate()}>
              Retry
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Solid background so cards scrolling underneath don't show through the input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 mt-8 flex gap-2 border-t border-line bg-paper pt-3 pb-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "Quartermaster is working…" : "What does your event need?"}
          aria-label="Your request"
          className="card flex-1 px-4 py-3 outline-none transition-colors focus:border-ink"
          disabled={busy}
        />
        <button type="submit" className="btn-primary px-5!" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
