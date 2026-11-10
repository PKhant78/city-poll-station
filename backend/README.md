# Polling-plan backend

FastAPI, SQLAlchemy and PostgreSQL with a pure-Python bounded Voronoi implementation.

## Run

From `backend/`, with Python 3.11+ and [uv](https://docs.astral.sh/uv/) installed:

```sh
uv sync
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

PostgreSQL must already be running. The default `DATABASE_URL` is
`postgresql+psycopg://poll:poll@localhost:5432/poll`; create a `poll` database owned
by the `poll` role, or set `DATABASE_URL` to your own SQLAlchemy connection URL.
Tables are created on startup; existing records are preserved. This small project
uses `create_all`, not a schema-migration system. Back up the database and use
versioned migrations before changing a deployed schema.

`/docs` provides interactive API documentation. `/api/health` reports process
health, not database readiness. If `../frontend/dist` exists at application
creation time, the backend serves its files at `/`, after API routes. Build the
frontend first and restart the backend to enable this optional mode. Static
serving supports the root index and existing files, not arbitrary SPA paths.

## API contract

All bodies are JSON. Validation errors return HTTP 422 with `detail`; invalid
inputs do not change saved plans. Coordinates must be finite and in the closed
square `[0,100] × [0,100]`. A station is `{id, name, x, y}`. IDs and labels must
contain 1–120 characters. A set contains at most 200 stations, with unique IDs
and distinct coordinate pairs. Labels are preserved as entered.

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email,password}` → 201 `{user:{id,email}}`; signs in |
| POST | `/api/auth/login` | Same body → `{user:{id,email}}`; signs in |
| POST | `/api/auth/logout` | Invalidates current session and clears its cookie |
| GET | `/api/auth/me` | Current `{user:{id,email}}`, or 401 |
| GET | `/api/plans` | Current user's `{plans:[...]}`, newest update first |
| POST | `/api/plans` | `{name,stations,show_districts}` → 201 saved plan |
| PUT | `/api/plans/{id}` | Full replacement with the same fields → saved plan |
| DELETE | `/api/plans/{id}` | 204 with no body |
| POST | `/api/geometry` | `{stations}` → `{districts:[{station_id,vertices:[[x,y],...]}]}` |
| POST | `/api/query` | `{stations,x,y}` → `{station_ids:[...],distance}` |
| POST | `/api/validate-station` | `{stations,x,y}` → `{valid:true}` or 422 |
| GET | `/api/health` | `{status:"ok"}` |

Saved plans include `id`, `name`, `stations`, `show_districts` and a UTC ISO
`updated_at`. All plan endpoints require authentication. Updates and deletes of
missing plans or another user's plans return the same 404. Registration returns
409 for a duplicate email; login failures return 401. Emails are stripped and
lowercased. Passwords must contain 8–1024 characters.

Geometry and query endpoints are public and stateless. An empty station set has
no districts and a query returns `station_ids: []` and `distance: null`. Queries
return every tied nearest station in input order. A proposed addition is rejected
if it duplicates coordinates, exceeds the limit, or ties multiple nearest
stations (an existing district boundary). A final saved plan validates its set,
not its insertion history: a point on a former boundary can legitimately be in
the final set.

## Security and deployment

Passwords use individually salted scrypt hashes. Sessions use random 256-bit
tokens; only their SHA-256 digests are stored in PostgreSQL. Sessions expire after
seven days and survive backend restarts. Cookies are `HttpOnly`, `SameSite=Lax`,
with `Path=/`. Set `COOKIE_SECURE=true` for HTTPS deployment; local HTTP defaults
to `false`. Logout uses matching cookie attributes and revokes the database
session. Validation responses omit raw inputs so passwords and non-finite numbers
are not echoed or passed to JSON serialization.

CORS allows credentials only for exact origins. The default allowlist is:

- `http://localhost:5180`
- `http://127.0.0.1:5180`
- `http://localhost:8000`
- `http://127.0.0.1:8000`

Override it with comma-separated `ALLOWED_ORIGINS` (scheme, host and port; no
trailing slash). Unsafe HTTP methods reject a supplied untrusted `Origin`,
including `null`. Requests without `Origin` remain supported for CLI clients.
This complements SameSite cookies; it does not replace authentication. Do not
use wildcard origins. Deploy frontend and API on the same HTTPS site, set the
production allowlist explicitly, use non-default database credentials, restrict
database network access, terminate TLS at a trusted proxy, and avoid logging
cookies/passwords. Configure rate limits for authentication and public geometry
requests at your reverse proxy. Rate limiting, password recovery, email
verification and automatic expired-session cleanup are not implemented here.

## Geometry, tolerances and complexity

Each Voronoi cell starts as the city square. It is clipped against the closer-to-
this-station half-plane for every other station using midpoint-based dot
products. No external geometry library or triangulation is used. This handles
single stations, collinear sets, city edges and multi-way ties. Coordinates and
vertices use floating-point arithmetic, so clients should not expect exact
symbolic vertices. Half-plane membership uses `<= 0`; nearest-query ties use
`math.isclose` on squared distances with `rel_tol=1e-10`, `abs_tol=1e-10`.
Consequently points sufficiently near a bisector are conservatively treated as
ties during insertion validation. Duplicate coordinates are checked exactly.

A nearest query and insertion check take O(n) time and O(n) intermediate space.
There are O(n²) pairwise half-plane clipping steps for all cells; each clipping
step scans a polygon with up to O(n) vertices, giving an O(n³) worst-case time
bound for this straightforward implementation. Output can occupy O(n²) space
under that conservative per-cell bound. The API caps n at 200 to bound workload.

## Tests

```sh
uv sync
uv run pytest -q
```

The automated suite uses temporary SQLite databases, not your PostgreSQL data,
and covers persistence across app restarts, authentication/session expiry,
owner isolation, plan updates/deletes, validation, geometry, origin checks,
secure cookies and optional static serving. Development dependencies include
`httpx2` for current Starlette TestClient compatibility; `httpx` remains available
for HTTP smoke scripts. For a real-database check, run the backend against
PostgreSQL and exercise registration → plan creation → update → list → deletion.
