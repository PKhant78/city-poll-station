import React, { useEffect, useRef, useState } from "react";
import { download, exportPNG, stationsCSV } from "./exports";
import { parseStationsCSV } from "./imports";
import { useMapViewport } from "./useMapViewport";
import { useMapFit } from "./useMapFit";
export async function api(path, body, method = "POST") {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map(
                (e) =>
                  `${(e.loc || []).filter((x) => x !== "body").join(" ")}: ${e.msg}`,
              )
              .join("; ")
          : "The request could not be completed. Please try again.",
    );
    err.status = res.status;
    throw err;
  }
  return data;
}
const snapshot = (stations, show, name) =>
  JSON.stringify({ stations, show, name });
function coordinates(f) {
  const x = Number(f.get("x")),
    y = Number(f.get("y"));
  if (
    !String(f.get("x") ?? "").trim() ||
    !String(f.get("y") ?? "").trim() ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > 100 ||
    y < 0 ||
    y > 100
  )
    throw new Error("Coordinates must be between 0 and 100.");
  return { x, y };
}
function AccountDialog({
  register,
  setRegister,
  close,
  authenticate,
  busy,
  error,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="account-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) close();
        if (e.key === "Tab") {
          const items = [
            ...ref.current.querySelectorAll("button:not(:disabled),input"),
          ];
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="dialog-top">
        <span className="eyebrow">The Polling Atlas / Account</span>
        <button
          onClick={close}
          disabled={busy}
          aria-label="Close account dialog"
        >
          Close
        </button>
      </div>
      <h2 id="account-title">
        {register ? "Create your account" : "Welcome back"}
      </h2>
      <p>
        Keep your city plans together. Signing in starts a fresh working map.
      </p>
      <div className="button-row auth-tabs">
        <button
          aria-pressed={!register}
          onClick={() => setRegister(false)}
          disabled={busy}
        >
          Sign in
        </button>
        <button
          aria-pressed={register}
          onClick={() => setRegister(true)}
          disabled={busy}
        >
          Create account
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={authenticate}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength="8"
          />
        </label>
        <p className="help">Use at least 8 characters.</p>
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : register ? "Register" : "Log in"}
        </button>
      </form>
    </dialog>
  );
}
export default function App() {
  const [stations, setStations] = useState([]),
    [error, setError] = useState(""),
    [queryError, setQueryError] = useState(""),
    [queryCoordinates, setQueryCoordinates] = useState({ x: "", y: "" }),
    [selectedStationId, setSelectedStationId] = useState(null),
    [stationDraft, setStationDraft] = useState({ name: "", x: "", y: "" }),
    [adding, setAdding] = useState(false),
    [districts, setDistricts] = useState([]),
    [show, setShow] = useState(true),
    [result, setResult] = useState(null),
    [querying, setQuerying] = useState(false);
  const [user, setUser] = useState(null),
    [authOpen, setAuthOpen] = useState(false),
    [register, setRegister] = useState(false),
    [authBusy, setAuthBusy] = useState(false);
  const [plans, setPlans] = useState([]),
    [name, setName] = useState(""),
    [planId, setPlanId] = useState(null),
    [selection, setSelection] = useState(""),
    [planBusy, setPlanBusy] = useState(false),
    [saved, setSaved] = useState(null),
    [status, setStatus] = useState(""),
    [exporting, setExporting] = useState(false),
    [importing, setImporting] = useState(false);
  const authEpoch = useRef(0),
    revision = useRef(0),
    queryEpoch = useRef(0),
    mapFrameRef = useRef(null),
    svgRef = useRef(null),
    importedGeometry = useRef(null);
  const mapView = useMapViewport(svgRef);
  const mapFitStyle = useMapFit(mapFrameRef);
  const dirty = saved !== snapshot(stations, show, name);
  const stationBusy = adding || planBusy || importing || authBusy;
  function clearStationSelection() {
    setSelectedStationId(null);
    setStationDraft({ name: "", x: "", y: "" });
  }
  function selectStation(station) {
    if (stationBusy) return;
    setSelectedStationId(station.id);
    setStationDraft({
      name: station.name,
      x: String(station.x),
      y: String(station.y),
    });
    setError("");
    setStatus(
      `Selected ${station.name}. Edit its fields or delete the station.`,
    );
  }
  function removeStation(id) {
    if (stationBusy) return;
    changeStations(stations.filter((station) => station.id !== id));
    setError("");
    setStatus("Station deleted. Districts updated.");
  }
  function changeStations(next) {
    clearStationSelection();
    mapView.reset();
    revision.current++;
    queryEpoch.current++;
    setStations(next);
    setResult(null);
    setQueryError("");
    setDistricts([]);
    setQuerying(false);
  }
  function resetWorkingMap() {
    changeStations([]);
    setAdding(false);
    setPlans([]);
    setName("");
    setPlanId(null);
    setSelection("");
    setShow(true);
    setSaved(snapshot([], true, ""));
  }
  useEffect(() => {
    let active = true;
    const epoch = authEpoch.current;
    api("/auth/me", undefined, "GET")
      .then((d) => {
        if (active && epoch === authEpoch.current) setUser(d.user);
      })
      .catch((e) => {
        if (active && e.status !== 401) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api("/plans", undefined, "GET")
      .then((d) => {
        if (active)
          setPlans((current) => [
            ...current,
            ...d.plans.filter(
              (p) => !current.some((savedPlan) => savedPlan.id === p.id),
            ),
          ]);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user]);
  useEffect(() => {
    let active = true;
    const rev = revision.current;
    if (importedGeometry.current === stations) return;
    api("/geometry", { stations })
      .then((d) => {
        if (active && rev === revision.current) setDistricts(d.districts);
      })
      .catch((e) => {
        if (active && rev === revision.current) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stations]);
  async function importCSV(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // Allow retrying the same file after any outcome.
    if (!file || importing || adding || planBusy || authBusy) return;
    const rev = revision.current,
      epoch = authEpoch.current;
    const current = () =>
      rev === revision.current && epoch === authEpoch.current;
    setImporting(true);
    setError("");
    setStatus("");
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("choose a CSV file.");
      if (file.size > 1024 * 1024)
        throw new Error("CSV files must be 1 MB or smaller.");
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(new Error("The CSV file could not be read."));
        reader.readAsText(file);
      });
      if (!current()) return;
      const next = parseStationsCSV(text);
      const data = await api("/geometry", { stations: next });
      if (!current() || !canDiscard()) return;
      importedGeometry.current = next;
      changeStations(next);
      setDistricts(data.districts);
      setShow(true);
      setName("");
      setPlanId(null);
      setSelection("");
      setSaved(null);
      setStatus(`Imported ${next.length} stations. Districts updated.`);
    } catch (error) {
      if (current()) setError(`Error uploading file: ${error.message}`);
    } finally {
      setImporting(false);
    }
  }
  async function saveStation(e) {
    e.preventDefault();
    if (stationBusy) return;
    const f = new FormData(e.currentTarget),
      rev = revision.current;
    setAdding(true);
    setError("");
    try {
      const { x, y } = coordinates(f),
        label = String(f.get("name")).trim();
      if (!label) throw new Error("Enter a station label.");
      const edited = stations.find(
        (station) => station.id === selectedStationId,
      );
      if (!edited && stations.length >= 200)
        throw new Error("The plan can contain at most 200 stations.");
      if (!edited || edited.x !== x || edited.y !== y) {
        await api("/validate-station", {
          stations: stations.filter((station) => station.id !== edited?.id),
          x,
          y,
        });
      }
      if (rev !== revision.current) return;
      changeStations(
        edited
          ? stations.map((station) =>
              station.id === edited.id
                ? { ...station, name: label, x, y }
                : station,
            )
          : [...stations, { id: crypto.randomUUID(), name: label, x, y }],
      );

      setStatus(
        edited
          ? "Station updated. Districts updated."
          : "Station added. Districts updated.",
      );
    } catch (e) {
      if (rev === revision.current) setError(e.message);
    } finally {
      setAdding(false);
    }
  }
  async function query(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      epoch = ++queryEpoch.current,
      rev = revision.current;
    setError("");
    setQueryError("");
    setResult(null);
    try {
      const point = coordinates(f);
      if (!stations.length)
        throw new Error("Add at least one station before querying.");
      setQuerying(true);
      const d = await api("/query", { stations, ...point });
      if (epoch === queryEpoch.current && rev === revision.current)
        setResult({ ...d, point });
    } catch (e) {
      if (epoch === queryEpoch.current) setQueryError(e.message);
    } finally {
      if (epoch === queryEpoch.current) setQuerying(false);
    }
  }
  function resetQuery() {
    queryEpoch.current++;
    setQueryCoordinates({ x: "", y: "" });
    setResult(null);
    setQueryError("");
    setQuerying(false);
    setStatus("Query reset.");
  }
  async function authenticate(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setAuthBusy(true);
    setError("");
    authEpoch.current++;
    try {
      const d = await api(register ? "/auth/register" : "/auth/login", {
        email: f.get("email"),
        password: f.get("password"),
      });
      setUser(d.user);
      resetWorkingMap();
      setAuthOpen(false);
      setStatus("Signed in. Your working map has been reset.");
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function logout() {
    if (planBusy) return;
    setAuthBusy(true);
    setError("");
    authEpoch.current++;
    try {
      await api("/auth/logout", {});
      setUser(null);
      resetWorkingMap();
      setStatus("Signed out. Your working map has been reset.");
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function save(asNew = false) {
    if (!user) {
      setError("");
      setAuthOpen(true);
      return;
    }
    if (!name.trim()) {
      setError("Enter a plan name before saving.");
      return;
    }
    const id = asNew ? null : planId;
    if (
      plans.some(
        (plan) =>
          plan.id !== id &&
          plan.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setStatus("");
      setError(
        "A plan with this name already exists. Choose a different name.",
      );
      return;
    }
    setPlanBusy(true);
    setError("");
    setStatus("");
    const before = snapshot(stations, show, name),
      epoch = authEpoch.current;
    try {
      const d = await api(
        id ? `/plans/${id}` : "/plans",
        { name: name.trim(), stations, show_districts: show },
        id ? "PUT" : "POST",
      );
      if (epoch !== authEpoch.current) return;
      setPlanId(d.id);
      setSelection(d.id);
      setSaved(before);
      setPlans((v) => [d, ...v.filter((p) => p.id !== d.id)]);
      setStatus("Plan saved.");
    } catch (e) {
      if (epoch === authEpoch.current) setError(e.message);
    } finally {
      setPlanBusy(false);
    }
  }
  function canDiscard() {
    return (
      !dirty ||
      (!stations.length && !name) ||
      window.confirm("Discard unsaved changes to this plan?")
    );
  }
  function load() {
    const p = plans.find((p) => p.id === selection);
    if (!p || !canDiscard()) return;
    changeStations(p.stations);
    setShow(p.show_districts);
    setName(p.name);
    setPlanId(p.id);
    setSaved(snapshot(p.stations, p.show_districts, p.name));
    setError("");
    setStatus("Plan loaded.");
  }
  function newPlan() {
    if (!canDiscard()) return;
    changeStations([]);
    setName("");
    setPlanId(null);
    setSelection("");
    setShow(true);
    setSaved(null);
    setError("");
    setStatus("New plan ready.");
  }
  async function png() {
    setExporting(true);
    setError("");
    try {
      await exportPNG(svgRef.current);
      setStatus("Map exported as PNG.");
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10),
    nearest = result?.station_ids || [];
  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">The Board of Elections of City A</p>
          <h1>
            The Polling Atlas<span className="title-period">.</span>
          </h1>
        </div>
        <div className="account">
          {user ? (
            <>
              <span className="account-email">{user.email}</span>
              <button onClick={logout} disabled={authBusy || planBusy}>
                Log out
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setError("");
                setAuthOpen(true);
              }}
            >
              Account / Sign in
            </button>
          )}
        </div>
      </header>
      <div className="edition-bar">
        <span>Voting Districts Planner</span>
      </div>
      {(error || queryError) && !authOpen && (
        <p role="alert" className="error">
          {error || queryError}
        </p>
      )}
      <p role="status" className="status">
        {status}
      </p>
      <div className="workspace">
        <section className="map-panel" aria-labelledby="map-heading">
          <div className="section-heading">
            <div>
              <h2 id="map-heading">Map of City A</h2>
            </div>
            <span className="station-count">
              {stations.length} {stations.length === 1 ? "station" : "stations"}
            </span>
          </div>
          <div className="map-frame" ref={mapFrameRef} style={mapFitStyle}>
            <svg
              ref={svgRef}
              {...mapView.svgProps}
              role="img"
              aria-label="City planning map"
            >
              <rect x="-8" y="-8" width="116" height="116" fill="#f5f2e9" />
              <rect width="100" height="100" fill="#fffefa" />
              {ticks.map((t) => (
                <g key={t}>
                  <path
                    d={`M ${t} 0 V 100 M 0 ${100 - t} H 100`}
                    fill="none"
                    stroke="#dad7ce"
                    strokeWidth="0.16"
                  />
                  <text
                    x={t}
                    y="105"
                    textAnchor="middle"
                    fontFamily="monospace"
                    fontSize="1.9"
                    fill="#655f53"
                  >
                    {t}
                  </text>
                  <text
                    x="-3"
                    y={100 - t + 0.65}
                    textAnchor="middle"
                    fontFamily="monospace"
                    fontSize="1.9"
                    fill="#655f53"
                  >
                    {t}
                  </text>
                </g>
              ))}
              {show &&
                districts.map((d) => (
                  <polygon
                    role="img"
                    aria-label={`District for ${stations.find((s) => s.id === d.station_id)?.name}`}
                    key={d.station_id}
                    points={d.vertices
                      .map(([x, y]) => `${x},${100 - y}`)
                      .join(" ")}
                    fill={nearest.includes(d.station_id) ? "#e5dfcf" : "none"}
                    stroke="#181816"
                    strokeWidth="0.34"
                  />
                ))}
              <rect
                width="100"
                height="100"
                fill="none"
                stroke="#181816"
                strokeWidth=".45"
              />
              {stations.map((s) => (
                <g
                  key={s.id}
                  className="station-marker"
                  role="button"
                  aria-label={`Select station ${s.name}`}
                  aria-pressed={selectedStationId === s.id}
                  aria-disabled={stationBusy}
                  tabIndex={stationBusy ? -1 : 0}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => selectStation(s)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      selectStation(s);
                    }
                  }}
                >
                  <circle cx={s.x} cy={100 - s.y} r="2.8" fill="transparent" />
                  {selectedStationId === s.id && (
                    <circle
                      cx={s.x}
                      cy={100 - s.y}
                      r="2"
                      fill="none"
                      stroke="#181816"
                      strokeWidth=".3"
                    />
                  )}
                  <circle
                    cx={s.x}
                    cy={100 - s.y}
                    r={nearest.includes(s.id) ? 1.3 : 0.85}
                    fill="#181816"
                    stroke="#fffefa"
                    strokeWidth=".25"
                  />
                  <text
                    x={Math.min(s.x + 1.6, 98)}
                    y={Math.max(100 - s.y - 1.6, 2.5)}
                    textAnchor={s.x > 85 ? "end" : "start"}
                    fontFamily="Arial,sans-serif"
                    fontSize="2.1"
                    fill="#181816"
                    paintOrder="stroke"
                    stroke="#fffefa"
                    strokeWidth=".6"
                  >
                    {s.name}
                  </text>
                </g>
              ))}
              {result && (
                <g
                  role="img"
                  aria-label="Query location"
                  stroke="#181816"
                  strokeWidth=".4"
                >
                  <path
                    d={`M ${result.point.x - 1.2} ${100 - result.point.y} h 2.4 M ${result.point.x} ${98.8 - result.point.y} v 2.4`}
                  />
                </g>
              )}
              <text
                x="100"
                y="-3"
                fontFamily="monospace"
                fontSize="2"
                textAnchor="end"
                fill="#655f53"
              >
                N ↑
              </text>
            </svg>
            {mapView.showCoordinates && mapView.hasPointer && (
              <output
                ref={mapView.readoutRef}
                className="cursor-coordinates"
                aria-label="Cursor coordinates"
                aria-live="off"
              >
                {mapView.readout}
              </output>
            )}
            {!stations.length && (
              <div className="map-empty" aria-hidden="true">
                <span className="empty-cross">+</span>
                <h3>A city, waiting to take shape.</h3>
                <p>Add your first station to draw its district.</p>
              </div>
            )}
          </div>
          <div className="map-toolbar">
            <div className="button-row map-display-controls">
              <button
                aria-pressed={show}
                onClick={() => setShow((value) => !value)}
              >
                Draw districts
              </button>
              <button
                aria-pressed={mapView.showCoordinates}
                onClick={mapView.toggleCoordinates}
              >
                Show cursor coordinates
              </button>
            </div>
            <div className="button-row file-actions">
              <label className="csv-import">
                Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Import CSV"
                  disabled={importing || adding || planBusy || authBusy}
                  onChange={importCSV}
                />
              </label>
              <button onClick={png} disabled={exporting}>
                {exporting ? "Exporting…" : "Export PNG"}
              </button>
              <button
                onClick={() => {
                  download(
                    new Blob([stationsCSV(stations)], {
                      type: "text/csv;charset=utf-8",
                    }),
                    "polling-stations.csv",
                  );
                  setStatus("Stations exported as CSV.");
                }}
              >
                Export CSV
              </button>
              {importing && <span role="status">Importing…</span>}
            </div>
          </div>
          <div
            className="button-row map-view-controls"
            aria-label="Map view controls"
          >
            <button
              aria-label="Zoom in"
              onClick={mapView.zoomIn}
              disabled={mapView.atMaximum}
            >
              +
            </button>
            <button
              aria-label="Zoom out"
              onClick={mapView.zoomOut}
              disabled={mapView.atMinimum}
            >
              −
            </button>
            <button onClick={mapView.reset}>Reset view</button>
          </div>
          <p id="map-view-help" className="help">
            Select a station to edit or delete it. Zoom in to drag the map.
            Focus the map and use arrow keys to pan. PNG exports always show the
            full city.
          </p>
          <p className="map-note">
            A district contains every point closest to its station. Shared edges
            mark equal distances. City perimeter points are welcome.
          </p>
        </section>
        <aside className="tools">
          <section className="tool-section">
            <div className="section-heading">
              <div>
                <h2>{selectedStationId ? "Edit station" : "Add a station"}</h2>
              </div>
            </div>
            <p className="help">
              {selectedStationId
                ? "Update the selected station, or delete it from the map."
                : "Choose a name and coordinates within the city."}
            </p>
            <form noValidate onSubmit={saveStation}>
              <label>
                Station label
                <input
                  name="name"
                  value={stationDraft.name}
                  onChange={(event) =>
                    setStationDraft((draft) => ({
                      ...draft,
                      name: event.target.value,
                    }))
                  }
                  disabled={stationBusy}
                  required
                  maxLength="100"
                  placeholder="e.g. Central library"
                />
              </label>
              <div className="coordinate-fields">
                <label>
                  Station X
                  <input
                    name="x"
                    value={stationDraft.x}
                    onChange={(event) =>
                      setStationDraft((draft) => ({
                        ...draft,
                        x: event.target.value,
                      }))
                    }
                    disabled={stationBusy}
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="any"
                    placeholder="0–100"
                  />
                </label>
                <label>
                  Station Y
                  <input
                    name="y"
                    value={stationDraft.y}
                    onChange={(event) =>
                      setStationDraft((draft) => ({
                        ...draft,
                        y: event.target.value,
                      }))
                    }
                    disabled={stationBusy}
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="any"
                    placeholder="0–100"
                  />
                </label>
              </div>
              <button className="primary" disabled={stationBusy}>
                {adding
                  ? "Checking location…"
                  : selectedStationId
                    ? "Save changes"
                    : "Add station"}
              </button>
              {selectedStationId && (
                <div className="button-row station-edit-actions">
                  <button
                    type="button"
                    disabled={stationBusy}
                    onClick={() => removeStation(selectedStationId)}
                  >
                    Delete station
                  </button>
                  <button
                    type="button"
                    disabled={stationBusy}
                    onClick={() => {
                      clearStationSelection();
                      setError("");
                      setStatus("Station editing cancelled.");
                    }}
                  >
                    Cancel editing
                  </button>
                </div>
              )}
            </form>
            <p className="help rule-note">
              Unique locations only. New stations cannot lie on an existing
              shared district boundary.
            </p>
            <div className="station-list">
              {!stations.length ? (
                <p className="empty-list">No stations placed yet.</p>
              ) : (
                stations.map((s, i) => (
                  <div className="station-row" key={s.id}>
                    <span className="station-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="station-select"
                        aria-label={`Edit station ${s.name}`}
                        disabled={stationBusy}
                        onClick={() => selectStation(s)}
                      >
                        {s.name}
                      </button>
                      <span className="coordinate-text">
                        {s.x}, {s.y}
                      </span>
                    </div>
                    <button
                      aria-label={`Remove ${s.name}`}
                      disabled={stationBusy}
                      onClick={() => removeStation(s.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="tool-section">
            <h2>Find the nearest</h2>
            <p className="help">
              Test a point. Equal distances return every tied station.
            </p>
            <form noValidate onSubmit={query}>
              <div className="coordinate-fields">
                <label>
                  Query X
                  <input
                    name="x"
                    value={queryCoordinates.x}
                    onChange={(e) =>
                      setQueryCoordinates((current) => ({
                        ...current,
                        x: e.target.value,
                      }))
                    }
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="any"
                    placeholder="0–100"
                  />
                </label>
                <label>
                  Query Y
                  <input
                    name="y"
                    value={queryCoordinates.y}
                    onChange={(e) =>
                      setQueryCoordinates((current) => ({
                        ...current,
                        y: e.target.value,
                      }))
                    }
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="any"
                    placeholder="0–100"
                  />
                </label>
              </div>
              <div className="button-row query-actions">
                <button disabled={querying}>
                  {querying ? "Finding…" : "Find nearest stations"}
                </button>
                <button type="button" onClick={resetQuery}>
                  Reset query
                </button>
              </div>
            </form>
            {result && (
              <output className="query-result" aria-live="polite">
                <p>
                  {stations
                    .filter((s) => nearest.includes(s.id))
                    .map((s) => s.name)
                    .join(" · ")}
                </p>
                <p>
                  {nearest.length > 1
                    ? `Tie: ${nearest.length} stations`
                    : "Nearest station"}{" "}
                  · Distance {result.distance}
                </p>
              </output>
            )}
          </section>
        </aside>
        <section className="plans-panel" aria-labelledby="plans-heading">
          <div className="plan-intro">
            <h2 id="plans-heading">Your plans</h2>
            <p className="save-state">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </p>
            <p className="help">
              {user
                ? "Save a version, revisit a city."
                : "Sign in to save and revisit your plans."}
            </p>
          </div>
          <div className="plan-controls">
            <label>
              Plan name
              <input
                value={name}
                maxLength="100"
                onChange={(e) => setName(e.target.value)}
                placeholder="Give this city a name"
              />
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={planBusy || authBusy || adding || importing}
                onClick={() => save()}
              >
                Save plan
              </button>
              <button
                disabled={
                  !planId || planBusy || authBusy || adding || importing
                }
                onClick={() => save(true)}
              >
                Save as new
              </button>
              <button
                disabled={planBusy || adding || importing}
                onClick={newPlan}
              >
                New plan
              </button>
            </div>
          </div>
          <div className="plan-controls">
            <label>
              Saved plans
              <select
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
              >
                <option value="">Choose a plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selection || planBusy || adding || importing}
              onClick={load}
            >
              Load plan
            </button>
          </div>
        </section>
      </div>
      <footer>
        <span>The Polling Atlas</span>
      </footer>
      {authOpen && (
        <AccountDialog
          register={register}
          setRegister={setRegister}
          close={() => setAuthOpen(false)}
          authenticate={authenticate}
          busy={authBusy}
          error={error}
        />
      )}
    </main>
  );
}
