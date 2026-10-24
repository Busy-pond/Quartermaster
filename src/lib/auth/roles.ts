/**
 * Who may do what (Day 20 hardening), the pure part. Signed in = a member of the demo org;
 * treasurer-only = role "treasurer"; money on a budget = one of that mandate's approvers.
 * A refusal is a Forbidden error, which `handle()` turns into a 403.
 */

export class Forbidden extends Error {
  readonly status = 403;
}

export interface Who {
  id: string;
  orgId: string;
  role: string;
}

/** Treasurer-only routes and pages. */
export function assertTreasurer(m: Who): void {
  if (m.role !== "treasurer") throw new Forbidden("Only the treasurer can do this");
}

/** Approving, paying, refunding or rejecting on a budget: only that mandate's approver, in the same org. */
export function assertApprover(mandate: { orgId: string; approverIds: string[] } | null | undefined, m: Pick<Who, "id" | "orgId">): void {
  if (!mandate || mandate.orgId !== m.orgId || !mandate.approverIds.includes(m.id)) throw new Forbidden("Only the treasurer (the budget's approver) can do this");
}

/** What /treasurer shows: the dashboard, a sign-in prompt, or a refusal for volunteers. */
export function treasurerGate(m: Pick<Who, "role"> | null): "ok" | "signed-out" | "not-treasurer" {
  if (!m) return "signed-out";
  return m.role === "treasurer" ? "ok" : "not-treasurer";
}
