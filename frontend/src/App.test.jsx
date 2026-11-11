import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  global.fetch = vi.fn((url) =>
    url === "/api/auth/me"
      ? response({ detail: "Not logged in" }, 401)
      : response({ districts: [] }),
  );
});
export async function addStation(name = "Central", x = "20", y = "30") {
  const u = userEvent.setup();
  await u.clear(screen.getByLabelText("Station label"));
  await u.clear(screen.getByLabelText("Station X"));
  await u.clear(screen.getByLabelText("Station Y"));
  await u.type(screen.getByLabelText("Station label"), name);
  await u.type(screen.getByLabelText("Station X"), x);
  await u.type(screen.getByLabelText("Station Y"), y);
  await u.click(screen.getByRole("button", { name: "Add station" }));
  await screen.findByRole("button", { name: `Remove ${name}` });
  return u;
}
it("starts empty and validates before adding a coordinate station, then removes it", async () => {
  fetch.mockImplementation((url) =>
    url === "/api/auth/me"
      ? response({}, 401)
      : url === "/api/validate-station"
        ? response({ valid: true })
        : response({ districts: [] }),
  );
  render(<App />);
  expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
  expect(document.querySelector(".station-count")).toHaveTextContent(/^0 stations$/);
  const u = await addStation();
  expect(document.querySelector(".station-count")).toHaveTextContent(/^1 station$/);
  expect(
    await screen.findByRole("button", { name: "Remove Central" }),
  ).toBeInTheDocument();
  expect(
    fetch.mock.calls.find(([url]) => url === "/api/validate-station")[1].body,
  ).toContain('"x":20');
  await u.click(screen.getByRole("button", { name: "Remove Central" }));
  expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
});

it("announces out-of-range coordinates and server validation without adding stations", async () => {
  const u = userEvent.setup();
  render(<App />);
  await u.type(screen.getByLabelText("Station label"), "Outside");
  await u.type(screen.getByLabelText("Station X"), "101");
  await u.type(screen.getByLabelText("Station Y"), "10");
  await u.click(screen.getByRole("button", { name: "Add station" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Coordinates must be between 0 and 100",
  );
  expect(
    fetch.mock.calls.some(([url]) => url === "/api/validate-station"),
  ).toBe(false);
  fetch.mockImplementation((url) =>
    url === "/api/validate-station"
      ? response(
          {
            detail: [
              {
                loc: ["body", "x"],
                msg: "Point is on an existing district boundary",
              },
            ],
          },
          422,
        )
      : response({ districts: [] }),
  );
  await u.clear(screen.getByLabelText("Station X"));
  await u.type(screen.getByLabelText("Station X"), "50");
  await u.click(screen.getByRole("button", { name: "Add station" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Point is on an existing district boundary",
  );
  expect(screen.getByText("No stations placed yet.")).toBeInTheDocument();
});
it("registers an account, saves and loads a named plan, then logs out to a clean map", async () => {
  const saved = {
    id: "plan-1",
    name: "Election day",
    stations: [],
    show_districts: false,
  };
  fetch.mockImplementation((url, options) => {
    if (url === "/api/auth/me") return response({}, 401);
    if (url === "/api/auth/register")
      return response({ user: { id: "u1", email: "planner@example.org" } });
    if (url === "/api/auth/logout") return response({});
    if (url === "/api/plans" && options.method === "GET")
      return response({ plans: [saved] });
    if (url === "/api/plans")
      return response({ ...saved, ...JSON.parse(options.body) });
    return response({ districts: [] });
  });
  const u = userEvent.setup();
  render(<App />);
  await u.click(screen.getByRole("button", { name: "Account / Sign in" }));
  await u.click(screen.getByRole("button", { name: "Create account" }));
  await u.type(screen.getByLabelText("Email"), "planner@example.org");
  await u.type(screen.getByLabelText("Password"), "long-password");
  await u.click(screen.getByRole("button", { name: "Register" }));
  expect(await screen.findByText("planner@example.org")).toBeInTheDocument();
  await u.type(screen.getByLabelText("Plan name"), "Election day");
  await u.click(screen.getByRole("button", { name: "Save plan" }));
  expect(await screen.findByText("All changes saved")).toBeInTheDocument();
  await u.click(screen.getByLabelText("Draw districts"));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  await u.selectOptions(screen.getByLabelText("Saved plans"), "plan-1");
  await u.click(screen.getByRole("button", { name: "Load plan" }));
  expect(await screen.findByText("All changes saved")).toBeInTheDocument();
  expect(screen.getByLabelText("Draw districts")).toBeChecked();
  await u.click(screen.getByRole("button", { name: "Log out" }));
  expect(
    await screen.findByRole("button", { name: "Account / Sign in" }),
  ).toBeInTheDocument();
  expect(screen.getByText("All changes saved")).toBeInTheDocument();
  expect(screen.getByLabelText("Plan name")).toHaveValue("");
});
it("renders computed districts and reports every nearest-station tie", async () => {
  fetch.mockImplementation((url, options) => {
    if (url === "/api/auth/me") return response({}, 401);
    if (url === "/api/validate-station") return response({ valid: true });
    const data = JSON.parse(options.body);
    if (url === "/api/query")
      return response({
        station_ids: data.stations.map((s) => s.id),
        distance: 10,
      });
    return response({
      districts: data.stations.map((s) => ({
        station_id: s.id,
        vertices: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
      })),
    });
  });
  render(<App />);
  const u = await addStation("West", "10", "10");
  await addStation("East", "30", "10");
  expect(await screen.findByLabelText("District for West")).toBeInTheDocument();
  await u.click(screen.getByLabelText("Draw districts"));
  expect(screen.queryByLabelText("District for West")).not.toBeInTheDocument();
  await u.type(screen.getByLabelText("Query X"), "20");
  await u.type(screen.getByLabelText("Query Y"), "10");
  await u.click(screen.getByRole("button", { name: "Find nearest stations" }));
  expect(await screen.findByText("West · East")).toBeInTheDocument();
  expect(screen.getByText(/Tie: 2 stations/)).toBeInTheDocument();
});

it("explains that a nearest-station query needs a station", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText("Query X"), "50");
  await user.type(screen.getByLabelText("Query Y"), "50");
  await user.click(
    screen.getByRole("button", { name: "Find nearest stations" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Add at least one station before querying.",
  );
  expect(fetch.mock.calls.some(([url]) => url === "/api/query")).toBe(false);
});
