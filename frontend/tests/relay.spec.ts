import { expect, test, type Page } from "@playwright/test";
import type { WorkItem } from "../src/types";
const teamId = "10000000-0000-0000-0000-000000000001";
const userId = "20000000-0000-0000-0000-000000000001";
const itemId = "30000000-0000-0000-0000-000000000001";
const approvalId = "40000000-0000-0000-0000-000000000001";
const fixtureItem: WorkItem = {
  id: itemId,
  parent_id: null,
  team_id: teamId,
  creator_id: userId,
  owner_id: null,
  assignments: [],
  allowed_transitions: ["IN_PROGRESS"],
  title: "Payment reconciliation",
  description: "Review the settlement batch.",
  type: "PAYMENT",
  status: "OPEN",
  priority: "HIGH",
  next_action: "Check the ledger",
  due_at: null,
  resolved_at: null,
  version: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-01T08:00:00Z",
};
async function mockApi(
  page: Page,
  options: { conflict?: boolean; readonly?: boolean; itemError?: number } = {},
) {
  let item = { ...fixtureItem };
  let patches: Record<string, unknown>[] = [];
  let creates: Record<string, unknown>[] = [];
  let createKeys: string[] = [];
  let decisions = 0;
  let expired = false;
  let bookmarked = false;
  const comments: {
    id: string;
    author_id: string;
    author_name: string;
    body: string;
    created_at: string;
  }[] = [];
  const versions: number[] = [];
  const listQueries: URLSearchParams[] = [];
  const permissions = options.readonly
    ? ["work_item:read"]
    : [
        "work_item:read",
        "work_item:update",
        "work_item:create",
        "work_item:assign",
        "work_item:transition",
        "work_item:close",
        "approval:request",
        "approval:decide",
      ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        json: data,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (method === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE",
          "Access-Control-Allow-Headers":
            "Authorization,Content-Type,Idempotency-Key",
        },
      });
    if (path === "/auth/login")
      return json({ access_token: "test-only-token", token_type: "bearer" });
    if (path === "/auth/me" && expired)
      return json(
        { detail: { code: "unauthorized", message: "Session expired" } },
        401,
      );
    if (path === "/auth/me")
      return json({
        id: userId,
        full_name: "Test Operator",
        email: "operator@example.test",
        active: true,
      });
    if (path === "/auth/access")
      return json({
        global_permissions: [],
        teams: [{ team_id: teamId, permissions }],
      });
    if (path === "/teams")
      return json({
        items: [
          {
            id: teamId,
            name: "Operations",
            description: "Settlement operations",
          },
        ],
      });
    if (path === `/teams/${teamId}/members`)
      return json({
        items: [
          {
            id: userId,
            full_name: "Test Operator",
            email: "operator@example.test",
            active: true,
          },
        ],
      });
    if (path === "/dashboard/attention")
      return json({
        items: [{ work_item: item, reasons: ["UNASSIGNED"] }],
        total: 1,
        page: 1,
        page_size: 20,
      });
    if (path === "/work-items" && method === "POST") {
      creates.push(request.postDataJSON());
      createKeys.push(request.headers()["idempotency-key"]);
      item = { ...item, ...request.postDataJSON() };
      return json(item, 201);
    }
    if (path === "/work-items") {
      listQueries.push(url.searchParams);
      return json({ items: [item], total: 1, page: 1, page_size: 20 });
    }
    if (path === `/work-items/${itemId}` && method === "PATCH") {
      const body = request.postDataJSON();
      patches.push(body);
      if (options.conflict && patches.length === 1) {
        item = { ...item, title: "Changed by another operator", version: 2 };
        return json(
          {
            detail: {
              code: "stale_version",
              message: "Work item changed; fetch the latest version and retry",
            },
          },
          409,
        );
      }
      item = { ...item, ...body, version: item.version + 1 };
      return json(item);
    }
    if (path === `/work-items/${itemId}` && options.itemError)
      return json(
        { detail: { code: "forbidden", message: "Access denied" } },
        options.itemError,
      );
    if (path === `/work-items/${itemId}`) return json(item);
    if (path === `/work-items/${itemId}/transitions`) {
      const body = request.postDataJSON();
      versions.push(body.version);
      item = {
        ...item,
        status: body.status,
        version: item.version + 1,
        allowed_transitions:
          body.status === "IN_PROGRESS"
            ? ["BLOCKED", "RESOLVED"]
            : ["IN_PROGRESS"],
      };
      return json(item);
    }
    if (path === `/work-items/${itemId}/assignments`) {
      const body = request.postDataJSON();
      versions.push(body.version);
      item = {
        ...item,
        assignments: [{ user_id: body.user_id, role: body.role }],
        owner_id: body.role === "OWNER" ? body.user_id : null,
        version: item.version + 1,
      };
      return json(item);
    }
    if (
      path === `/work-items/${itemId}/assignments/${userId}` &&
      method === "DELETE"
    ) {
      versions.push(request.postDataJSON().version);
      item = {
        ...item,
        assignments: [],
        owner_id: null,
        version: item.version + 1,
      };
      return json(item);
    }
    if (path === `/work-items/${itemId}/bookmark`) {
      if (method === "PUT") bookmarked = true;
      if (method === "DELETE") {
        bookmarked = false;
        return route.fulfill({ status: 204 });
      }
      return json({ bookmarked });
    }
    if (path === `/work-items/${itemId}/comments`) {
      if (method === "POST") {
        const comment = {
          id: String(comments.length + 1),
          author_id: userId,
          author_name: "Test Operator",
          body: request.postDataJSON().body,
          created_at: new Date().toISOString(),
        };
        comments.unshift(comment);
        return json(comment, 201);
      }
      return json({
        items: comments,
        total: comments.length,
        page: 1,
        page_size: 20,
      });
    }
    if (path === `/work-items/${itemId}/summary`)
      return json({
        summary:
          "The settlement batch needs investigation. " +
          "The team is reviewing the available issue details and checking the ledger for the next action. ".repeat(
            8,
          ),
        model: "test-model",
        min_words: 100,
        max_words: 150,
        context_note: "Based on issue details and recent comments.",
      });
    if (path === `/work-items/${itemId}/activity`)
      return json({
        items: [
          {
            id: "event-1",
            event_type: "CREATED",
            actor_id: userId,
            new_values: { title: item.title },
            old_values: null,
            details: null,
            created_at: item.created_at,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      });
    if (path === `/approvals/${approvalId}/decision`) {
      decisions++;
      return json({ id: approvalId, status: "APPROVED", version: 2 });
    }
    if (path === "/approvals")
      return json({
        items: [
          {
            id: approvalId,
            work_item_id: itemId,
            requester_id: "another-user",
            requester_name: "Test Requester",
            work_item_title: item.title,
            team_id: teamId,
            can_decide: true,
            approver_id: null,
            type: "PAYMENT",
            reason: "Verify refund",
            status: "PENDING",
            version: 1,
            requested_at: item.created_at,
            decided_at: null,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      });
    return json(
      { detail: { code: "not_found", message: "Unexpected test endpoint" } },
      404,
    );
  });
  return {
    patches,
    creates,
    createKeys,
    listQueries,
    versions,
    expire: () => {
      expired = true;
    },
    get decisions() {
      return decisions;
    },
  };
}
async function signIn(page: Page) {
  await page.goto("/work");
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email", { exact: true }).fill("operator@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your attention" }),
  ).toBeVisible();
}

test("protects routes, logs in, navigates, and clears the session on logout", async ({
  page,
}) => {
  await mockApi(page);
  await signIn(page);
  await page.getByRole("link", { name: "All Work", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "All work", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "All work", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("relay_access_token")),
  ).toBeNull();
});
test("sends URL filters and search to the server and creates a work item once", async ({
  page,
}) => {
  const state = await mockApi(page);
  await signIn(page);
  await page.getByRole("link", { name: "All Work", exact: true }).click();
  await page.getByLabel("Search work", { exact: true }).fill("ledger");
  await page.getByLabel("Search work", { exact: true }).press("Enter");
  await page.getByLabel("All Statuses").selectOption("BLOCKED");
  await expect
    .poll(() =>
      state.listQueries.some(
        (q) => q.get("search") === "ledger" && q.get("status") === "BLOCKED",
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "New Work Item", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Investigate settlement");
  await dialog.getByLabel("Select team").selectOption(teamId);
  await dialog
    .getByRole("button", { name: "Create Work Item", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigate settlement", exact: true }),
  ).toBeVisible();
  expect(state.creates).toHaveLength(1);
  expect(state.creates[0].team_id).toBe(teamId);
  expect(state.createKeys[0]).toBeTruthy();
});
test("preserves edits on 409 and waits for explicit reconciliation and resubmission", async ({
  page,
}) => {
  const state = await mockApi(page, { conflict: true });
  await signIn(page);
  await page.goto(`/work/${itemId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("My preserved edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Another user changed this item.")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "My preserved edit",
  );
  expect(state.patches).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Review complete — use latest version" })
    .click();
  expect(state.patches).toHaveLength(1);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "My preserved edit", exact: true }),
  ).toBeVisible();
  expect(state.patches.map((p) => p.version)).toEqual([1, 2]);
});
test("confirms approval decisions and hides unauthorized mutations", async ({
  page,
}) => {
  const state = await mockApi(page);
  await signIn(page);
  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await page.getByRole("button", { name: /Verify refund/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve Request" }).click();
  await expect.poll(() => state.decisions).toBe(1);
});
test("read-only users cannot access mutation controls; permission errors stay inside the shell", async ({
  page,
}) => {
  await mockApi(page, { readonly: true, itemError: 403 });
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "New Work Item", exact: true }),
  ).toHaveCount(0);
  await page.goto(`/work/${itemId}`);
  await expect(page.getByRole("alert")).toContainText(
    "You do not have permission",
  );
  await expect(
    page.getByRole("link", { name: "Attention", exact: true }),
  ).toBeVisible();
});
test("mobile routes and the creation dialog fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await signIn(page);
  await page.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New Work Item", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("uses authoritative versions for transitions, assignment, and removal", async ({
  page,
}) => {
  const state = await mockApi(page);
  await signIn(page);
  await page.goto(`/work/${itemId}`);
  await page.getByRole("button", { name: "In Progress", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resolved", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Select member").selectOption(userId);
  await page
    .getByLabel("Assignment role", { exact: true })
    .selectOption("OWNER");
  await page
    .getByRole("button", { name: "Add assignment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Test Operator" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove Test Operator" }).click();
  await expect(page.getByText("No assignments yet.")).toBeVisible();
  expect(state.versions).toEqual([1, 2, 3]);
});
test("expires invalid sessions and hides edit controls for read-only users", async ({
  page,
}) => {
  const state = await mockApi(page, { readonly: true });
  await signIn(page);
  await page.goto(`/work/${itemId}`);
  await expect(
    page.getByRole("heading", { name: "Payment reconciliation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "In Progress", exact: true }),
  ).toHaveCount(0);
  state.expire();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("relay_access_token")),
  ).toBeNull();
});
test("captures implemented screens for comparison with Stitch", async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await signIn(page);
  await expect(
    page.getByRole("link", { name: /Payment reconciliation/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("attention.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "All Work", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Payment reconciliation/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("all-work.png"),
    fullPage: true,
  });
  await page.goto(`/work/${itemId}`);
  await expect(
    page.getByRole("heading", { name: "Payment reconciliation" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("detail.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await page.getByRole("button", { name: /Verify refund/ }).click();
  await expect(
    page.getByRole("button", { name: "Approve Request" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("approvals.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("teams.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "New Work Item", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("create-modal.png"),
    fullPage: true,
  });
});

test("bookmarks persist, comments render safely, summaries load and status action is prominent", async ({
  page,
}) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/work/${itemId}`);
  const statusBar = page.getByRole("region", { name: "Change issue status" });
  await expect(
    statusBar.getByRole("heading", { name: "Change status" }),
  ).toBeVisible();
  await expect(
    statusBar.getByRole("button", { name: "In Progress" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Bookmark issue", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bookmarked", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Bookmarked", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Add a comment")
    .fill("Investigating <script>window.bad=true</script>");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.locator(".issue-comment")).toHaveCount(1);
  await expect(page.locator(".issue-comment")).toContainText(
    "Investigating <script>window.bad=true</script>",
  );
  expect(
    await page.evaluate(() => (window as Window & { bad?: boolean }).bad),
  ).toBeUndefined();
  await expect(page.getByLabel("Add a comment")).toHaveValue("");
  await page
    .getByRole("button", { name: "Summarize issue", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Issue summary" }),
  ).toContainText("The settlement batch needs investigation.");
  const preview = page.locator(".summary-paragraph");
  await expect(preview).toHaveCount(1);
  await expect(
    preview.locator("h1, h2, h3, ul, ol, li, table, pre, code, strong, em"),
  ).toHaveCount(0);
  expect(
    (await preview.innerText()).split(/\s+/).length,
  ).toBeGreaterThanOrEqual(100);
  expect((await preview.innerText()).split(/\s+/).length).toBeLessThanOrEqual(
    150,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    statusBar.getByRole("button", { name: "In Progress" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/issue-collaboration-mobile.png",
    fullPage: true,
  });
  await statusBar.getByRole("button", { name: "In Progress" }).click();
  await expect(statusBar).toContainText("Currently: In Progress");
  await page.getByRole("button", { name: "Bookmarked", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bookmark issue", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("link", { name: "All Work", exact: true }).click();
  await page.getByLabel("All work · saved or unsaved").selectOption("true");
  await expect(page).toHaveURL(/bookmarked=true/);
});

test("comment failures preserve drafts and Groq setup errors are visible", async ({
  page,
}) => {
  await mockApi(page);
  await page.route(`**/work-items/${itemId}/comments`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 503,
      json: { detail: { code: "unavailable", message: "Please try again" } },
    });
  });
  await page.route(`**/work-items/${itemId}/summary`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        detail: {
          code: "summary_not_configured",
          message: "Set GROQ_API_KEY on the backend.",
        },
      },
    }),
  );
  await signIn(page);
  await page.goto(`/work/${itemId}`);
  await page.getByLabel("Add a comment").fill("Keep my draft");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Issue comments" }),
  ).toContainText("Please try again");
  await expect(page.getByLabel("Add a comment")).toHaveValue("Keep my draft");
  await page
    .getByRole("button", { name: "Summarize issue", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Issue summary" }),
  ).toContainText("Set GROQ_API_KEY");
});
