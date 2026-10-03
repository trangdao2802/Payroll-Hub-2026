import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateLogicalStorage,
  formatStorageBytes,
  formatStorageReport,
  getStorageTotals,
  summarizeSnapshotStorage,
  type PayrollStorageReport,
} from "../src/app/lib/utils/storage-usage";

test("logical size counts UTF-8, JSON escaping and repeated objects like JSON export", async () => {
  const shared = { "Tên nhân viên": "Đặng Thị Ánh 🌸", note: "\"lương\"\n\\", optional: undefined };
  const data = { rows: [shared, shared, null, undefined, NaN, -0], saved: new Date("2026-10-03"), active: true };
  const result = await estimateLogicalStorage(data);
  assert.equal(result.jsonBytes, Buffer.byteLength(JSON.stringify(data), "utf8"));
  assert.equal(result.fileBytes, 0);
});

test("large payroll includes every row and an outlier at the end, yielding to the UI", async () => {
  const rows = Array.from({ length: 50_000 }, (_, index) => ({ id: index, note: "Lương tiếng Việt" }));
  rows[rows.length - 1].note = "Đ".repeat(200_000);
  let yielded = 0;
  const size = await estimateLogicalStorage(rows, { yieldControl: async () => { yielded += 1; } });
  assert.equal(size.jsonBytes, Buffer.byteLength(JSON.stringify(rows), "utf8"));
  assert.ok(yielded > 0);
});

test("embedded files count binary bytes without reading content, sharing one binary only once", async () => {
  const file = new Blob(["Dữ liệu gốc"]);
  Object.defineProperty(file, "text", { value: () => { throw new Error("Must not read file payload"); } });
  const buffer = new ArrayBuffer(123);
  const result = await estimateLogicalStorage({ file, again: file, buffer });
  assert.equal(result.jsonBytes, Buffer.byteLength('{"file":{},"again":{},"buffer":{}}'));
  assert.equal(result.fileBytes, file.size + buffer.byteLength);
  assert.equal(result.fileCount, 2);
});

test("measurement can be cancelled before work or between batches", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(estimateLogicalStorage([1, 2, 3], { signal: controller.signal }), { name: "AbortError" });
  const running = new AbortController();
  const rows = Array.from({ length: 50_000 }, (_, id) => ({ id, note: "Payroll" }));
  await assert.rejects(estimateLogicalStorage(rows, {
    signal: running.signal,
    yieldControl: async () => { running.abort(); },
  }), { name: "AbortError" });
});

test("unexpected circular references do not hang the report", async () => {
  const data: { n: number; self?: unknown } = { n: 1 };
  data.self = data;
  assert.equal((await estimateLogicalStorage(data)).jsonBytes, Buffer.byteLength('{"n":1,"self":null}'));
});

test("snapshot statistics distinguish payload count, index count and missing size estimates", () => {
  const result = summarizeSnapshotStorage([
    { isPinned: true, stats: { approxSizeKb: 200 } },
    { isPinned: false, stats: { approxSizeKb: -100 } },
    { isPinned: true },
  ], 4);
  assert.deepEqual(result, { count: 4, indexedCount: 3, pinnedCount: 2, metadataEstimateBytes: 204800, missingEstimates: 2 });
});

test("current data, reset copies, other stored copies and binaries stay separate", () => {
  const result = getStorageTotals([
    { label: "Gross Pay", group: "working", jsonBytes: 100, fileBytes: 50, fileCount: 1, rows: 1 },
    { label: "Originals", group: "originals", jsonBytes: 200, fileBytes: 60, fileCount: 1, rows: null },
    { label: "Other", group: "other", jsonBytes: 300, fileBytes: 0, fileCount: 0, rows: null },
  ]);
  assert.deepEqual(result, { working: 100, originals: 200, other: 300, files: 110, fileCount: 2 });
});

test("report labels unknown browser sizes instead of implying zero and uses decimal GB", () => {
  assert.equal(formatStorageBytes(null), "Chưa đo được");
  assert.equal(formatStorageBytes(0), "0 B");
  assert.equal(formatStorageBytes(7_664_000_000), "7,66 GB");
  assert.equal(formatStorageBytes(7_664_000), "7,66 MB");
});

test("shareable report is explicit about logical sizes and incomplete backup measurements", () => {
  const report: PayrollStorageReport = {
    measuredAt: "2026-10-03T10:00:00Z",
    browser: { usage: 7_664_000_000, quota: 117_567_000_000, indexedDB: null },
    fields: [{ label: "Gross Pay", group: "working", jsonBytes: 1000, fileBytes: 10, fileCount: 1, rows: 2 }],
    snapshots: { count: 30, indexedCount: 30, pinnedCount: 2, metadataEstimateBytes: 100_000, missingEstimates: 0 },
    notices: [],
  };
  const text = formatStorageReport(report);
  assert.match(text, /Tổng website theo trình duyệt: 7,66 GB/);
  assert.match(text, /IndexedDB theo trình duyệt: Chưa đo được/);
  assert.match(text, /chưa quét nội dung bản sao lưu/);
  assert.match(text, /khác dung lượng ổ đĩa/);
  assert.equal(text.includes("PayrollApp_Data"), false);
  assert.equal(text.includes('"jsonBytes"'), false);
});
