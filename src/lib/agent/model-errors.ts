/** Gemini errors in words a person can act on. Shared by the chat agent and the AG Studio Treasurer agent. */

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

export function friendlyModelError(e: unknown): { code: string; message: string } {
  const msg = errorText(e);
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return { code: "rate_limited", message: rateLimitMessage(msg) };
  if (/not found|404|is not supported/i.test(msg)) return { code: "model_not_found", message: `The model "${process.env.AI_MODEL}" isn't available — check AI_MODEL in .env.local.` };
  if (/API key|401|403|PERMISSION_DENIED/i.test(msg)) return { code: "bad_key", message: "The Gemini API key was rejected — check GOOGLE_GENERATIVE_AI_API_KEY in .env.local." };
  return { code: "model_error", message: "Something went wrong talking to the AI model — see the terminal for details." };
}
