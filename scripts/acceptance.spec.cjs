const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const URL = process.env.APP_URL || "http://127.0.0.1:5180";
const password = "Acceptance-password-2048";
let email;

test.beforeAll(async ({ request }) => {
  email = `acceptance-${randomUUID()}@example.org`;
  const registered = await request.post(`${URL}/api/auth/register`, {
    data: { email, password },
  });
  expect(registered.status()).toBe(201);
  expect((await registered.json()).user.email).toBe(email);
  await request.post(`${URL}/api/auth/logout`, { data: {} });
});
test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await expect(
    page.getByRole("button", { name: "Account / Sign in" }),
  ).toBeVisible();
});
async function add(page, name = "Central", x = "20", y = "30") {
  await page.getByLabel("Station label", { exact: true }).fill(name);
  await page.getByLabel("Station X", { exact: true }).fill(x);
  await page.getByLabel("Station Y", { exact: true }).fill(y);
  await page.getByRole("button", { name: "Add station", exact: true }).click();
}
async function query(page, x, y) {
  await page.getByLabel("Query X", { exact: true }).fill(x);
  await page.getByLabel("Query Y", { exact: true }).fill(y);
  await page.getByRole("button", { name: "Find nearest stations" }).click();
}
async function login(page, loginEmail = email, loginPassword = password) {
  await page.getByRole("button", { name: "Account / Sign in" }).click();
  await page.getByLabel("Email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(loginPassword);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}
async function expectEmpty(page) {
  await expect(
    page.getByText("No stations placed yet.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".station-row")).toHaveCount(0);
  await expect(page.locator("svg circle")).toHaveCount(0);
  await expect(page.locator("polygon")).toHaveCount(0);
  await expect(page.locator(".query-result")).toHaveCount(0);
  await expect(page.getByLabel("Plan name", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Saved plans", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Save as new", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
}

test("01 out-of-bound station produces a visible error and no station", async ({
  page,
}) => {
  await add(page, "Outside", "101", "30");
  await expect(page.getByRole("alert")).toContainText(
    "Coordinates must be between 0 and 100",
  );
  await expect(page.locator(".station-row")).toHaveCount(0);
});
test("02 in-bound station is created on the map with a district", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("District for Central", { exact: true }),
  ).toBeAttached();
  await expect(page.locator(".station-row")).toContainText("20, 30");
});
test("03 coordinate query selects the nearest of multiple stations", async ({
  page,
}) => {
  await add(page, "West", "20", "30");
  await expect(page.getByRole("button", { name: "Remove West" })).toBeVisible();
  await add(page, "East", "80", "30");
  await expect(page.getByRole("button", { name: "Remove East" })).toBeVisible();
  await query(page, "23", "34");
  await expect(page.locator(".query-result")).toContainText("West");
  await expect(page.locator(".query-result")).not.toContainText("East");
  await expect(page.locator(".query-result")).toContainText("Distance 5");
});
for (const [label, x, y] of [
  ["out-of-range", "-1", "30"],
  ["missing X", "", "30"],
  ["missing Y", "20", ""],
]) {
  test(`04 bad query coordinates (${label}) produce a visible error`, async ({
    page,
  }) => {
    await add(page);
    await expect(
      page.getByRole("button", { name: "Remove Central" }),
    ).toBeVisible();
    await query(page, "20", "30");
    await expect(page.locator(".query-result")).toBeVisible();
    await query(page, x, y);
    await expect(page.getByRole("alert")).toContainText(
      "Coordinates must be between 0 and 100",
    );
    await expect(page.locator(".query-result")).toHaveCount(0);
  });
}
test("05 valid query gives a valid exact-location result", async ({ page }) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await query(page, "20", "30");
  await expect(page.locator(".query-result")).toContainText("Central");
  await expect(page.locator(".query-result")).toContainText(
    "Nearest station · Distance 0",
  );
});
test("06 successful logout clears station, geometry, query and saved plan association", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await query(page, "20", "30");
  await expect(page.locator(".query-result")).toBeVisible();
  await page
    .getByLabel("Plan name", { exact: true })
    .fill(`QA plan ${randomUUID()}`);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save as new", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Account / Sign in" }),
  ).toBeVisible();
  await expectEmpty(page);
});
test("07 successful login clears an anonymous working map", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await query(page, "20", "30");
  await expect(page.locator(".query-result")).toBeVisible();
  await page.getByLabel("Plan name", { exact: true }).fill("Anonymous draft");
  await login(page);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expectEmpty(page);
});
test("07b successful registration clears an anonymous working map", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await page
    .getByLabel("Plan name", { exact: true })
    .fill("Registration draft");
  await page.getByRole("button", { name: "Account / Sign in" }).click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const newEmail = `acceptance-${randomUUID()}@example.org`;
  await page.getByLabel("Email", { exact: true }).fill(newEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText(newEmail, { exact: true })).toBeVisible();
  await expectEmpty(page);
});
test("08 removal removes station and derived district and query result", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await query(page, "20", "30");
  await expect(page.locator(".query-result")).toBeVisible();
  await page.getByRole("button", { name: "Remove Central" }).click();
  await expect(page.locator(".station-row")).toHaveCount(0);
  await expect(page.locator("polygon")).toHaveCount(0);
  await expect(page.locator(".query-result")).toHaveCount(0);
});
test("09 wrong password shows generic login error and preserves draft", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await page.getByLabel("Plan name", { exact: true }).fill("Keep my draft");
  await login(page, email, "incorrect-password");
  await expect(page.getByRole("alert")).toHaveText(
    "Invalid email or password.",
  );
  await page.getByRole("button", { name: "Close account dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await expect(page.getByLabel("Plan name", { exact: true })).toHaveValue(
    "Keep my draft",
  );
});
test("10 correct credentials establish a real cookie session", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const me = await page.request.get(`${URL}/api/auth/me`);
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe(email);
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
test("11 malformed email triggers visible native validation and blocks submission", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/login")) requests.push(request);
  });
  await login(page, "not-an-email");
  const input = page.getByLabel("Email", { exact: true });
  await expect(input).toBeFocused();
  expect(await input.evaluate((node) => node.validity.typeMismatch)).toBe(true);
  expect(await input.evaluate((node) => node.validationMessage)).not.toBe("");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(requests).toHaveLength(0);
});
test("11b unknown well-formed email shows Unknown email", async ({
  page,
}) => {
  await login(page, `unknown-${randomUUID()}@example.org`);
  await expect(page.getByRole("alert")).toHaveText("Unknown email.");
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("12 duplicate coordinates produce a visible error without adding a duplicate", async ({
  page,
}) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Remove Central" }),
  ).toBeVisible();
  await add(page, "Duplicate", "20", "30");
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(page.locator(".station-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove Duplicate" }),
  ).toHaveCount(0);
});
