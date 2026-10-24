import { expect, test, type Page } from "@playwright/test";

/** Sideways overflow, plus the elements that stick out past the right edge (named in the failure message). */
function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const wide = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > root.clientWidth + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5)
      .map(({ el, right }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${(el.textContent ?? "").trim().slice(0, 40)}" right=${Math.round(right)}`)
      .join(" | ");
    return { overflow: root.scrollWidth - root.clientWidth, wide };
  });
}

/** Phone width (360 px): no page may scroll sideways, and every page needs a heading. */
test.use({ viewport: { width: 360, height: 740 } });

const PAGES = ["/", "/try", "/chat", "/status", "/mandates", "/treasurer", "/reimburse", "/join", "/settings"];

test.beforeEach(async ({ context }) => {
  const res = await context.request.post("/api/session", { data: { role: "treasurer" } });
  expect(res.ok()).toBeTruthy();
});

for (const path of PAGES) {
  test(`${path} fits a 360 px screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const { overflow, wide } = await measure(page);
    expect(overflow, `horizontal overflow in px; widest: ${wide}`).toBeLessThanOrEqual(0);
  });
}

/** The landing page at tablet and desktop widths too (360 px is covered above). */
for (const width of [768, 1440]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test(`/ fits a ${width} px screen`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const { overflow, wide } = await measure(page);
      expect(overflow, `horizontal overflow in px; widest: ${wide}`).toBeLessThanOrEqual(0);
    });
  });
}

test("reduced motion shows every story step at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".story-step[data-lit]")).toHaveCount(6);
});

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
