import type { ReimbursementStatus } from "@/lib/db/schema";
import type { StampKind } from "@/components/stamp";

export const REIMBURSEMENT_STATUS: Record<ReimbursementStatus, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "bg-paper text-muted" },
  needs_approval: { label: "Waiting for the treasurer", cls: "bg-warn-soft text-warn" },
  approved: { label: "Payout sent", cls: "bg-brand-soft text-brand" },
  paid: { label: "Paid", cls: "bg-ok-soft text-ok" },
  rejected: { label: "Rejected", cls: "bg-bad-soft text-bad" },
  failed: { label: "Payout failed", cls: "bg-bad-soft text-bad" },
};

export function reimbursementStamp(status: ReimbursementStatus): StampKind | null {
  if (status === "paid") return "paid";
  if (status === "needs_approval") return "needs_approval";
  if (status === "rejected" || status === "failed") return "deny";
  return null;
}
