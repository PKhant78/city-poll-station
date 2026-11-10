import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";
const response = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data });
it("keeps a newly saved plan when an earlier plan-list request finishes late", async () => {
  let resolveList;
  global.fetch = vi.fn((url, options) =>
    url === "/api/auth/me"
      ? response({ user: { email: "planner@example.org" } })
      : url === "/api/plans" && options.method === "GET"
        ? new Promise((r) => {
            resolveList = r;
          })
        : url === "/api/plans"
          ? response({ id: "new", ...JSON.parse(options.body) })
          : response({ districts: [] }),
  );
  render(<App />);
  const u = userEvent.setup();
  await screen.findByText("planner@example.org");
  await u.type(screen.getByLabelText("Plan name"), "New map");
  await u.click(screen.getByRole("button", { name: "Save plan", exact: true }));
  await screen.findByRole("option", { name: "New map" });
  await act(async () => {
    resolveList({ ok: true, json: async () => ({ plans: [] }) });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(screen.getByRole("option", { name: "New map" })).toBeInTheDocument();
});
