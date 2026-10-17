/**
 * Feature flags. Each integration is "live" only when its flag is on AND its
 * key is present; otherwise the app uses a fallback. /status shows the result.
 */
const on = (name: string) => process.env[name] !== "false";
const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]));

export type IntegrationState = "live" | "fallback" | "off";

export interface Integration {
  key: string;
  name: string;
  role: string;
  state: IntegrationState;
  fallback: string;
}

export function integrations(): Integration[] {
  return [
    {
      key: "paypal",
      name: "PayPal sandbox",
      role: "Orders, capture, refunds, payouts, webhooks",
      state: has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET") ? "live" : "off",
      fallback: "None — PayPal is required",
    },
    {
      key: "webhooks",
      name: "PayPal webhooks",
      role: "Signature-verified payment events",
      state: has("PAYPAL_WEBHOOK_ID") ? "live" : "off",
      fallback: "Capture result is still saved from the capture call",
    },
    {
      key: "ai",
      name: "Gemini (Google AI Studio)",
      role: "Agent reasoning and tool calling",
      state: has("GOOGLE_GENERATIVE_AI_API_KEY") ? "live" : "off",
      fallback: "None — the agent needs a model",
    },
    {
      key: "channel3",
      name: "Channel3",
      role: "Product search across retailers",
      state: flags.channel3() ? "live" : "fallback",
      fallback: "Recorded sample products for the demo queries",
    },
  ];
}

export const flags = {
  channel3: () => on("CHANNEL3_ENABLED") && has("CHANNEL3_API_KEY"),
};
