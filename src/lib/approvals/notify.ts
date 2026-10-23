/**
 * Tells the treasurer that something needs their approval (Day 11), outside the app.
 *
 * Channels, in order: Zapier MCP (Slack message + email through the user's own
 * Zapier MCP server) → Slack incoming webhook → Resend email. The in-app list
 * on /mandates always shows it too, so nothing is lost if every channel is off.
 * The message carries a signed, expiring link (APP_SECRET). The channels used
 * are written to the audit trail. Notification failures never block a proposal.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { flags } from "@/lib/flags";
import { money } from "@/lib/format";
import { audit } from "@/lib/purchases";
import { signApproval } from "./token";

export interface ApprovalNotice {
  kind: "payment" | "reimbursement";
  id: string;
  orgId: string;
  traceId: string;
  approverId: string;
  title: string; // "3× Folding table from homedepot.com"
  amountCents: number;
  currency: string;
  reason: string; // why it needs a person, e.g. "M9: order above the $250 auto-approve limit"
  requestedBy: string;
  appUrl: string;
}

export type Channel = "zapier" | "slack" | "email" | "in_app";

export function approvalLink(n: Pick<ApprovalNotice, "kind" | "id" | "approverId" | "appUrl">, now = new Date()): string {
  const page = n.kind === "payment" ? `/approve/${n.id}` : `/reimbursements/${n.id}`;
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) return `${n.appUrl}${page}`; // unsigned: the treasurer signs in as usual
  return `${n.appUrl}/a/${signApproval({ kind: n.kind, id: n.id, approverId: n.approverId }, secret, now)}`;
}

function messageText(n: ApprovalNotice, link: string) {
  const what = n.kind === "payment" ? "purchase" : "reimbursement";
  return {
    subject: `Approval needed: ${money(n.amountCents, n.currency)} ${what}`,
    text: `${n.requestedBy} needs your approval for a ${money(n.amountCents, n.currency)} ${what}: ${n.title}.\nWhy it needs you: ${n.reason}\nApprove or decline (link valid 72 h): ${link}`,
  };
}

async function viaZapier(n: ApprovalNotice, msg: { subject: string; text: string }, to: string | null): Promise<boolean> {
  const url = process.env.ZAPIER_MCP_URL!;
  const toolNames = (process.env.ZAPIER_MCP_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const headers: Record<string, string> = process.env.ZAPIER_MCP_TOKEN ? { Authorization: `Bearer ${process.env.ZAPIER_MCP_TOKEN}` } : {};
  const client = new Client({ name: "quartermaster", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  try {
    const available = (await client.listTools()).tools.map((t) => t.name);
    // Default: every Slack "send" and email "send" action the user enabled in their Zapier MCP server.
    const chosen = toolNames.length ? toolNames.filter((t) => available.includes(t)) : available.filter((t) => /slack.*(send|message)|(gmail|email|outlook).*send/i.test(t));
    if (chosen.length === 0) throw new Error(`No matching Zapier MCP tools (available: ${available.join(", ") || "none"})`);
    let sent = 0;
    for (const name of chosen) {
      const isEmail = /gmail|email|outlook/i.test(name);
      // Zapier MCP actions take plain-English "instructions" and fill the action's fields from them.
      const instructions = isEmail
        ? `Send an email to ${to ?? "the treasurer"} with subject "${msg.subject}" and this body:\n${msg.text}`
        : `Post this message to the treasurer approvals channel${process.env.ZAPIER_SLACK_CHANNEL ? ` #${process.env.ZAPIER_SLACK_CHANNEL}` : ""}:\n${msg.text}`;
      const r = await client.callTool({ name, arguments: { instructions } });
      if (!r.isError) sent++;
    }
    return sent > 0;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function viaSlack(msg: { subject: string; text: string }): Promise<boolean> {
  const res = await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `*${msg.subject}*\n${msg.text}` }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

async function viaResend(msg: { subject: string; text: string }, to: string, link: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Quartermaster <onboarding@resend.dev>",
      to: [to],
      subject: msg.subject,
      text: msg.text,
      html: `<p>${escapeHtml(msg.text.split("\n").slice(0, 2).join(" "))}</p><p><a href="${escapeHtml(link)}">Approve or decline</a> (link valid 72 hours)</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends the notice through the first channel that works, and records what happened. */
export async function notifyTreasurer(n: ApprovalNotice): Promise<Channel[]> {
  const approver = await db().query.members.findFirst({ where: eq(schema.members.id, n.approverId) });
  const to = process.env.TREASURER_EMAIL || approver?.email || null;
  const link = approvalLink(n);
  const msg = messageText(n, link);
  const used: Channel[] = [];
  const failures: string[] = [];

  const attempt = async (channel: Channel, enabled: boolean, send: () => Promise<boolean>) => {
    if (!enabled || used.length > 0) return;
    try {
      if (await send()) used.push(channel);
      else failures.push(`${channel}: not accepted`);
    } catch (e) {
      failures.push(`${channel}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  };
  await attempt("zapier", flags.zapier(), () => viaZapier(n, msg, to));
  await attempt("slack", flags.slack(), () => viaSlack(msg));
  await attempt("email", flags.resend() && !!to, () => viaResend(msg, to!, link));
  used.push("in_app"); // /mandates "Waiting for you" always lists it

  await audit({
    orgId: n.orgId,
    traceId: n.traceId,
    paymentId: n.id,
    actor: "system",
    type: "approval.notified",
    message:
      used.length > 1
        ? `Treasurer notified by ${used.filter((c) => c !== "in_app").map(label).join(" and ")} with a signed approval link`
        : `No outside channel configured${failures.length ? " or working" : ""}; the request waits on the treasurer's Mandates page`,
    payload: { channels: used, failures, signedLink: link.includes("/a/") },
  });
  return used;
}

const label = (c: Channel) => ({ zapier: "Zapier (Slack/email)", slack: "Slack", email: "email (Resend)", in_app: "the Mandates page" })[c];

/** Runs after the response when possible, so a slow channel never delays the chat. */
export async function notifyLater(n: ApprovalNotice) {
  const run = () => notifyTreasurer(n).catch((e) => console.error("Treasurer notification failed", e));
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    void run(); // outside a request (scripts, tests)
  }
}
