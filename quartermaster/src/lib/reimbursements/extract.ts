/**
 * Reads a receipt photo with Gemini vision. The model only transcribes what is
 * printed; it never decides anything. Its answer goes through the receipt
 * checks and the mandate engine like any other proposal.
 */
import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { toCents, type ExtractedReceipt } from "./receipt";

export function receiptSchema(categories: string[]) {
  const cats = [...new Set([...categories.map((c) => c.toLowerCase()), "other"])] as [string, ...string[]];
  return z.object({
    isReceipt: z.boolean().describe("true only if the photo shows a purchase receipt or invoice"),
    merchant: z.string().describe("store name as printed, e.g. 'The Home Depot'"),
    merchantDomain: z.string().nullable().describe("the store's website domain if printed or obvious, e.g. 'homedepot.com'; otherwise null"),
    date: z.string().nullable().describe("purchase date as YYYY-MM-DD, or null if not printed"),
    currency: z.string().describe("3-letter ISO currency code, e.g. USD"),
    items: z
      .array(
        z.object({
          description: z.string(),
          quantity: z.number().int().describe("quantity printed on the line, 1 if none"),
          lineTotal: z.number().describe("the line's total price as printed, in currency units (12.34 means 12.34)"),
          category: z.enum(cats).describe("best-fitting category; 'other' if none fits"),
        }),
      )
      .describe("each purchased item line; leave out subtotal, tax, tip, change and payment lines"),
    tax: z.number().nullable().describe("total tax as printed, or null"),
    total: z.number().describe("the grand total actually paid, in currency units"),
    confidence: z.enum(["low", "medium", "high"]).describe("how clearly the receipt could be read"),
    notes: z.string().nullable().describe("anything a treasurer should know, e.g. 'total partly torn off'; otherwise null"),
  });
}

export async function extractReceipt(args: { image: Uint8Array; mediaType: string; categories: string[]; today: string }): Promise<ExtractedReceipt> {
  const { output } = await generateText({
    model: google(process.env.AI_MODEL ?? "gemini-3.5-flash"),
    output: Output.object({ schema: receiptSchema(args.categories) }),
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    maxRetries: 2,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Transcribe this receipt for a volunteer reimbursement. Today is ${args.today}. ` +
              `Copy amounts exactly as printed; do not calculate or guess missing numbers. ` +
              `Allowed categories: ${args.categories.join(", ")} (use "other" for anything else, e.g. alcohol or personal items).`,
          },
          { type: "image", image: args.image, mediaType: args.mediaType },
        ],
      },
    ],
  });

  return {
    isReceipt: output.isReceipt,
    merchant: output.merchant.trim().slice(0, 120),
    merchantDomain: output.merchantDomain,
    date: output.date && /^\d{4}-\d{2}-\d{2}$/.test(output.date) ? output.date : null,
    currency: /^[A-Z]{3}$/.test(output.currency.toUpperCase()) ? output.currency.toUpperCase() : "USD",
    items: output.items.slice(0, 50).map((i) => ({
      description: i.description.trim().slice(0, 120),
      quantity: Math.max(1, Math.round(i.quantity)),
      lineTotalCents: toCents(i.lineTotal),
      category: i.category,
    })),
    taxCents: output.tax == null ? null : toCents(output.tax),
    totalCents: toCents(output.total),
    confidence: output.confidence,
    notes: output.notes,
    source: "gemini",
  };
}
