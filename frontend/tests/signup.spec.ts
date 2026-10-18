import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, enabled = true) {
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/api/v1/auth/signup-options", (route) =>
    route.fulfill({ json: { enabled } }),
  );
  await page.route("**/api/v1/auth/signup", async (route) => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    if (body.signup_key !== "private-deployment-code")
      return route.fulfill({
        status: 403,
        json: {
          detail: {
            code: "invalid_signup_key",
            message: "Invalid admin signup code.",
          },
        },
      });
    await route.fulfill({
      status: 201,
      json: {
        id: "new-admin",
        full_name: body.full_name,
        email: body.email,
        active: true,
      },
    });
  });
  await page.goto("/login");
  await page
    .getByRole("link", { name: "Create an admin account", exact: true })
    .click();
  await expect(page).toHaveURL(/signup/);
  return submissions;
}
async function fill(page: Page) {
  await page.getByLabel("Full name", { exact: true }).fill("Workspace Owner");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-production-password-123");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("new-production-password-123");
  await page
    .getByLabel("Initial team name", { exact: true })
    .fill("Operations");
  await page
    .getByLabel("Admin signup code", { exact: true })
    .fill("private-deployment-code");
}

test("admin signup creates once and returns to sign in without storing credentials", async ({
  page,
}) => {
  const submissions = await setup(page);
  await fill(page);
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(/login/);
  await expect(page.getByRole("status")).toContainText(
    "Your admin account is ready",
  );
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    team_name: "Operations",
    email: "owner@example.test",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...sessionStorage, ...localStorage }),
    ),
  ).not.toContain("private-deployment-code");
  expect(
    await page.evaluate(() => sessionStorage.getItem("relay_access_token")),
  ).toBeNull();
});

test("signup validates passwords, preserves failed inputs, and supports mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const submissions = await setup(page);
  await fill(page);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-password");
  await page
    .getByRole("button", { name: "Create admin account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("matching passwords");
  expect(submissions).toHaveLength(0);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("new-production-password-123");
  await page
    .getByLabel("Admin signup code", { exact: true })
    .fill("wrong-code");
  await page
    .getByRole("button", { name: "Create admin account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid admin signup code",
  );
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Workspace Owner",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByLabel("Admin signup code", { exact: true })
    .fill("private-deployment-code");
  await page
    .getByRole("button", { name: "Create admin account", exact: true })
    .click();
  await expect(page).toHaveURL(/login/);
  expect(submissions).toHaveLength(2);
});

test("disabled signup cannot submit", async ({ page }) => {
  const submissions = await setup(page, false);
  await expect(page.getByRole("alert")).toContainText(
    "Admin signup is disabled",
  );
  await expect(
    page.getByRole("button", { name: "Create admin account", exact: true }),
  ).toBeDisabled();
  expect(submissions).toHaveLength(0);
});
