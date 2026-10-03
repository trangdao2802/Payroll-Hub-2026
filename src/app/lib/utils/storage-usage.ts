/** Read-only diagnostics. Logical JSON/file sizes are not IndexedDB disk sizes. */
export interface LogicalStorageSize {
  jsonBytes: number;
  fileBytes: number;
  fileCount: number;
}

export interface StorageFieldUsage extends LogicalStorageSize {
  label: string;
  group: "working" | "originals" | "other";
  rows: number | null;
}

export interface SnapshotStorageUsage {
  count: number;
  indexedCount: number;
  pinnedCount: number;
  metadataEstimateBytes: number;
  missingEstimates: number;
}

export interface PayrollStorageReport {
  measuredAt: string;
  browser: { usage: number | null; quota: number | null; indexedDB: number | null };
  fields: StorageFieldUsage[] | null;
  snapshots: SnapshotStorageUsage | null;
  notices: string[];
}

const FIELD_LABELS: Record<string, string> = {
  TableOriginals: "Bản gốc để khôi phục bảng",
  Sheet1_AE: "Gross Pay",
  Hold_AE: "Deductions",
  Hold_AE_Source: "Nguồn Deductions",
  Bank_North_AE: "Batch Payment",
  BankExport: "Bank Export",
  Final_AE: "Kết quả lương",
  SoSanh_AE: "Đối chiếu lương",
  AuditReport: "Audit",
  CustomReport: "Báo cáo tùy chỉnh",
  Timesheet_Roster: "Roster Timesheet",
  Master_Roster: "Roster Master",
  Q_Staff: "Danh sách nhân viên",
  Q_Salary_Scale: "Thang lương",
  Q_Cache: "Dữ liệu xử lý Timesheet",
  Timesheets: "Kết quả Timesheet",
  Q_CheckTAs: "Check TAs",
  Q_TeacherHours: "Teacher Hours",
  Q_BonusData: "Dữ liệu thưởng",
  Timesheet_RosterEditHistory: "Lịch sử sửa Roster",
  TA_Employee_Summary: "Tổng hợp TA theo nhân viên",
  TA_Center_Summary: "Tổng hợp TA theo trung tâm",
  Timesheet_InputList: "Danh sách file Timesheet",
  Ae_Global_Inputs: "Danh sách file Master",
  SavedBal_PayrollTrial: "Trial Balance đã lưu",
  SavedRows_HoldAdd: "Deductions theo kỳ",
  TransactionMonthCache: "Batch Payment theo kỳ",
};

const encoder = new TextEncoder();
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Đã dừng đo dung lượng", "AbortError");
}

/** Count UTF-8 JSON and embedded binary bytes without reading file contents.
 * Visit every row, yielding between short batches instead of stringifying a
 * whole payroll. Ancestors guard cycles; shared JSON objects still count twice.
 */
export async function estimateLogicalStorage(
  value: unknown,
  options: { signal?: AbortSignal; yieldControl?: () => Promise<void> } = {},
): Promise<LogicalStorageSize> {
  const size: LogicalStorageSize = { jsonBytes: 0, fileBytes: 0, fileCount: 0 };
  const ancestors = new WeakSet<object>();
  const binaries = new WeakSet<object>();
  const keySizes = new Map<string, number>();
  let visited = 0;
  let lastYield = performance.now();

  function* visit(item: unknown): Generator<void, number> {
    if (++visited % 128 === 0 && performance.now() - lastYield >= 8) {
      yield;
      lastYield = performance.now();
    }
    if (item === null || item === undefined) return 4;
    if (typeof item === "string") return encoder.encode(JSON.stringify(item)).byteLength;
    if (typeof item === "number") return String(Number.isFinite(item) ? item : null).length;
    if (typeof item === "boolean") return item ? 4 : 5;
    if (typeof item !== "object") return 4;
    if (item instanceof Date) return encoder.encode(JSON.stringify(item)).byteLength;
    if (item instanceof Blob || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
      if (!binaries.has(item)) {
        binaries.add(item);
        size.fileBytes += item instanceof Blob ? item.size : item.byteLength;
        size.fileCount += 1;
      }
      return 2;
    }
    if (ancestors.has(item)) return 4;
    ancestors.add(item);
    let bytes = 2;
    if (Array.isArray(item)) {
      bytes += Math.max(0, item.length - 1);
      for (let index = 0; index < item.length; index++) bytes += yield* visit(item[index]);
    } else {
      let entries = 0;
      for (const key of Object.keys(item)) {
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        let keyBytes = keySizes.get(key);
        if (keyBytes === undefined) {
          keyBytes = encoder.encode(JSON.stringify(key)).byteLength;
          if (keySizes.size < 1000) keySizes.set(key, keyBytes);
        }
        bytes += keyBytes + 1 + (entries++ ? 1 : 0);
        bytes += yield* visit(child);
      }
    }
    ancestors.delete(item);
    return bytes;
  }

  const iterator = visit(value);
  while (true) {
    checkAbort(options.signal);
    const next = iterator.next();
    if (next.done) {
      size.jsonBytes = next.value;
      return size;
    }
    await (options.yieldControl || pause)();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function summarizeSnapshotStorage(index: unknown, storedCount: number): SnapshotStorageUsage {
  const entries = Array.isArray(index) ? index : [];
  let pinnedCount = 0;
  let metadataEstimateBytes = 0;
  let missingEstimates = 0;
  for (const entry of entries) {
    if (!isRecord(entry)) { missingEstimates += 1; continue; }
    if (entry.isPinned === true) pinnedCount += 1;
    const kb = isRecord(entry.stats) ? entry.stats.approxSizeKb : undefined;
    if (typeof kb === "number" && Number.isFinite(kb) && kb >= 0) metadataEstimateBytes += kb * 1024;
    else missingEstimates += 1;
  }
  return { count: storedCount, indexedCount: entries.length, pinnedCount, metadataEstimateBytes, missingEstimates };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Abort an upgrade rather than creating a database on a machine with no data.
function openExistingDatabase(signal?: AbortSignal): Promise<IDBDatabase> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PayrollApp");
    let finished = false;
    const finish = (error?: Error, db?: IDBDatabase) => {
      if (finished) { db?.close(); return; }
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (db) resolve(db);
    };
    const onAbort = () => finish(new DOMException("Đã dừng đo dung lượng", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("Kho dữ liệu đang bận. Hãy thử đo lại.")), 8000);
    signal?.addEventListener("abort", onAbort, { once: true });
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => finish(undefined, request.result);
    request.onerror = () => finish(new Error("Chưa đọc được kho dữ liệu Payroll trên trình duyệt này."));
    request.onblocked = () => finish(new Error("Kho dữ liệu đang bận. Hãy thử đo lại."));
  });
}

function readItem(db: IDBDatabase, store: string, key: IDBValidKey) {
  return requestResult<unknown>(db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function measurePayrollStorage(options: {
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
} = {}): Promise<PayrollStorageReport> {
  const { signal, onProgress } = options;
  const report: PayrollStorageReport = {
    measuredAt: new Date().toISOString(),
    browser: { usage: null, quota: null, indexedDB: null },
    fields: null,
    snapshots: null,
    notices: [],
  };
  checkAbort(signal);
  onProgress?.("Đọc tổng dung lượng trình duyệt…");
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const details = (estimate as StorageEstimate & { usageDetails?: { indexedDB?: number } }).usageDetails;
      report.browser = { usage: estimate.usage ?? null, quota: estimate.quota ?? null, indexedDB: details?.indexedDB ?? null };
    } else report.notices.push("Trình duyệt này không cung cấp tổng dung lượng website.");
  } catch {
    report.notices.push("Chưa đọc được tổng dung lượng website từ trình duyệt.");
  }
  checkAbort(signal);
  let db: IDBDatabase | undefined;
  try {
    db = await openExistingDatabase(signal);
    if (!db.objectStoreNames.contains("app_data")) throw new Error("Chưa có dữ liệu Payroll đã lưu trên trình duyệt này.");
    const keys = await requestResult(db.transaction("app_data", "readonly").objectStore("app_data").getAllKeys());
    const fields: StorageFieldUsage[] = [];
    const hasMeta = keys.includes("PayrollApp_Data:meta");

    const addField = async (field: string, value: unknown, other = false) => {
      checkAbort(signal);
      onProgress?.(`Đang đo ${FIELD_LABELS[field] || "cấu hình và dữ liệu khác"}…`);
      const size = await estimateLogicalStorage(value, { signal });
      const rows = Array.isArray(value) ? value.length : isRecord(value) && Array.isArray(value.data) ? value.data.length : null;
      fields.push({ ...size, rows, label: other ? "Bản dữ liệu cũ / mục lưu khác" : FIELD_LABELS[field] || "Cấu hình và dữ liệu khác", group: other ? "other" : field === "TableOriginals" ? "originals" : "working" });
      await pause();
    };
    // Only current records are read. Snapshot payloads can be many GB and are
    // deliberately excluded; metadata below is clearly marked as approximate.
    for (const key of keys) {
      checkAbort(signal);
      const value = await readItem(db, "app_data", key);
      if (key === "PayrollApp_Data:meta" || (key === "PayrollApp_Data" && !hasMeta)) {
        if (isRecord(value)) for (const field of Object.keys(value)) await addField(field, value[field]);
      } else if (typeof key === "string" && key.startsWith("PayrollApp_Data:data:")) {
        await addField(key.slice("PayrollApp_Data:data:".length), value);
      } else await addField("", value, true);
    }
    report.fields = fields;
    checkAbort(signal);
    onProgress?.("Đọc thống kê các bản sao lưu…");
    try {
      const count = db.objectStoreNames.contains("snapshots_data")
        ? await requestResult(db.transaction("snapshots_data", "readonly").objectStore("snapshots_data").count()) : 0;
      const index = db.objectStoreNames.contains("snapshots_meta")
        ? await readItem(db, "snapshots_meta", "snapshots_index") : null;
      report.snapshots = summarizeSnapshotStorage(index, count);
      if (count !== report.snapshots.indexedCount) report.notices.push("Số bản sao trong kho khác số bản sao trong danh sách lịch sử; ước tính lịch sử chưa bao quát tất cả.");
    } catch {
      report.notices.push("Chưa đọc được thống kê bản sao lưu.");
    }
  } catch (error) {
    checkAbort(signal);
    report.notices.push(error instanceof Error ? error.message : "Chưa đọc được dữ liệu Payroll đã lưu.");
  } finally {
    db?.close();
  }
  checkAbort(signal);
  report.measuredAt = new Date().toISOString();
  return report;
}

export function getStorageTotals(fields: StorageFieldUsage[]) {
  return fields.reduce((totals, field) => {
    totals[field.group] += field.jsonBytes;
    totals.files += field.fileBytes;
    totals.fileCount += field.fileCount;
    return totals;
  }, { working: 0, originals: 0, other: 0, files: 0, fileCount: 0 });
}

/** Decimal units match the Storage pane. vi-VN separates thousands with dots. */
export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "Chưa đo được";
  const unit = bytes >= 1_000_000_000 ? "GB" : bytes >= 1_000_000 ? "MB" : bytes >= 1000 ? "KB" : "B";
  const divisor = unit === "GB" ? 1_000_000_000 : unit === "MB" ? 1_000_000 : unit === "KB" ? 1000 : 1;
  return `${(bytes / divisor).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ${unit}`;
}

/** The shareable report contains only sizes/counts; never include record values,
 * filenames, period labels, snapshot titles, account identifiers or raw keys.
 */
export function formatStorageReport(report: PayrollStorageReport): string {
  const lines = [
    "BÁO CÁO DUNG LƯỢNG PAYROLL HUB",
    `Thời điểm: ${new Date(report.measuredAt).toLocaleString("vi-VN")}`,
    `Tổng website theo trình duyệt: ${formatStorageBytes(report.browser.usage)}`,
    `IndexedDB theo trình duyệt: ${formatStorageBytes(report.browser.indexedDB)}`,
    `Hạn mức lưu trên máy: ${formatStorageBytes(report.browser.quota)}`,
  ];
  if (report.fields !== null) {
    const totals = getStorageTotals(report.fields);
    lines.push(
      `Dữ liệu hiện tại (JSON UTF-8): ${formatStorageBytes(totals.working)}`,
      `Bản gốc để khôi phục (JSON UTF-8): ${formatStorageBytes(totals.originals)}`,
      `Tệp nhị phân trong dữ liệu hiện tại: ${formatStorageBytes(totals.files)} (${totals.fileCount} tệp/khối)`,
      `Bản dữ liệu cũ / mục lưu khác (JSON UTF-8): ${formatStorageBytes(totals.other)}`,
      "Các mục lớn nhất (JSON + tệp, ước tính):",
      ...[...report.fields].sort((a, b) => b.jsonBytes + b.fileBytes - a.jsonBytes - a.fileBytes).slice(0, 8)
        .map((field) => `- ${field.label}: ${formatStorageBytes(field.jsonBytes + field.fileBytes)}${field.rows === null ? "" : `; ${field.rows.toLocaleString("vi-VN")} dòng/mục`}`),
    );
  } else lines.push("Chưa đo được dữ liệu hiện tại.");
  if (report.snapshots) {
    lines.push(`Bản sao lưu: ${report.snapshots.count}; trong danh sách: ${report.snapshots.indexedCount}; đã ghim: ${report.snapshots.pinnedCount}`,
      `Ước tính cũ từ lịch sử bản sao: ${formatStorageBytes(report.snapshots.metadataEstimateBytes)}; ${report.snapshots.missingEstimates} bản thiếu ước tính`);
  }
  lines.push("Lưu ý: JSON + tệp là dung lượng logic, khác dung lượng ổ đĩa. Ước tính lịch sử chưa gồm đầy đủ tệp trong bản sao; chưa quét nội dung bản sao lưu.", ...report.notices);
  return lines.join("\n");
}
