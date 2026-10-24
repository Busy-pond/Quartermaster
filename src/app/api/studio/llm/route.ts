import { randomUUID } from "node:crypto";
import { google } from "@ai-sdk/google";
import { generateText, jsonSchema, Output } from "ai";
import { NextResponse } from "next/server";
import type { AgLlmResponse } from "ag-studio";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { flags } from "@/lib/flags";
import { StudioTurnBody } from "@/lib/api/schemas";
import { friendlyModelError } from "@/lib/agent/model-errors";
import { toModelMessages, toStudioOutput, toToolChoice, toToolSet, type ResultPart } from "@/lib/studio/llm-turn";
import type { AgAiConversationItem, AgLlmRequest } from "ag-studio";

export const maxDuration = 60;

/**
 * One turn of the AG Studio Treasurer agent on Gemini (Day 18). The Gemini key stays
 * on the server; tools are returned as calls for the browser to run, so this route
 * can read nothing and change nothing by itself. It never touches money.
 */
export const POST = handle(async (req: Request) => {
  await requireMember();
  const body = StudioTurnBody.parse(await req.json()) as unknown as AgLlmRequest;
  const id = `resp_${randomUUID()}`;
  const base = { id, createdAt: Date.now() };

  if (flags.aiMock())
    return NextResponse.json({
      ...base,
      status: "completed",
      model: "scripted-agent",
      output: toStudioOutput([{ type: "text", text: "The scripted model is on (AI_MOCK=true), so I can't build widgets. Turn it off to use Gemini." }], `msg_${id}`),
    } satisfies AgLlmResponse);

  try {
    const result = await generateText({
      model: google(process.env.AI_MODEL ?? "gemini-3.5-flash"),
      system: body.instructions,
      messages: toModelMessages(body.input as AgAiConversationItem[]),
      tools: toToolSet(body.tools),
      toolChoice: toToolChoice(body.toolChoice),
      ...(body.responseFormat.type === "json" ? { output: Output.object({ schema: jsonSchema(body.responseFormat.schema as Parameters<typeof jsonSchema>[0]) }) } : {}),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      maxOutputTokens: 8192,
      maxRetries: 2,
    });
    return NextResponse.json({
      ...base,
      status: result.finishReason === "length" ? "incomplete" : "completed",
      ...(result.finishReason === "length" ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
      model: process.env.AI_MODEL ?? "gemini-3.5-flash",
      output: toStudioOutput(result.content as ResultPart[], `msg_${id}`),
      usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
    } satisfies AgLlmResponse);
  } catch (e) {
    console.error("studio llm error", e);
    return NextResponse.json({ ...base, status: "failed", error: friendlyModelError(e), output: [] } satisfies AgLlmResponse);
  }
});
