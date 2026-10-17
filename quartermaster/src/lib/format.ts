export function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function shortDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(d: Date | string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const OUTCOME_STYLE = {
  allow: { label: "Pre-approved by mandate", cls: "bg-ok-soft text-ok" },
  needs_approval: { label: "Needs treasurer approval", cls: "bg-warn-soft text-warn" },
  deny: { label: "Blocked by mandate", cls: "bg-bad-soft text-bad" },
} as const;

export const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  denied: { label: "Blocked", cls: "bg-bad-soft text-bad" },
  needs_approval: { label: "Awaiting approval", cls: "bg-warn-soft text-warn" },
  approved: { label: "Ready to pay", cls: "bg-brand-soft text-brand" },
  captured: { label: "Paid", cls: "bg-ok-soft text-ok" },
  failed: { label: "Payment failed", cls: "bg-bad-soft text-bad" },
  refunded: { label: "Refunded", cls: "bg-paper text-muted" },
};
