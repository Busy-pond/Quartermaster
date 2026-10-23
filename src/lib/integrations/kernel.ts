/**
 * KERNEL live verification (Day 10, https://kernel.sh/docs).
 * Opens the buy link in a KERNEL cloud browser, takes a screenshot and the
 * visible page text; Gemini only transcribes price, stock and delivery from
 * that text. Results are cached for 6 hours. If KERNEL is off or fails, the
 * last cached check is returned, labelled as cached with its age.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { flags } from "@/lib/flags";
import type { LiveCheck } from "@/lib/verify/price";

const FRESH_MS = 6 * 3600_000;
export const verifyCacheKey = (url: string) => "kernel:" + createHash("sha256").update(url).digest("hex");

/** Runs inside the KERNEL browser VM, where `page` is a Playwright page. */
const PAGE_SCRIPT = `
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_TO_OPEN, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2000);
  const text = (await page.evaluate(() => document.body ? document.body.innerText : "")).slice(0, 12000);
  const shot = (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64");
  return { title: await page.title(), text, shot };
`;

const Extracted = z.object({
  price: z.number().nullable().describe("price of ONE listing as shown for this product, in currency units; null if not shown"),
  inStock: z.boolean().nullable().describe("true if it can be bought now, false if out of stock, null if unclear"),
  deliveryText: z.string().nullable().describe("the delivery or arrival promise as printed, e.g. 'Arrives Fri, Oct 31'; null if none"),
  isProductPage: z.boolean().describe("false for captchas, errors, sign-in walls or unrelated pages"),
});

async function readCache(url: string): Promise<LiveCheck | null> {
  const row = await db().query.apiCache.findFirst({ where: eq(schema.apiCache.key, verifyCacheKey(url)) });
  return row ? ({ ...(row.value as LiveCheck), source: "cache" } satisfies LiveCheck) : null;
}

async function runKernel(url: string): Promise<{ title: string; text: string; shot: string }> {
  const { default: Kernel } = await import("@onkernel/sdk");
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const browser = await kernel.browsers.create({ stealth: true, timeout_seconds: 120 });
  try {
    const r = await kernel.browsers.playwright.execute(browser.session_id, { code: PAGE_SCRIPT.replace("URL_TO_OPEN", JSON.stringify(url)), timeout_sec: 60 });
    if (!r.success) throw new Error(r.error ?? r.stderr ?? "KERNEL script failed");
    return r.result as { title: string; text: string; shot: string };
  } finally {
    await kernel.browsers.deleteByID(browser.session_id).catch(() => undefined);
  }
}

/** Checks one retailer page. Returns null only when there is neither a live result nor a cached one. */
export async function verifyProduct(url: string, productTitle: string): Promise<LiveCheck | null> {
  const cached = await readCache(url);
  if (cached && Date.now() - Date.parse(cached.verifiedAt) < FRESH_MS) return cached;
  if (!flags.kernel()) return cached;

  try {
    const page = await runKernel(url);
    const { output } = await generateText({
      model: google(process.env.AI_MODEL ?? "gemini-3.5-flash"),
      output: Output.object({ schema: Extracted }),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      maxRetries: 1,
      prompt:
        `This is the visible text of a retailer page for "${productTitle}" (page title: "${page.title}"). ` +
        `Copy the price, stock state and delivery promise exactly as shown; do not calculate or guess.\n\n${page.text}`,
    });
    const check: LiveCheck = {
      url,
      verifiedAt: new Date().toISOString(),
      livePriceCents: output.isProductPage && output.price != null ? Math.round(output.price * 100) : null,
      inStock: output.isProductPage ? output.inStock : null,
      deliveryText: output.isProductPage ? output.deliveryText : null,
      screenshot: `data:image/jpeg;base64,${page.shot}`,
      source: "kernel",
      note: output.isProductPage ? null : "The page didn't show the product (captcha, error or sign-in wall)",
    };
    await db()
      .insert(schema.apiCache)
      .values({ key: verifyCacheKey(url), value: check })
      .onConflictDoUpdate({ target: schema.apiCache.key, set: { value: check, createdAt: new Date() } });
    return check;
  } catch (e) {
    console.error("KERNEL verification failed", e instanceof Error ? e.message : e);
    return cached;
  }
}

/** For trust receipts: the stored check (with its screenshot) behind a cache key. */
export async function storedCheck(key: string): Promise<LiveCheck | null> {
  const row = await db().query.apiCache.findFirst({ where: eq(schema.apiCache.key, key) });
  return (row?.value as LiveCheck | undefined) ?? null;
}
