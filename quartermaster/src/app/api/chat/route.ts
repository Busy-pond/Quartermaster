import { google } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildTools, mandateSummaries } from "@/lib/agent/tools";
import { systemPrompt } from "@/lib/agent/prompt";
import { SPENDING_POLICY } from "@/lib/policy";
import { chunkPolicy } from "@/lib/search/text";
import { flags } from "@/lib/flags";
import { currentMember } from "@/lib/session";

export const maxDuration = 60;

function textOf(m: UIMessage | undefined): string {
  return (m?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
}

/** The SDK wraps the provider error (RetryError → APICallError); the quota details are in the response body. */
function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 4; i++) {
    const o = cur as { message?: string; responseBody?: string; lastError?: unknown; cause?: unknown };
    parts.push(String(o.message ?? cur), o.responseBody ?? "");
    cur = o.lastError ?? o.cause;
  }
  return parts.join(" ");
}

/** Tells the user whether the per-minute or the daily free-tier quota ran out, and how long to wait. */
function rateLimitMessage(msg: string): string {
  if (/PerDay/i.test(msg))
    return `The daily free-tier quota for ${process.env.AI_MODEL ?? "the model"} is used up. It resets at midnight Pacific time. Until then, use another Gemini API key or model (AI_MODEL in .env.local), or turn on billing in Google AI Studio.`;
  const wait = msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":\s*"(\d+)s"/)?.[1];
  return `The AI model's per-minute limit was hit. Wait ${wait ? `${Math.ceil(Number(wait))} seconds` : "about a minute"}, then press Retry.`;
}

export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return new Response("Sign in first", { status: 401 });
  const { id: chatId, messages } = (await req.json()) as { id: string; messages: UIMessage[] };
  if (!chatId || !Array.isArray(messages)) return new Response("Bad request", { status: 400 });

  const org = await db().query.orgs.findFirst({ where: eq(schema.orgs.id, me.orgId) });
  if (!org) return new Response("Org not found", { status: 500 });

  // One purchase request per chat; the chat id is the request id.
  await db()
    .insert(schema.purchaseRequests)
    .values({ id: chatId, orgId: org.id, memberId: me.id, text: textOf(messages.find((m) => m.role === "user")).slice(0, 2000) })
    .onConflictDoNothing();
  const request = await db().query.purchaseRequests.findFirst({ where: eq(schema.purchaseRequests.id, chatId) });
  if (!request || request.memberId !== me.id) return new Response("Not your conversation", { status: 403 });

  const result = streamText({
    model: google(process.env.AI_MODEL ?? "gemini-3.5-flash"),
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
      const msg = errorText(e);
      if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return rateLimitMessage(msg);
      if (/not found|404|is not supported/i.test(msg)) return `The model "${process.env.AI_MODEL}" isn't available — check AI_MODEL in .env.local.`;
      if (/API key|401|403|PERMISSION_DENIED/i.test(msg)) return "The Gemini API key was rejected — check GOOGLE_GENERATIVE_AI_API_KEY in .env.local.";
      return "Something went wrong talking to the AI model — see the terminal for details.";
    },
  });
}
