import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import App from "./App";
const response = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  global.fetch = vi.fn((url) =>
    url === "/api/auth/me"
      ? response({ user: null })
      : response({ districts: [] }),
  );
});
it("has a working styled application entry and map export controls", () => {
  expect(existsSync("index.html")).toBe(true);
  expect(readFileSync("src/main.jsx", "utf8")).toContain("createRoot");
  render(<App />);
  expect(
    screen.getByRole("button", { name: "Export PNG" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Export CSV" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New plan" })).toBeInTheDocument();
});
it("validates query coordinates with a live error instead of browser-only validation", async () => {
  render(<App />);
  const u = userEvent.setup();
  await u.type(screen.getByLabelText("Query X"), "101");
  await u.type(screen.getByLabelText("Query Y"), "20");
  await u.click(screen.getByRole("button", { name: "Find nearest stations" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Coordinates must be between 0 and 100",
  );
  expect(fetch.mock.calls.some(([url]) => url === "/api/query")).toBe(false);
});
it("ignores a delayed nearest-station response after the map is changed", async () => {
  let resolveQuery;
  fetch.mockImplementation((url) =>
    url === "/api/auth/me"
      ? response({ user: null })
      : url === "/api/query"
        ? new Promise((r) => {
            resolveQuery = r;
          })
        : response({ districts: [] }),
  );
  render(<App />);
  const u = userEvent.setup();
  await u.type(screen.getByLabelText("Station label"), "North");
  await u.type(screen.getByLabelText("Station X"), "20");
  await u.type(screen.getByLabelText("Station Y"), "20");
  await u.click(screen.getByRole("button", { name: "Add station" }));
  await screen.findByRole("button", { name: "Remove North" });
  await u.type(screen.getByLabelText("Query X"), "10");
  await u.type(screen.getByLabelText("Query Y"), "10");
  await u.click(screen.getByRole("button", { name: "Find nearest stations" }));
  await u.click(screen.getByRole("button", { name: "Remove North" }));
  await act(async () => {
    resolveQuery({
      ok: true,
      json: async () => ({ station_ids: [], distance: 99 }),
    });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(screen.queryByText(/Distance 99/)).not.toBeInTheDocument();
});
it("confirms before replacing unsaved work and supports cancellation", async () => {
  const plan = {
    id: "p",
    name: "Saved map",
    stations: [],
    show_districts: true,
  };
  fetch.mockImplementation((url) =>
    url === "/api/auth/me"
      ? response({ user: { email: "a@b.co" } })
      : url === "/api/plans"
        ? response({ plans: [plan] })
        : response({ districts: [] }),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<App />);
  const u = userEvent.setup();
  await screen.findByRole("option", { name: "Saved map" });
  await u.type(screen.getByLabelText("Plan name"), "My draft");
  await u.selectOptions(screen.getByLabelText("Saved plans"), "p");
  await u.click(screen.getByRole("button", { name: "Load plan" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("Plan name")).toHaveValue("My draft");
  confirm.mockRestore();
});
