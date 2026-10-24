/**
 * The environment shared by the Postman (newman) run and the Playwright smoke test:
 * a mocked PayPal, a scripted AI model, every other integration off, and a database
 * the tests are allowed to write to. Plain Node, so it works on Windows and in CI alike.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

export const APP_PORT = 3200;
/** The mock PayPal's port, kept apart from the app's. Override with MOCK_PAYPAL_PORT. */
export const MOCK_PAYPAL_PORT = Number(process.env.MOCK_PAYPAL_PORT || 4020);

export function e2eEnv() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url && process.env.E2E_USE_DEV_DB !== "1") {
    console.error(
      "These tests create and pay a (mock) purchase, so they need their own database.\n" +
        "Set E2E_DATABASE_URL to a throwaway Neon branch that has been through `npm run db:migrate && npm run db:seed`,\n" +
        "or set E2E_USE_DEV_DB=1 if a mock payment in your dev database is fine.",
    );
    process.exit(1);
  }
  return {
    ...process.env,
    ...(url ? { DATABASE_URL: url } : {}),
    NEXT_DIST_DIR: ".next-e2e",
    // Always the mock: real PayPal keys must never be sent to it, and the mock must never stand in for them.
    MOCK_PAYPAL_PORT: String(MOCK_PAYPAL_PORT),
    PAYPAL_API_BASE: `http://localhost:${MOCK_PAYPAL_PORT}`,
    NEXT_PUBLIC_PAYPAL_SDK_URL: `http://localhost:${MOCK_PAYPAL_PORT}/sdk.js`,
    PAYPAL_CLIENT_ID: "mock-client-id",
    PAYPAL_CLIENT_SECRET: "mock-client-secret",
    PAYPAL_WEBHOOK_ID: "mock-webhook-id",
    AI_MOCK: "true",
    EMBEDDINGS_ENABLED: "false",
    KERNEL_ENABLED: "false",
    ZAPIER_ENABLED: "false",
    SLACK_ENABLED: "false",
    RESEND_ENABLED: "false",
    CHANNEL3_ENABLED: "false",
    APP_URL: `http://localhost:${APP_PORT}`,
    APP_SECRET: process.env.APP_SECRET || "e2e-secret-e2e-secret-e2e-secret-00",
  };
}
