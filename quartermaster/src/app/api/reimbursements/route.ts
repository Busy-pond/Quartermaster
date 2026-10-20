import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { submitReimbursement } from "@/lib/reimbursements/service";

export const maxDuration = 60;

const Body = z.object({
  mandateId: z.string().min(1),
  imageDataUrl: z.string().startsWith("data:image/"),
  note: z.string().max(500).nullish(),
  manual: z
    .object({
      merchant: z.string().trim().min(1, "Enter the store name").max(120),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      totalDollars: z.number().positive("Enter the total paid").max(10_000),
      category: z.string().min(1),
    })
    .nullish(),
});

/** A volunteer submits a receipt photo. Gemini reads it unless the details were typed in by hand. */
export const POST = handle(async (req: Request) => {
  const me = await requireMember();
  const body = Body.parse(await req.json());
  const row = await submitReimbursement({
    member: me,
    mandateId: body.mandateId,
    imageDataUrl: body.imageDataUrl,
    note: body.note,
    manual: body.manual ? { merchant: body.manual.merchant, date: body.manual.date, totalCents: Math.round(body.manual.totalDollars * 100), category: body.manual.category } : null,
  }).catch((e: unknown) => {
    // The model call is the step most likely to fail (quota, unreadable photo); say so plainly so the page can offer typing it in.
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|quota|RESOURCE_EXHAUSTED|rate/i.test(msg)) throw new Error("READ_FAILED: The AI model's free-tier limit was hit. Wait a minute and try again, or type the details in by hand.");
    if (/NoObjectGenerated|No output|parse|schema|AI_/i.test(msg)) throw new Error("READ_FAILED: The receipt couldn't be read. Try a sharper, flatter photo, or type the details in by hand.");
    throw e;
  });
  return NextResponse.json({ id: row.id, status: row.status });
});
