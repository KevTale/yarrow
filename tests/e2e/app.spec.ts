import { expect, test } from "@playwright/test";

test("landing renders without client errors or horizontal overflow", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Fund the compute. Ship the PR." }),
  ).toBeVisible();
  await expect(page.getByText("Claude Opus 5.5 implements")).toBeVisible();
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

test("fund shows the brief's breakdown and asks to sign in", async ({
  page,
}) => {
  await page.goto("/fund?amount=100");
  await expect(page.getByRole("radio", { name: /Sprint/ })).toBeChecked();
  await expect(page.getByText("≈ $86.80")).toBeVisible();
  await page.getByText("Show the estimate as an EU consumer").click();
  await expect(page.getByText("≈ $71.80")).toBeVisible();
  await page.getByRole("radio", { name: /Starter/ }).check();
  await expect(page.getByText("≈ $6.91")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Sign in with GitHub to continue/ }),
  ).toHaveAttribute("href", /\/auth\/github\?next=/);
});

test("public pages render their empty or offline states", async ({ page }) => {
  for (const [path, heading] of [
    ["/leaderboard", "The sponsors behind the work."],
    ["/work", "Every run, in the open."],
    ["/showcase", "Builders shipping with sponsored compute."],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("private pages ask for GitHub sign-in", async ({ page }) => {
  for (const path of ["/dashboard", "/projects/new", "/sponsor/filters"]) {
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
