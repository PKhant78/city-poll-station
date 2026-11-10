import { expect, it, vi } from "vitest";
import { stationsCSV, exportPNG } from "./exports";
it("quotes station CSV and neutralizes spreadsheet formula text", () => {
  expect(
    stationsCSV([
      { id: "id1", name: '=HYPERLINK("evil")\nnext', x: 10, y: 20 },
    ]),
  ).toBe('id,name,x,y\r\n"id1","\'=HYPERLINK(""evil"")\nnext",10,20\r\n');
  for (const name of ["+bad", "-bad", "@bad", "\tbad", "\rbad"])
    expect(stationsCSV([{ id: "s", name, x: 0, y: 0 }])).toContain(
      `"'${name}"`,
    );
});
it("serializes the SVG, rasterizes to PNG, downloads, and revokes object URLs", async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-8 -8 116 116");
  const urls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:${urls.length}`;
    urls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
    cb(new Blob(["PNG"], { type: "image/png" })),
  );
  const clicked = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const OriginalImage = global.Image;
  global.Image = class {
    set src(value) {
      this.value = value;
      queueMicrotask(() => this.onload());
    }
  };
  try {
    await exportPNG(svg);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL.mock.calls.flat()).toEqual(
      expect.arrayContaining(urls),
    );
  } finally {
    global.Image = OriginalImage;
    vi.restoreAllMocks();
  }
});
