# City A · Polling Station Planner

A single-page workspace for election staff. React and JavaScript render the interface, Tailwind and custom CSS provide a beige/black/white newspaper style, and a Python API stores accounts and plans in PostgreSQL.

## Local development

Requirements: Node.js 22+, npm, Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker with Compose.

Start PostgreSQL from the project root:

```sh
docker compose up -d --wait
```

Start the API in a separate terminal:

```sh
cd backend
uv sync
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

See `backend/README.md` for configuration. The default database connection is:

```text
postgresql+psycopg://poll:poll@localhost:5432/poll
```

Start the interface:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5180**. Vite forwards `/api` to the Python API at port 8000. Port 5180 avoids existing local development servers.

### Run the built single-page application

```sh
(cd frontend && npm ci && npm run build)
(cd backend && uv sync && uv run uvicorn main:app --host 127.0.0.1 --port 8000)
```

With PostgreSQL running, open **http://127.0.0.1:8000**. Python serves both the built React application and the API, so no Vite server is needed. Build before starting the API, or restart the API after the first build.

The Compose database port is bound to localhost. The `poll` password is for development only. Data lives in the `poll-data` Docker volume and survives container restarts. `docker compose down` stops the database without deleting it; adding `-v` permanently deletes saved accounts and plans.

## Using the planner

1. Start with the empty square city map. Coordinates increase rightwards and upwards.
2. Add stations by entering their names and coordinates. Decimal coordinates are accepted.
3. Draw districts to show black boundaries around each station's nearest-point region. Removing or adding a station updates the subdivision.
4. Query a coordinate to find its nearest station. A boundary query returns **all** tied stations, including three-way or higher-order junctions.
5. Create an account or sign in to save a named plan. Load a saved plan to restore its stations and district visibility.
6. Download the map as PNG or export station coordinates as CSV.

### Coordinate and boundary rules

- The city is the closed square `[0,100] × [0,100]`; its outer edges are valid locations.
- A new station cannot duplicate another station or lie on a boundary between the **existing** districts. This is checked before insertion, even when district lines are hidden.
- With zero or one existing station there is no inter-district boundary to reject.
- Adding or removing stations changes district boundaries. Existing stations are not removed because boundaries changed.
- Saved plans validate finite in-range coordinates, unique station IDs and distinct locations. They are not replayed through historical insertion order, because a final plan does not record its editing history.
- A maximum of 200 stations keeps the hand-written geometric calculation responsive. This is a planning prototype, not a geographic GIS application.

## Geometry implementation

No geometry or nearest-neighbor library implements the algorithm.

Each station starts with the full square. For every other station, the Python implementation clips that polygon to the half-plane closer to the first station. The half-plane comes from expanding the squared Euclidean distances; their quadratic terms cancel to give a straight perpendicular bisector. Repeating the clipping produces a square-bounded Voronoi district, including collinear configurations without triangulation special cases.

Queries scan squared distances and return all minima within a documented floating-point tolerance. The API returns the ordinary Euclidean distance. Tiny floating-point tolerances are necessary because noninteger coordinates cannot always be represented exactly in binary.

## Verification

Backend unit/API tests and frontend interaction tests live with their respective applications:

```sh
(cd backend && uv run pytest -q)
(cd frontend && npm test -- --run)
(cd frontend && npm run build)
(cd backend && uv run python ../scripts/check_geometry.py)
```

For real-browser checks against the running frontend and API (including automated WCAG checks):

```sh
cd scripts
npm ci
npx playwright install chromium
npm test
```

Browser screenshots are saved under `scripts/artifacts/`.

With the API and actual PostgreSQL running, run this root-level integration check:

```sh
python3 scripts/smoke_test.py
```

It exercises district area coverage, boundary ties, invalid placement, account creation, cookie sessions, save/read/update, account isolation and persistence after logout/login. It deliberately creates two uniquely named QA accounts and a small saved plan; use a development database.

## Deployment considerations

This is an implemented local application, not a certification of production election security. Before public deployment, configure HTTPS and secure session cookies, use unique database credentials, add deployment-appropriate login throttling and account provisioning, set trusted origins and establish backups and operational monitoring. Account creation does not by itself verify that someone is an election official. Do not expose public registration for real election operations without an approval policy.

No demographic data, voting records or real city geography are included. Station names and coordinates are the planning data.
