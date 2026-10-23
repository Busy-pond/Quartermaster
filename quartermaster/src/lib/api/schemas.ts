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

export const KeyBody = z.object({ name: z.string().max(60).default("").describe("who will use the key, e.g. 'Claude Desktop'") });
