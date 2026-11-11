import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";

const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const account = { email: "reset@example.org" };
async function authenticate(u, mode) {
  if (mode === "logout") {
    await u.click(screen.getByRole("button", { name: "Log out" }));
    return;
  }
  await u.click(screen.getByRole("button", { name: "Account / Sign in" }));
  if (mode === "register")
    await u.click(screen.getByRole("button", { name: "Create account" }));
  await u.type(screen.getByLabelText("Email"), account.email);
  await u.type(screen.getByLabelText("Password"), "long-password");
  await u.click(
    screen.getByRole("button", {
      name: mode === "register" ? "Register" : "Log in",
    }),
  );
}
function mockAPI(
  mode,
  {
    fail = false,
    delayAdd = false,
    delayGeometry = false,
    delayQuery = false,
  } = {},
) {
  const pending = [];
  global.fetch = vi.fn((url, options) => {
    if (url === "/api/auth/me")
      return response({ user: mode === "logout" ? account : null });
    if (
      ["/api/auth/login", "/api/auth/register", "/api/auth/logout"].includes(
        url,
      )
    )
      return fail
        ? response({ detail: "Invalid credentials" }, 401)
        : response({ user: account });
    if (url === "/api/plans") return response({ plans: [] });
    const body = JSON.parse(options.body);
    if (url === "/api/validate-station" && delayAdd)
      return new Promise((resolve) =>
        pending.push(() =>
          resolve({ ok: true, json: async () => ({ valid: true }) }),
        ),
      );
    if (url === "/api/query") {
      const data = { station_ids: body.stations.map((s) => s.id), distance: 5 };
      if (delayQuery)
        return new Promise((resolve) =>
          pending.push(() => resolve({ ok: true, json: async () => data })),
        );
      return response(data);
    }
    if (url === "/api/geometry") {
      const data = {
        districts: body.stations.map((s) => ({
          station_id: s.id,
          vertices: [
            [0, 0],
            [100, 0],
            [0, 100],
          ],
        })),
      };
      if (delayGeometry && body.stations.length)
        return new Promise((resolve) =>
          pending.push(() => resolve({ ok: true, json: async () => data })),
        );
      return response(data);
    }
    return response({ valid: true });
  });
  return async () =>
    act(async () => {
      pending.forEach((finish) => finish());
    });
}
async function draft(u, wait = true) {
  await u.type(screen.getByLabelText("Plan name"), "Private draft");
  await u.type(screen.getByLabelText("Station label"), "Private station");
  await u.type(screen.getByLabelText("Station X"), "20");
  await u.type(screen.getByLabelText("Station Y"), "30");
  await u.click(screen.getByRole("button", { name: "Add station" }));
  if (wait)
    await screen.findByRole("button", { name: "Remove Private station" });
}
for (const mode of ["login", "register", "logout"]) {
  it(`clears the working map, result, name and dirty snapshot after successful ${mode}`, async () => {
    mockAPI(mode);
    render(<App />);
    const u = userEvent.setup();
    if (mode === "logout") await screen.findByText(account.email);
    await draft(u);
    await screen.findByLabelText("District for Private station");
    await u.type(screen.getByLabelText("Query X"), "23");
    await u.type(screen.getByLabelText("Query Y"), "34");
    await u.click(
      screen.getByRole("button", { name: "Find nearest stations" }),
    );
    await screen.findByText(/Distance 5/);
    await authenticate(u, mode);
    await screen.findByText("No stations placed yet.");
    expect(screen.queryByText(/Distance 5/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("District for Private station"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Plan name")).toHaveValue("");
    expect(screen.getByLabelText("Saved plans")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save as new" })).toBeDisabled();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });
  it(`preserves work after failed ${mode}`, async () => {
    mockAPI(mode, { fail: true });
    render(<App />);
    const u = userEvent.setup();
    if (mode === "logout") await screen.findByText(account.email);
    await draft(u);
    await authenticate(u, mode);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials",
    );
    expect(
      screen.getByRole("button", { name: "Remove Private station" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Plan name")).toHaveValue("Private draft");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
  for (const delayed of ["delayAdd", "delayGeometry", "delayQuery"]) {
    it(`does not restore stale ${delayed} after ${mode}`, async () => {
      const finish = mockAPI(mode, { [delayed]: true });
      render(<App />);
      const u = userEvent.setup();
      if (mode === "logout") await screen.findByText(account.email);
      await draft(u, delayed !== "delayAdd");
      if (delayed === "delayQuery") {
        await u.type(screen.getByLabelText("Query X"), "23");
        await u.type(screen.getByLabelText("Query Y"), "34");
        await u.click(
          screen.getByRole("button", { name: "Find nearest stations" }),
        );
      }
      await authenticate(u, mode);
      await finish();
      expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove Private station" }),
      ).not.toBeInTheDocument();
      expect(document.querySelectorAll("polygon")).toHaveLength(0);
      expect(document.querySelectorAll("circle")).toHaveLength(0);
      expect(screen.queryByText(/Distance 5/)).not.toBeInTheDocument();
    });
  }
}
