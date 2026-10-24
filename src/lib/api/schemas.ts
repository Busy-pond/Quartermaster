/**
 * Request bodies of the public API routes. The routes validate with these, and
 * the OpenAPI document (/api/openapi.json) is generated from the same objects,
 * so the spec can't drift from what the server accepts.
 */
import { z } from "zod";

export const SessionBody = z.object({ role: z.enum(["member", "treasurer"]).describe("demo sign-in: volunteer or treasurer") });

export const CaptureBody = z.object({ orderId: z.string().min(1).describe("the PayPal order id returned by the order route and approved in the PayPal popup") });

export const RefundBody = z.object({ reason: z.string().max(200).default("").describe("shown on the trust receipt and sent to the payer") });

export const ReimbursementBody = z.object({
  mandateId: z.string().min(1).describe("the budget the receipt is charged to"),
  imageDataUrl: z.string().startsWith("data:image/").describe("the receipt photo as a data URL (JPEG, PNG or WebP, max 4 MB)"),
  note: z.string().max(500).nullish(),
  manual: z
    .object({
      merchant: z.string().trim().min(1, "Enter the store name").max(120),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      totalDollars: z.number().positive("Enter the total paid").max(10_000),
      category: z.string().min(1),
    })
    .nullish()
    .describe("details typed in by hand when the photo can't be read; flagged for the treasurer"),
});

export const RejectBody = z.object({ reason: z.string().max(300).default("") });

export const SubscriptionBody = z.object({ subscriptionId: z.string().regex(/^I-[A-Z0-9]+$/, "Not a PayPal subscription id").describe("the id PayPal returns after the member approves") });

/** One AG Studio agent turn (AgLlmRequest), sent by the browser adapter in src/components/studio/gemini-adapter.ts. */
export const StudioTurnBody = z.object({
  input: z.array(z.object({ type: z.string() }).passthrough()).max(400).describe("the conversation so far, as AG Studio conversation items"),
  instructions: z.string().max(60_000).optional(),
  tools: z
    .array(z.object({ name: z.string().min(1), description: z.string(), parameters: z.record(z.unknown()) }).passthrough())
    .max(80)
    .optional()
    .describe("tool schemas the agent may call; the browser runs them, never the server"),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.object({ type: z.enum(["text", "json"]), name: z.string().optional(), schema: z.record(z.unknown()).optional() }).passthrough(),
});

export const InsightsQuery = z.object({
  view: z.enum(["spend_by_event", "over_budget_share", "pending_reimbursements", "blocked_attempts", "mandate_health"]),
  threshold: z.coerce.number().min(0).max(1000).default(80).describe("over_budget_share only: percent of the cap used (spent + approved, not yet paid)"),
  days: z.coerce.number().int().min(1).max(365).default(30).describe("blocked_attempts only: how far back"),
});

export const KeyBody =z.object({ name: z.string().max(60).default("").describe("who will use the key, e.g. 'Claude Desktop'") });
