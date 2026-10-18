import { expect, test, type Page } from "@playwright/test";
import type { DirectoryUser, UserCreateInput } from "../src/types";
const teamId = "10000000-0000-0000-0000-000000000001";
async function setup(page: Page, manage = true) {
  const requests: UserCreateInput[] = [];
  const searches: URLSearchParams[] = [];
  let roleRequests = 0;
  const users: DirectoryUser[] = [
    {
      id: "admin-1",
      full_name: "Workspace Admin",
      email: "admin@example.test",
      active: true,
      grants: [{ role_code: "ADMIN", team_id: null, team_name: null }],
    },
    {
      id: "engineer-1",
      full_name: "Existing Engineer",
      email: "engineer@example.test",
      active: true,
      grants: [
        { role_code: "ENGINEER", team_id: teamId, team_name: "Operations" },
      ],
    },
  ];
  await page.addInitScript(() =>
    sessionStorage.setItem("relay_access_token", "test-only-user-admin-token"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        json: data,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
        },
      });
    if (path === "/auth/me")
      return json({
        id: "admin-1",
        full_name: "Workspace Admin",
        email: "admin@example.test",
        active: true,
      });
    if (path === "/auth/access")
      return json({
        global_permissions: manage ? ["user:manage"] : [],
        teams: [
          { team_id: teamId, permissions: ["user:manage", "work_item:read"] },
        ],
      });
    if (path === "/teams")
      return json({
        items: [
          { id: teamId, name: "Operations", description: "Operations team" },
        ],
      });
    if (path === "/roles") {
      roleRequests++;
      return json({
        items: [
          { code: "ENGINEER", requires_team: true },
          { code: "ADMIN", requires_team: false },
        ],
      });
    }
    if (path === "/users" && request.method() === "POST") {
      const body = request.postDataJSON() as UserCreateInput;
      requests.push(body);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (users.some((user) => user.email === body.email))
        return json(
          {
            detail: {
              code: "duplicate",
              message: "Email or assignment already exists",
            },
          },
          409,
        );
      const user: DirectoryUser = {
        id: `user-${users.length + 1}`,
        full_name: body.full_name,
        email: body.email,
        active: true,
        grants: [
          {
            role_code: body.role_code,
            team_id: body.team_id,
            team_name: body.team_id ? "Operations" : null,
          },
        ],
      };
      users.push(user);
      return json(
        {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          active: true,
        },
        201,
      );
    }
    if (path === "/users") {
      searches.push(url.searchParams);
      const term = (url.searchParams.get("search") || "").toLowerCase();
      const page = Number(url.searchParams.get("page") || 1);
      const filtered = users.filter((user) =>
        `${user.full_name} ${user.email}`.toLowerCase().includes(term),
      );
      return json({
        items: filtered.slice(page - 1, page),
        total: filtered.length,
        page,
        page_size: 1,
      });
    }
    return json({ detail: { code: "not_found", message: "Not found" } }, 404);
  });
  await page.goto("/users");
  return {
    requests,
    searches,
    users,
    get roleRequests() {
      return roleRequests;
    },
  };
}
async function fillUser(page: Page, email = "jane@example.test") {
  await page.getByRole("button", { name: "Create User", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create User" });
  await dialog.getByLabel("Full name", { exact: true }).fill("Jane Doe");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog
    .getByLabel("Initial password", { exact: true })
    .fill("onboarding-password-123");
  await dialog.getByLabel("Select role").selectOption("ENGINEER");
  return dialog;
}
test("admin creates a team user once and the directory sends search and pagination to the API", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(
    page.getByRole("link", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect
    .poll(() => state.searches.some((query) => query.get("page") === "2"))
    .toBe(true);
  const dialog = await fillUser(page);
  await expect(
    dialog.getByRole("button", { name: "Create User", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Select team").selectOption(teamId);
  await dialog.getByLabel("Initial password", { exact: true }).fill("short");
  await dialog
    .getByRole("button", { name: "Create User", exact: true })
    .click();
  expect(state.requests).toHaveLength(0);
  await dialog
    .getByLabel("Initial password", { exact: true })
    .fill("onboarding-password-123");
  await dialog
    .getByRole("button", { name: "Create User", exact: true })
    .dblclick();
  await expect(dialog).toHaveCount(0);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({
    role_code: "ENGINEER",
    team_id: teamId,
    email: "jane@example.test",
  });
  await expect(page.getByRole("status")).toContainText("Jane Doe was created");
  await page.getByLabel("Search users").fill("jane@example.test");
  await page.getByLabel("Search users").press("Enter");
  await expect(
    page.getByRole("cell", { name: "Jane Doe", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      state.searches.some(
        (query) => query.get("search") === "jane@example.test",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Create User", exact: true }).click();
  await expect(
    page.getByLabel("Initial password", { exact: true }),
  ).toHaveValue("");
});
test("duplicate email errors preserve form values so the admin can correct and retry", async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = await fillUser(page, "engineer@example.test");
  await dialog.getByLabel("Select team").selectOption(teamId);
  await dialog
    .getByRole("button", { name: "Create User", exact: true })
    .click();
  await expect(
    dialog.getByText("An account with this email already exists."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue(
    "Jane Doe",
  );
  await expect(
    dialog.getByLabel("Initial password", { exact: true }),
  ).toHaveValue("onboarding-password-123");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("new-engineer@example.test");
  await dialog
    .getByRole("button", { name: "Create User", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests).toHaveLength(2);
  expect(
    state.users.filter((user) => user.email === "new-engineer@example.test"),
  ).toHaveLength(1);
});
test("workspace roles can be created without a team and their scope is explicit", async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = await fillUser(page, "new-admin@example.test");
  await dialog.getByLabel("Select role").selectOption("ADMIN");
  await expect(
    dialog.getByText(
      "This role grants workspace-wide permissions. Team work still requires team membership.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Workspace access (no team)"),
  ).not.toHaveAttribute("required");
  await dialog
    .getByRole("button", { name: "Create User", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests[0].team_id).toBeNull();
  expect(state.requests[0].role_code).toBe("ADMIN");
});
test("a team-scoped user-management grant does not reveal the page or administrative reads", async ({
  page,
}) => {
  const state = await setup(page, false);
  await expect(
    page.getByRole("link", { name: "Users", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "You do not have permission",
  );
  expect(state.searches).toHaveLength(0);
  expect(state.roleRequests).toBe(0);
  expect(state.requests).toHaveLength(0);
});
test("user onboarding fits a mobile viewport and supports keyboard dismissal", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("users-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create User", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("create-user-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
