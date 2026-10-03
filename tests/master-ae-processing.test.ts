import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as XLSX from "xlsx";
import { INITIAL_APP_DATA } from "../src/app/constants/initial-data";
import { processMasterAEData, type MasterAEProcessingContext } from "../src/app/lib/utils/master-ae-processing";
import { parseMasterWorkbook } from "../src/app/workers/masterImport.worker";

function importHarness(t: TestContext, file: File) {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  const events = new EventTarget();
  const descriptors = new Map(["window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let data = structuredClone(INITIAL_APP_DATA);
  data.globalMonth = "08.2026";
  data.Ae_Global_Inputs = [{ id: "import-1", name: file.name, fileObj: file, status: "ready", bank: "NORTH", month: "08.2026" }];
  const processing: boolean[] = [];
  let completions = 0;
  const context: MasterAEProcessingContext = {
    appData: data,
    updateAppData: (updater) => { data = updater(data); },
    preparedMasterFiles: new Map(),
    parseMasterFileInWorker: parseMasterWorkbook,
    masterAeFields: [],
    setIsProcessing: (value) => { processing.push(value); },
    setProgress: () => {},
    setProcessingMessage: () => {},
    onComplete: () => { completions++; },
  };
  return { context, storage, processing, data: () => data, completions: () => completions };
}

test("Master import retains salary totals, complete Deductions and Pivot cache after processing extraction", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["ID Number", "Full name", "Center", "CHARGE TO LXO", "TOTAL PAYMENT"],
    ["001090627040", "Nguyen Van A", "Ocean Park", 120000, 120000],
  ]), "Sheet 1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["ID Number", "Full name", "Center", "TOTAL PAYMENT", "Note"],
    ["001090627040", "Nguyen Van A", "Ocean Park", 20000, "Hold tháng 08.2026"],
    ["", "Tổng cộng", "", 20000, ""],
  ]), "HOLD T8");
  const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "NORTH 08.2026.xlsx");
  const harness = importHarness(t, file);
  await processMasterAEData(harness.context);

  const data = harness.data();
  assert.deepEqual(harness.processing, [true, false]);
  assert.equal(harness.completions(), 1);
  assert.equal(data.Ae_Global_Inputs[0].status, "Success");
  assert.equal(data.Sheet1_AE.data.length, 1);
  assert.equal(data.Sheet1_AE.data[0]["TOTAL PAYMENT"], 120000);
  assert.equal(data.Sheet1_AE.data[0].L07, "HN0027.OPK");
  assert.equal(data.Hold_AE.data.length, 1);
  assert.equal(data.Hold_AE.data[0]["ID Number"], "001090627040");
  assert.equal(Math.abs(data.Hold_AE.data[0]["TOTAL PAYMENT"]), 20000);
  assert.equal(data.Hold_AE.data[0]["Tháng báo cáo"], "08.2026");
  const cache = JSON.parse(harness.storage.get("pivot_master_processed_data") || "null");
  assert.equal(cache.reportingMonth, "08.2026");
  assert.equal(cache.groupedData.AHN["HN0027.OPK"]["08.2026"].LXO, 120000);
  assert.deepEqual(cache.diagnosticLogs, []);
  assert.equal(harness.context.preparedMasterFiles.size, 0);
});

test("Master import clears processing state and marks failed files without completing", async (t) => {
  const harness = importHarness(t, new File(["invalid"], "NORTH.xlsx"));
  harness.context.parseMasterFileInWorker = async () => { throw new Error("Cannot read workbook"); };
  await processMasterAEData(harness.context);
  assert.deepEqual(harness.processing, [true, false]);
  assert.equal(harness.data().Ae_Global_Inputs[0].status, "Error: Cannot read workbook");
  assert.equal(harness.completions(), 0);
  assert.equal(harness.context.preparedMasterFiles.size, 0);
  assert.equal(harness.data().Sheet1_AE.data.length, 0);
});

test("Gross Pay import keeps equal Cambridge and Contest payments distinct and maps Cambridge HP", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["ID Number", "Full name", "Center", "CHARGE TO LXO", "TOTAL PAYMENT"],
    ["001090627040", "Nguyen Van A", "Cambridge", 120000, 120000],
    ["001090627040", "Nguyen Van A", "Contest", 120000, 120000],
    ["001090627040", "Nguyen Van A", "Job Fair", 120000, 120000],
    ["001090627040", "Nguyen Van A", "Cambridge HP", 120000, 120000],
  ]), "Sheet 1");
  const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "NORTH 08.2026.xlsx");
  const harness = importHarness(t, file);
  await processMasterAEData(harness.context);
  assert.equal(harness.completions(), 1);
  assert.deepEqual(harness.data().Sheet1_AE.data.map(row => [row.L07, row.Business, row["TOTAL PAYMENT"]]), [
    ["CAMBRIDGE", "AHN", 120000],
    ["CONTEST", "AHN", 120000],
    ["JOB FAIR", "AHN", 120000],
    ["CAMBRIDGE", "AHP", 120000],
  ]);
  const cache = JSON.parse(harness.storage.get("pivot_master_processed_data") || "null");
  assert.equal(cache.groupedData.AHN.CAMBRIDGE["08.2026"].LXO, 120000);
  assert.equal(cache.groupedData.AHN.CONTEST["08.2026"].LXO, 120000);
  assert.equal(cache.groupedData.AHN["JOB FAIR"]["08.2026"].LXO, 120000);
  assert.equal(cache.groupedData.AHP.CAMBRIDGE["08.2026"].LXO, 120000);
});

test("Master import preserves historical Bank North months for Batch Payment", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["No", "ID Number", "Full name", "Center", "Bank Account Number", "TOTAL PAYMENT", "Payment details"],
    [1, "001090627040", "Nguyen Van A", "Ocean Park", "0012345678", 120000, "Salary 08.2026"],
  ]), "Bank North AE");
  const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "NORTH 08.2026.xlsx");
  const harness = importHarness(t, file);

  harness.context.appData.Bank_North_AE = {
    ...harness.context.appData.Bank_North_AE,
    data: [{
      No: 1,
      "ID Number": "OLD-07",
      "Full name": "NGUYEN VAN JULY",
      L07: "HN0027.OPK",
      Business: "AHN",
      "Bank Account Number": "0099001100",
      "TOTAL PAYMENT": 90000,
      "Payment details": "Salary 07.2026",
      "TÊN FILE": "NORTH 07.2026.xlsx",
      _fileMonth: "07.2026",
      "Tháng báo cáo": "07.2026",
    }],
  };

  await processMasterAEData(harness.context);

  const bankRows = harness.data().Bank_North_AE.data;
  assert.equal(bankRows.length, 2);
  assert.deepEqual(
    bankRows.map((row) => row["Tháng báo cáo"]).sort(),
    ["07.2026", "08.2026"],
  );
  assert.equal(
    bankRows.find((row) => row["Tháng báo cáo"] === "07.2026")?.["ID Number"],
    "OLD-07",
  );
  assert.equal(
    bankRows.find((row) => row["Tháng báo cáo"] === "08.2026")?.["ID Number"],
    "001090627040",
  );
});
