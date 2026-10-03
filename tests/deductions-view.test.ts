import assert from "node:assert/strict";
import test from "node:test";
import { createDeductionsDisplayProjector, createDeductionsRowProjector } from "../src/app/lib/utils/deductions-view";
import { createDeductionsPrioritizer } from "../src/app/lib/utils/deductions-display";
import { getDeductionsSourceMonth } from "../src/app/lib/utils/deductions-sheet-source";
import { createHoldTransactionReconciler, getHoldSemanticIdentity, reconcileHoldTransactionRows } from "../src/app/lib/utils/hold-carryover";
import { calculateReconciliationTotals, createReconciliationTotalsCalculator } from "../src/app/lib/utils/reconciliation-sync";

const transaction = {
  "ID Number": "001234567890", "Full name": "NGUYEN VAN A", BU: "AHN", L07: "HN0001.TEST",
  "Bank Account Number": "0123456789", "Tháng": "03.2026", "Tháng báo cáo": "03.2026",
  "Tháng phát sinh": "03.2026", "Sheet Source": "Hold T1", "Nghiệp vụ": "Hold",
  "TOTAL PAYMENT": -1_250_000, _holdStatusBeforeSave: "Hold",
};

test("Sheet Source overrides a stale persisted arising month without changing the report month", () => {
  const [row] = createDeductionsRowProjector("03.2026")([transaction]);
  assert.equal(row["Tháng báo cáo"], "03.2026");
  assert.equal(row["Tháng phát sinh"], "01.2026");
  assert.equal(row["Trạng thái"], "01.2026");
  assert.equal(row["Tình trạng thanh toán"], "Pending từ tháng 01.2026");
  assert.equal(row._isPastMonthHoldOrCancel, true);
  assert.equal(transaction["Tháng phát sinh"], "03.2026");
});

test("source-month parsing supports accented labels, explicit years and year rollover", () => {
  for (const [source, report, expected] of [
    ["Hold Tháng 12", "02.2027", "12.2026"],
    ["HOLD12", "03.2026", "12.2025"],
    ["Hold T01", "03.2026", "01.2026"],
    ["Add T3", "03.2026", "03.2026"],
    ["Hold T12/2024", "03.2026", "12.2024"],
    ["Hold 2025-11", "03.2026", "11.2025"],
  ]) assert.equal(getDeductionsSourceMonth(source, "", report), expected);
});

test("multi-month sources use Note to choose the arising month", () => {
  const [row] = createDeductionsRowProjector("07.2026")([
    { ...transaction, "Tháng": "07.2026", "Sheet Source": "HOLD T5+6", Note: "Lương tháng 6" },
  ]);
  assert.equal(row["Tháng phát sinh"], "06.2026");
  const displayed = createDeductionsDisplayProjector()(row);
  assert.equal(displayed["Sheet Source"], "Hold T6");
  assert.equal(displayed._needsSheetSourceNote, false);
  assert.equal(getDeductionsSourceMonth("HOLD T5+6", "", "07.2026"), null);
  assert.equal(getDeductionsSourceMonth("HOLD T5+6", "Lương tháng 6/2025", "07.2026"), "06.2025");
});

test("a source without a month retains the stored arising date", () => {
  const [row] = createDeductionsRowProjector("03.2026")([
    { ...transaction, "Sheet Source": "Điều chỉnh", "Tháng phát sinh": "02.2026" },
  ]);
  assert.equal(row["Tháng phát sinh"], "02.2026");
});

test("editing one operation preserves every unaffected derived and displayed row", () => {
  const projectRows = createDeductionsRowProjector("03.2026");
  const display = createDeductionsDisplayProjector();
  const prioritize = createDeductionsPrioritizer();
  const source = Array.from({ length: 10_000 }, (_, index) => ({
    ...transaction, "ID Number": String(index), "Full name": `PERSON ${index}`,
  }));
  const first = prioritize(projectRows(source).map(display));
  const changed = [...source];
  changed[50] = { ...source[50], "Nghiệp vụ": "Add", "TOTAL PAYMENT": 1_250_000 };
  const second = prioritize(projectRows(changed).map(display));
  assert.equal(second.filter((row, index) => row !== first[index]).length, 1);
  assert.equal(second[50]["Nghiệp vụ"], "Add");
  assert.equal(second[50]["TOTAL PAYMENT"], 1_250_000);
  assert.equal(second[50]._isPastMonthHoldOrCancel, false);
  assert.equal(second[50]["Tháng phát sinh"], "01.2026");
  assert.strictEqual(prioritize(projectRows(source).map(display))[50], first[50], "undo can reuse the original row");
});

test("source and Note edits invalidate the changed row's derived month", () => {
  const project = createDeductionsRowProjector("03.2026");
  const [first] = project([transaction]);
  const [second] = project([{ ...transaction, "Sheet Source": "Hold T2" }]);
  assert.equal(first["Tháng phát sinh"], "01.2026");
  assert.equal(second["Tháng phát sinh"], "02.2026");
  assert.notStrictEqual(first, second);
});

test("an explicit operation change overrides a legacy HOLD status", () => {
  const project = createDeductionsRowProjector("03.2026");
  for (const operation of ["Add", "Cancel", "A", "C"]) {
    const [row] = project([{
      ...transaction, "Tháng phát sinh": "", "Trạng thái": "Hold T1", "Nghiệp vụ": operation,
    }]);
    assert.equal(row["Nghiệp vụ"], operation === "A" ? "Add" : operation === "C" ? "Cancel" : operation);
    assert.equal(row["Tháng phát sinh"], "01.2026");
  }
});

test("deletion reindexes cached rows against storage after subtotal rows are excluded", () => {
  const project = createDeductionsRowProjector("03.2026");
  const secondSource = { ...transaction, "ID Number": "OTHER" };
  const first = project([{ "TOTAL PAYMENT": 99 }, transaction, secondSource]);
  const afterDeletion = project([secondSource]);
  assert.equal(first[1]._originalIndex, 2);
  assert.equal(afterDeletion[0]._originalIndex, 0);
  assert.notStrictEqual(afterDeletion[0], first[1]);
});

test("duplicate-match flags refresh for peers when an amount changes", () => {
  const prioritize = createDeductionsPrioritizer();
  const other = { ...transaction, "TOTAL PAYMENT": 1_250_000 };
  const first = prioritize([transaction, other]);
  assert.equal(first[0]._matchingDeduction, true);
  assert.equal(first[1]._matchingDeduction, true);
  const changed = { ...other, "TOTAL PAYMENT": 2_000_000 };
  const next = prioritize([transaction, changed]);
  assert.equal(next[0]._matchingDeduction, false);
  assert.equal(next[1]._matchingDeduction, false);
  assert.notStrictEqual(next[0], first[0]);
});

test("carryover identity uses the same source month as the displayed deduction", () => {
  const corrected = { ...transaction, "Tháng phát sinh": "01.2026" };
  assert.equal(getHoldSemanticIdentity(transaction), getHoldSemanticIdentity(corrected));
  const reconciled = reconcileHoldTransactionRows([transaction]);
  assert.strictEqual(reconciled[0], transaction, "canonical rows keep their reference");
});

test("cached HOLD reconciliation preserves history and refreshes changed identities", () => {
  const cached = createHoldTransactionReconciler();
  const earlier = { ...transaction, "Tháng báo cáo": "02.2026", "Tháng": "02.2026" };
  const later = { ...transaction, "Tháng báo cáo": "04.2026", "Tháng": "04.2026" };
  let rows = [earlier, transaction, later];
  for (const operation of ["Hold", "Cancel", "Add", "Hold"]) {
    rows = [earlier, { ...transaction, "Nghiệp vụ": operation, "TOTAL PAYMENT": operation === "Add" ? 1_250_000 : -1_250_000 }, later];
    const actual = cached.reconcile(rows);
    assert.deepEqual(actual, reconcileHoldTransactionRows(rows));
    assert.strictEqual(actual[0], earlier);
  }
  const changedSource = [earlier, { ...transaction, "Sheet Source": "Hold T2" }, later];
  assert.deepEqual(cached.reconcile(changedSource), reconcileHoldTransactionRows(changedSource));
  const first = cached.merge(rows);
  assert.deepEqual(cached.collapse({ rows, mergedRow: first[0], canonicalIndex: 0, updatedRow: { ...earlier, "Nghiệp vụ": "Cancel" } }),
    [ { ...earlier, "Nghiệp vụ": "Cancel" }, rows[1], later ]);
});

test("cached reconciliation totals follow operation, amount, bank and source changes", () => {
  const calculate = createReconciliationTotalsCalculator("03.2026");
  const current = { ...transaction, "Sheet Source": "Hold T3" };
  const headers = Object.keys(current);
  const gross = { headers, data: [{ ...current, "TOTAL PAYMENT": 5_000_000 }] };
  const bank = { headers, data: [{ ...current, "TOTAL PAYMENT": 3_750_000 }] };
  for (const operation of ["Hold", "Add", "Cancel", "Hold"]) {
    const row = { ...current, "Nghiệp vụ": operation, "TOTAL PAYMENT": operation === "Add" ? 1_250_000 : -1_250_000 };
    const data = { Sheet1_AE: gross, Hold_AE: { headers, data: [row] }, Bank_North_AE: bank };
    assert.deepEqual(calculate(data), calculateReconciliationTotals(data, "03.2026"));
    const changed = { ...data, Sheet1_AE: { headers, data: [{ ...current, "TOTAL PAYMENT": 6_000_000 }] }, Bank_North_AE: { headers, data: [{ ...current, "TOTAL PAYMENT": 6_000_000 }] } };
    assert.deepEqual(calculate(changed), calculateReconciliationTotals(changed, "03.2026"));
  }
});
