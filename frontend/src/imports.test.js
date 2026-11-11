import { expect, it } from "vitest";
import { parseStationsCSV } from "./imports";
import { stationsCSV } from "./exports";
it("imports decimal coordinates and supplies stable IDs and names", () => {
  expect(parseStationsCSV("x,y\n25.25,50\n74.75,50\n")).toEqual([
    { id: "station-1", name: "Station 1", x: 25.25, y: 50 },
    { id: "station-2", name: "Station 2", x: 74.75, y: 50 },
  ]);
});
it("reads exporter headers, escaped quotes, embedded newlines, BOM, CRLF and blank trailing lines", () => {
  const stations = [
    { id: "north", name: 'Hall, "North"\nAnnex', x: 0, y: 100 },
  ];
  expect(
    parseStationsCSV("\ufeff" + stationsCSV(stations) + "\r\n \r\n"),
  ).toEqual(stations);
});
it("trims and matches headers case insensitively, accepting label alias", () => {
  expect(
    parseStationsCSV(" Y , LABEL , X , ID \n 50 , North , .25 , a"),
  ).toEqual([{ id: "a", name: "North", x: 0.25, y: 50 }]);
});
it.each([
  "",
  " ",
  "oops",
  "101",
  "-1",
  "NaN",
  "Infinity",
  "0x10",
  "1e999",
  "1.2.3",
])("rejects invalid coordinate %j with physical row number", (x) => {
  expect(() => parseStationsCSV(`x,y\n20,30\n${x},40`)).toThrow(
    /Invalid coordinates.*row 3/i,
  );
});
it.each([
  "",
  "x,y",
  "x;y\n1;2",
  "name,x\nA,1",
  "x,x,y\n1,2,3",
  "x,y,wat\n1,2,3",
  "x,y\n1",
  "x,y\n1,2,3",
  'x,y\n"1,2',
  'x,y\n1"2,3',
  'x,y\n"1"oops,2',
])("rejects malformed CSV %j", (text) => {
  expect(() => parseStationsCSV(text)).toThrow(/CSV|header|row|station/i);
});
it("rejects duplicate IDs, duplicate coordinates and over 200 rows", () => {
  expect(() => parseStationsCSV("id,x,y\na,1,2\na,2,3")).toThrow(
    /duplicate.*id.*row 3/i,
  );
  expect(() => parseStationsCSV("x,y\n1,2\n1.0,2")).toThrow(
    /duplicate.*coordinates.*row 3/i,
  );
  expect(() =>
    parseStationsCSV(
      "x,y\n" +
        Array.from({ length: 201 }, (_, i) => `${i / 10},20`).join("\n"),
    ),
  ).toThrow(/200/);
});
it("rejects blank and oversized explicit IDs and labels", () => {
  for (const header of ["id", "name", "label"]) {
    for (const value of ["", "a".repeat(101)]) {
      expect(() => parseStationsCSV(`x,y,${header}\n1,2,${value}`)).toThrow(
        /row 2/i,
      );
    }
  }
});
