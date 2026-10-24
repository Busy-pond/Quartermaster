import { expect, test } from "@playwright/test";

/**
 * The hero flow, end to end, with PayPal and the AI model mocked:
 * home -> volunteer chat -> proposal -> treasurer approves and pays -> trust receipt.
 * The mandate engine, the database and every page are the real ones.
 */
test("a volunteer's request is approved and paid by the treasurer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Let an AI buy for your team");

  // Volunteer asks in chat.
  await page.getByRole("button", { name: "Try it as a volunteer" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByLabel("Your request").fill("Get 2 folding tables for the beach cleanup.");
  await page.getByRole("button", { name: "Send" }).click();

  // The scripted agent searches, dry-runs and proposes; the real engine decides.
  const toApproval = page.getByRole("link", { name: /Send to the treasurer|Complete payment/ });
  await expect(page.getByText("Open trust receipt")).toBeVisible();
  await expect(toApproval).toBeVisible();
  await toApproval.click();

  // The volunteer cannot pay; the treasurer can.
  await expect(page).toHaveURL(/\/approve\//);
  await expect(page.getByText("Only the mandate’s approver")).toBeVisible();
  await page.getByRole("button", { name: "Switch to treasurer to approve" }).click();
  const pay = page.getByRole("button", { name: /^Approve & pay/ });
  await expect(pay).toBeEnabled();
  await pay.click();

  // Mock PayPal captures; the app shows the Paid stamp, then opens the trust receipt.
  await expect(page.getByText("Payment captured by PayPal")).toBeVisible();
  await expect(page).toHaveURL(/\/receipts\//);
  await expect(page.getByText("MOCKCAPTURE")).toBeVisible();
});
