// A strict comma-separated CSV reader. Track physical lines for useful errors,
// including records whose quoted fields span multiple lines.
function records(text) {
  const rows = [];
  let fields = [],
    field = "",
    state = "plain",
    line = 1,
    start = 1;
  const finish = () => {
    fields.push(field);
    rows.push({ fields, line: start });
    fields = [];
    field = "";
    state = "plain";
    start = line + 1;
  };
  text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === "quoted") {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else state = "closed";
      } else {
        field += c;
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
      }
    } else if (c === ",") {
      fields.push(field);
      field = "";
      state = "plain";
    } else if (c === "\n" || c === "\r") {
      finish();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
    } else if (c === '"' && state === "plain" && field === "") {
      state = "quoted";
    } else if (state === "closed" || c === '"') {
      throw new Error(
        `Malformed CSV at row ${line}: unexpected text or quote.`,
      );
    } else field += c;
  }
  if (state === "quoted")
    throw new Error(`Malformed CSV at row ${start}: unclosed quote.`);
  if (field || fields.length || state === "closed") finish();
  while (
    rows.length &&
    rows.at(-1).fields.length === 1 &&
    !rows.at(-1).fields[0].trim()
  )
    rows.pop();
  return rows;
}
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function parseStationsCSV(text) {
  const rows = records(text);
  const headers = rows.shift()?.fields.map((s) => s.trim().toLowerCase()) || [];
  if (
    !headers.includes("x") ||
    !headers.includes("y") ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !["id", "name", "label", "x", "y"].includes(h)) ||
    (headers.includes("name") && headers.includes("label"))
  ) {
    throw new Error(
      "Invalid CSV headers: use comma-separated x,y with optional id and name (or label).",
    );
  }
  if (!rows.length) throw new Error("CSV must contain at least one station.");
  if (rows.length > 200)
    throw new Error("CSV can contain at most 200 stations.");
  const ids = new Set(),
    locations = new Set();
  return rows.map(({ fields, line }, i) => {
    if (fields.length !== headers.length)
      throw new Error(
        `Malformed CSV at row ${line}: column count does not match headers.`,
      );
    const row = Object.fromEntries(
      headers.map((h, j) => [h, fields[j].trim()]),
    );
    const x = Number(row.x),
      y = Number(row.y);
    if (
      ![row.x, row.y].every((v) => decimal.test(v)) ||
      ![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
    ) {
      throw new Error(
        `Invalid coordinates at row ${line}: x and y must be decimal numbers between 0 and 100.`,
      );
    }
    const id = row.id ?? `station-${i + 1}`;
    const name = row.name ?? row.label ?? `Station ${i + 1}`;
    if (![id, name].every((s) => s.length >= 1 && s.length <= 100))
      throw new Error(
        `Invalid id or name at row ${line}: use 1–100 characters.`,
      );
    if (ids.has(id)) throw new Error(`Duplicate station ID at row ${line}.`);
    if (locations.has(`${x},${y}`))
      throw new Error(`Duplicate coordinates at row ${line}.`);
    ids.add(id);
    locations.add(`${x},${y}`);
    return { id, name, x, y };
  });
}
