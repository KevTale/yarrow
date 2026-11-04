import { expect, test } from "@playwright/test";

test("landing renders without client errors or horizontal overflow", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "The best ticket harness for your product team",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("landing.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("removed pages are gone", async ({ page }) => {
  for (const path of [
    "/changelog",
    "/fund",
    "/leaderboard",
    "/shipped",
    "/showcase",
    "/sponsors",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

test("private pages ask for GitHub sign-in", async ({ page }) => {
  for (const path of ["/dashboard", "/account"]) {
    await page.goto(path);
    await expect(
      page.getByRole("link", { name: /Continue with GitHub/ }),
    ).toBeVisible();
  }
});

test("unknown runs show a not-found page", async ({ page }) => {
  await page.goto("/runs/5f8d3c2a-1111-4222-8333-944455556666");
  await expect(
    page.getByRole("heading", { name: "Run not found" }),
  ).toBeVisible();
});
