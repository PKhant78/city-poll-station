# City A · Polling Station Planner

A single-page workspace for election staff with React, JavaScript, Tailwind, Python and PostgresSQL.

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
5. Create an account or sign in to save a named plan. Successful registration, login and logout reset the working map: stations, districts, query results, plan name and association are cleared, with a clean saved-change baseline. Failed authentication preserves your draft. Saved plans remain in your account; load a saved plan to restore its stations and district visibility.
6. Download the map as PNG or export station coordinates as CSV.

### Importing station CSV files

Use **Import CSV** beside the map export controls. Choose a `.csv` file (extension is case-insensitive; MIME type does not matter), at most 1 MiB (1,048,576 bytes), containing 1–200 stations. The file is read locally, not uploaded or stored as a file. Parsed station data is sent to the geometry API for validation and district calculation; it is only persisted when you explicitly save a plan.

Required headers are `x,y`; optional headers are `id` and either `name` or `label`. Header order is flexible and headers are trimmed and case-insensitive. Unknown, repeated or missing headers and semicolon/tab delimiters are rejected. The existing `id,name,x,y` CSV export is supported. For example:

```csv
name,x,y
West Hall,25.25,50
East Hall,74.75,50
Center,50,20
```

See [`examples/stations.csv`](examples/stations.csv) for a ready-to-import file. Without IDs or names, rows receive `station-1` / `Station 1`, etc. Explicit IDs/names must be nonblank and at most 100 characters. Coordinates must be finite decimal numbers in `[0,100]`; blanks, hexadecimal, NaN and infinity are rejected. Duplicate IDs or coordinates are rejected. CSV quoting, escaped double quotes, quoted line breaks, CRLF, UTF-8 BOM and empty trailing lines are supported. Text is trimmed; spreadsheet-safety apostrophes from exported text remain literal and are not silently removed.

The complete final set is validated together, not replayed as sequential station insertions. A valid import replaces the working stations, shows all districts, clears the previous query and plan association/name, and marks the new draft unsaved. An unsaved nonempty draft requires confirmation before replacement. Invalid files report a visible error (coordinate errors include the physical row number) and leave the existing map unchanged, with no partial import. Editing and plan saves are disabled while importing; authentication changes invalidate an in-flight import.

### Coordinate and boundary rules

- The city is the closed square `[0,100] × [0,100]`; its outer edges are valid locations.
- A new station cannot duplicate another station or lie on a boundary between the **existing** districts. This is checked before insertion, even when district lines are hidden.
- With zero or one existing station there is no inter-district boundary to reject.
- Adding or removing stations changes district boundaries. Existing stations are not removed because boundaries changed.
- Saved plans validate finite in-range coordinates, unique station IDs and distinct locations. They are not replayed through historical insertion order, because a final plan does not record its editing history.
- A maximum of 200 stations keeps the hand-written geometric calculation responsive. This is a planning prototype, not a geographic GIS application.
