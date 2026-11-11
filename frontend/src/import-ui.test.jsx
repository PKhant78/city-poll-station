import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const upload = (u, text = "x,y\n25.25,50\n74.75,50", name = "stations.csv") =>
  u.upload(
    screen.getByLabelText("Import CSV"),
    new File([text], name, { type: "text/plain" }),
  );
beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  global.fetch = vi.fn((url, options) => {
    if (url === "/api/auth/me") return response({ user: null });
    if (url === "/api/auth/login")
      return response({ user: { email: "import@example.org" } });
    if (url === "/api/plans") return response({ plans: [] });
    const body = JSON.parse(options.body);
    if (url === "/api/query")
      return response({
        station_ids: body.stations.map((s) => s.id),
        distance: 5,
      });
    return response({
      districts: body.stations.map((s) => ({
        station_id: s.id,
        vertices: [
          [0, 0],
          [100, 0],
          [0, 100],
        ],
      })),
    });
  });
});
it("imports a final set with visible districts and marks it unsaved", async () => {
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  await u.click(screen.getByLabelText("Draw districts"));
  await upload(u);
  await screen.findByLabelText("District for Station 1");
  expect(screen.getByLabelText("District for Station 2")).toBeInTheDocument();
  expect(screen.getByLabelText("Draw districts")).toBeChecked();
  expect(screen.getByText("25.25, 50")).toBeInTheDocument();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(
    fetch.mock.calls.some(([url]) => url === "/api/validate-station"),
  ).toBe(false);
});
it("keeps the previous map for invalid files and cancelled replacement, and clears previous query on success", async () => {
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  await upload(u);
  await screen.findByLabelText("District for Station 1");
  await u.type(screen.getByLabelText("Query X"), "20");
  await u.type(screen.getByLabelText("Query Y"), "30");
  await u.click(screen.getByRole("button", { name: "Find nearest stations" }));
  await screen.findByText(/Distance 5/);
  await upload(u, "x,y\n10,10\noops,20");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Invalid coordinates.*row 3/,
  );
  expect(screen.getByLabelText("District for Station 2")).toBeInTheDocument();
  await upload(u, "x,y\n10,10", "bad.txt");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Error uploading file: choose a CSV file.",
  );
  window.confirm.mockReturnValueOnce(false);
  await upload(u, "x,y\n10,10");
  expect(screen.getByLabelText("District for Station 2")).toBeInTheDocument();
  await upload(u, "x,y\n10,10", "GOOD.CSV");
  await waitFor(() =>
    expect(
      screen.queryByLabelText("District for Station 2"),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText(/Distance 5/)).not.toBeInTheDocument();
});
it("preserves the map when backend geometry validation fails", async () => {
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  await upload(u);
  await screen.findByLabelText("District for Station 1");
  fetch.mockImplementationOnce(() =>
    response({ detail: "Geometry unavailable" }, 422),
  );
  await upload(u, "x,y\n10,10");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Geometry unavailable",
  );
  expect(screen.getByLabelText("District for Station 2")).toBeInTheDocument();
});
it("ignores a delayed import across login and disables conflicting edits during import", async () => {
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  let resolve;
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await upload(u);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(screen.getByRole("button", { name: "Add station" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New plan" })).toBeDisabled();
  await u.click(screen.getByRole("button", { name: "Account / Sign in" }));
  await u.type(screen.getByLabelText("Email"), "import@example.org");
  await u.type(screen.getByLabelText("Password"), "long-password");
  await u.click(screen.getByRole("button", { name: "Log in" }));
  await screen.findByText("import@example.org");
  await act(async () =>
    resolve({ ok: true, json: async () => ({ districts: [] }) }),
  );
  expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
  expect(screen.getByText("All changes saved")).toBeInTheDocument();
});
it("rejects files over one MiB before reading", async () => {
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  await upload(u, "x".repeat(1024 * 1024 + 1));
  expect(await screen.findByRole("alert")).toHaveTextContent(/1 MB/);
  expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
});
it("detaches a loaded plan so saving an import creates a new plan, not an overwrite", async () => {
  const existing = {
    id: "saved-plan",
    name: "Existing",
    stations: [],
    show_districts: false,
  };
  const base = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/auth/me")
      return response({ user: { email: "import@example.org" } });
    if (url === "/api/plans" && options.method === "GET")
      return response({ plans: [existing] });
    if (url === "/api/plans" && options.method === "POST")
      return response({
        ...existing,
        id: "new-plan",
        ...JSON.parse(options.body),
      });
    return base(url, options);
  });
  render(<App />);
  const u = userEvent.setup({ applyAccept: false });
  await screen.findByRole("option", { name: "Existing" });
  await u.selectOptions(screen.getByLabelText("Saved plans"), "saved-plan");
  await u.click(screen.getByRole("button", { name: "Load plan" }));
  await screen.findByText("All changes saved");
  await upload(u);
  await screen.findByLabelText("District for Station 1");
  expect(screen.getByLabelText("Plan name")).toHaveValue("");
  expect(screen.getByLabelText("Saved plans")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save as new" })).toBeDisabled();
  await u.type(screen.getByLabelText("Plan name"), "Imported plan");
  await u.click(screen.getByRole("button", { name: "Save plan" }));
  await screen.findByText("All changes saved");
  expect(
    fetch.mock.calls.some(
      ([url, options]) => url === "/api/plans" && options.method === "POST",
    ),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(([url]) => url === "/api/plans/saved-plan"),
  ).toBe(false);
});
