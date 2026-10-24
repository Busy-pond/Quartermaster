import { expect, test } from "@playwright/test";

/** Phone width (360 px): no page may scroll sideways, and every page needs a heading. */
test.use({ viewport: { width: 360, height: 740 } });

const PAGES = ["/", "/chat", "/status", "/mandates", "/treasurer", "/reimburse", "/join", "/settings"];

test.beforeEach(async ({ context }) => {
  const res = await context.request.post("/api/session", { data: { role: "treasurer" } });
  expect(res.ok()).toBeTruthy();
});

for (const path of PAGES) {
  test(`${path} fits a 360 px screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
  });
}

test("the first Tab stop is visibly focused", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, width: parseFloat(s.outlineWidth), style: s.outlineStyle, shadow: s.boxShadow };
  });
  expect(outline.style !== "none" || outline.shadow !== "none").toBeTruthy();
});
