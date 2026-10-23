export type StampKind = "allow" | "needs_approval" | "deny" | "paid" | "refunded";

const WORDS: Record<StampKind, string> = {
  allow: "Pre-approved",
  needs_approval: "Needs treasurer",
  deny: "Blocked",
  paid: "Paid",
  refunded: "Refunded",
};

/**
 * A rubber stamp. Give it a changing `animateKey` (e.g. the outcome) to make it
 * slam down again when the result changes.
 */
export function Stamp({ kind, size = "md", animate = true, animateKey, className = "" }: { kind: StampKind; size?: "sm" | "md" | "lg"; animate?: boolean; animateKey?: string; className?: string }) {
  const sizes = { sm: "text-xs", md: "text-base", lg: "text-2xl" };
  return (
    <span key={animateKey ?? kind} data-kind={kind} role="status" aria-label={WORDS[kind]} className={`stamp ${sizes[size]} ${animate ? "stamp-slam" : ""} ${className}`}>
      {WORDS[kind]}
    </span>
  );
}

export function stampFor(status: string): StampKind | null {
  if (status === "captured") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "denied" || status === "failed") return "deny";
  if (status === "needs_approval") return "needs_approval";
  if (status === "approved") return "allow";
  return null;
}
