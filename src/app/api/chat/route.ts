import { google } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildTools, mandateSummaries } from "@/lib/agent/tools";
import { systemPrompt } from "@/lib/agent/prompt";
import { SPENDING_POLICY } from "@/lib/policy";
import { chunkPolicy } from "@/lib/search/text";
import { flags } from "@/lib/flags";
import { mockModel } from "@/lib/agent/mock-model";
import { friendlyModelError } from "@/lib/agent/model-errors";
import { currentMember } from "@/lib/session";

export const maxDuration = 60;

function textOf(m: UIMessage | undefined): string {
  return (m?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
}

export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { id: chatId, messages } = (await req.json()) as { id: string; messages: UIMessage[] };
  if (!chatId || !Array.isArray(messages)) return Response.json({ error: "Bad request" }, { status: 400 });

  const org = await db().query.orgs.findFirst({ where: eq(schema.orgs.id, me.orgId) });
  if (!org) return Response.json({ error: "Org not found" }, { status: 500 });

  // One purchase request per chat; the chat id is the request id.
  await db()
    .insert(schema.purchaseRequests)
    .values({ id: chatId, orgId: org.id, memberId: me.id, text: textOf(messages.find((m) => m.role === "user")).slice(0, 2000) })
    .onConflictDoNothing();
  const request = await db().query.purchaseRequests.findFirst({ where: eq(schema.purchaseRequests.id, chatId) });
  if (!request || request.memberId !== me.id) return Response.json({ error: "Not your conversation" }, { status: 403 });

  const result = streamText({
    model: flags.aiMock() ? mockModel() : google(process.env.AI_MODEL ?? "gemini-3.5-flash"),
    // Mandates go in the prompt up front (saves a model call); the policy is searched (searchPolicy) in the same step as the products.
    system: systemPrompt({
      memberName: me.name,
      orgName: org.name,
      today: new Date().toISOString().slice(0, 10),
      mandates: await mandateSummaries(org.id),
      kernelLive: flags.kernel(),
      policySections: [...new Set(chunkPolicy(SPENDING_POLICY).map((c) => `${c.clause.split(".")[0]}. ${c.section}`))],
    }),
    // Keeps each tool call's thought signature (stored on the UI message parts), which Gemini 3 requires.
    messages: await convertToModelMessages(messages),
    tools: buildTools({
      orgId: org.id,
      memberId: me.id,
      requestId: request.id,
      traceId: request.traceId,
      appUrl: process.env.APP_URL ?? new URL(req.url).origin,
    }),
    stopWhen: stepCountIs(8),
    // Low thinking keeps replies fast and saves free-tier quota; tool choice is simple here.
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    // The SDK backs off 2s then 4s. Longer per-minute windows are reported to the user with the wait time instead.
    maxRetries: 2,
  });

  return result.toUIMessageStreamResponse({
    onError: (e) => {
      console.error("chat error", e);
      return friendlyModelError(e).message;
    },
  });
}
