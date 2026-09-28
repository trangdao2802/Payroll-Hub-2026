import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("all branded table initials keep one optical baseline", () => {
  const styles = readSource("src/title-alignment.css");
  const main = readSource("src/main.tsx");

  assert.match(styles, /\.app-table-initial-mark\s*\{[^}]*top:\s*0/);
  assert.match(styles, /\.app-table-initial-mark\s*\{[^}]*transform-origin:\s*center bottom/);
  assert.match(
    styles,
    /:where\(button, a\):hover \.app-table-initial-mark\s*\{[\s\S]*?transform:\s*scale\(1\.025\) !important/,
  );
  assert.match(
    styles,
    /\.table-initial-toggle:hover \.app-table-initial-mark\s*\{[\s\S]*?transform:\s*scale\(1\.025\) !important/,
  );
  assert.match(
    main,
    /import "\.\/table-border-zero\.css";\nimport "\.\/title-alignment\.css";/,
  );
});

test("navbar page subtitle is sentence case", () => {
  const styles = readSource("src/title-alignment.css");

  assert.match(
    styles,
    /\.navbar-current-label\s*\{[\s\S]*?text-transform:\s*lowercase !important/,
  );
  assert.match(
    styles,
    /\.navbar-current-label::first-letter\s*\{[\s\S]*?text-transform:\s*uppercase !important/,
  );
});


test("table switchers use unique icons and Timesheet summary captions share one rhythm", () => {
  const navbar = readSource("src/app/components/layouts/Navbar.tsx");
  const timesheet = readSource("src/app/pages/01-timesheet/TimesheetHub.tsx");
  const coverage = readSource(
    "src/app/pages/01-timesheet/components/TimesheetCenterCoverage.tsx",
  );

  const centersBlock =
    navbar.match(/"\/centers": \[([\s\S]*?)\],\n  "\/audit"/)?.[1] || "";
  const masterBlock =
    navbar.match(/"\/master-ae": \[([\s\S]*?)\],\n};/)?.[1] || "";
  const iconsOf = (block: string) =>
    Array.from(block.matchAll(/icon:\s*(\w+)/g), (match) => match[1]);

  const centerIcons = iconsOf(centersBlock);
  const masterIcons = iconsOf(masterBlock);
  assert.ok(centerIcons.length > 0);
  assert.ok(masterIcons.length > 0);
  assert.equal(new Set(centerIcons).size, centerIcons.length);
  assert.equal(new Set(masterIcons).size, masterIcons.length);

  assert.match(timesheet, /Pivot Timesheet", icon: FileSpreadsheet/);
  assert.match(coverage, />CENTER<\/span>/);
  assert.match(
    coverage,
    /bg-card px-2\.5 py-0\.5 rounded-md border border-border\/60 shadow-2xs/,
  );
});
