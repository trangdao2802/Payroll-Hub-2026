import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("Timesheet Sync Cloud and Reset actions use equal-width grid columns", () => {
  const source = readSource("src/app/pages/01-timesheet/TimesheetHub.tsx");

  assert.match(
    source,
    /Quick Sync & Reload Actions[\s\S]{0,180}className="grid grid-cols-2 gap-1\.5"/,
  );
  assert.doesNotMatch(
    source,
    /Quick Sync & Reload Actions[\s\S]{0,180}grid-cols-\[minmax\(0,1fr\)_auto\]/,
  );
});

test("grouped table headers preserve internal dividers without doubling the frame", () => {
  const styles = readSource("src/table-border-zero.css");

  assert.match(
    styles,
    /> thead:has\(> tr:first-child > th:last-child:not\(\[rowspan\]\)\)[\s\S]*> tr:nth-child\(n \+ 2\)[\s\S]*> th:last-child \{[\s\S]*border-right: 0 !important;/,
  );
  assert.match(
    styles,
    /:not\(\.table-body-region\):has\(\+ \.table-body-region\)[\s\S]*border-bottom-width: 0 !important;/,
  );
  assert.match(
    styles,
    /\+ \.table-body-region[\s\S]*> thead[\s\S]*> tr:first-child[\s\S]*> th \{[\s\S]*border-top: 1px solid var\(/,
  );
});


test("grand-total rows visually seal the horizontal scrollbar gutter", () => {
  const styles = readSource("src/index.css");

  assert.ok(
    styles.includes(
      ":is(.table-body-region, .custom-scrollbar, .overflow-auto, .overflow-x-auto):has(tfoot)::-webkit-scrollbar-track:horizontal",
    ),
  );
  assert.ok(
    styles.includes(
      "background: var(--table-footer-scrollbar-bg) !important;",
    ),
  );
});

test("table containers and frames enforce zero border radius and sealed sticky total rows", () => {
  const styles = readSource("src/table-border-zero.css");

  assert.match(
    styles,
    /\.analysis-table-frame[\s\S]*border-radius:\s*0px\s*!important;/,
  );
  assert.match(
    styles,
    /:is\(tfoot,\s*\.total-row\)[\s\S]*position:\s*sticky\s*!important;[\s\S]*bottom:\s*0\s*!important;[\s\S]*background-color:/,
  );
});

