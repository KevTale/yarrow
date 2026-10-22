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
  await expect(page.getByText("Demo workspace · sample data")).toBeVisible();
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

test("fund routes the selected pack and pool without creating money", async ({
  page,
}) => {
  await page.goto("/fund?pack=sprint");
  await expect(page.getByRole("radio", { name: /Sprint/ })).toBeChecked();
  await page.getByRole("radio", { name: /Starter/ }).check();
  await page.getByRole("radio", { name: /Back commercial work/ }).check();
  await page.getByLabel("Project destination").selectOption("halyard");
  await page.getByRole("radio", { name: /Keep it anonymous/ }).check();
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/checkout") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Preview $5.00 checkout" }).click();
  expect((await request).postDataJSON()).toEqual({
    packId: "starter",
    pool: "commercial",
    projectId: "halyard",
    visibility: "anonymous",
  });
  await expect(page.getByRole("status")).toContainText(
    "no payment or compute credit was created",
  );
});

test("leaderboard filters and sorts by paid dollars", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.getByRole("button", { name: "Commercial", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Northwind Labs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Hexwork GmbH", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "$2,350", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("does-not-exist");
  await expect(
    page.getByText("No funders match.", { exact: false }),
  ).toBeVisible();
});

test("project draft survives navigation and reload without claiming a connection", async ({
  page,
}) => {
  await page.goto("/projects/new");
  await page.getByLabel("Project name", { exact: true }).fill("Commons test");
  await page.getByLabel("GitHub repository").fill("demo/commons-test");
  await page.getByRole("button", { name: /Connect GitHub App/ }).click();
  await expect(page.getByRole("status")).toContainText("not connected");
  await page.getByRole("radio", { name: /Commercial/ }).check();
  await page.getByRole("button", { name: "Save project draft" }).click();
  await page.getByRole("link", { name: "View my activity" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Commons test", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Commons test", { exact: true })).toBeVisible();
  await expect(page.getByText("Local draft", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("abstention is a visible outcome with its own detail page", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Abstained", exact: true }).click();
  await page
    .getByRole("link", { name: /Redesign query planner cost model/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Abstained. With a reason." }),
  ).toBeVisible();
  await expect(page.getByText("$7.59", { exact: true })).toBeVisible();
});

test("unfinished payment and integration endpoints fail closed", async ({
  request,
}) => {
  const webhook = await request.post("/api/webhooks/stripe", {
    data: { type: "checkout.session.completed" },
  });
  expect(webhook.status()).toBe(501);
  const checkout = await request.post("/api/checkout", {
    data: {
      packId: "builder",
      pool: "commons",
      projectId: "halyard",
      visibility: "public",
    },
  });
  expect(checkout.status()).toBe(400);
});
