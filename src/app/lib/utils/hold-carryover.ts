import { parseMoneyToNumber } from "./data-utils";
import { getDeductionsSourceMonth } from "./deductions-sheet-source";

export type HoldCarryRow = Record<string, unknown>;

export interface PayrollMonth {
  month: number;
  year: number;
  index: number;
  dot: string;
  label: string;
}

export interface HoldCarryoverResult {
  rows: HoldCarryRow[];
  carriedCount: number;
}

const cleanText = (value: unknown) => String(value ?? "").trim();

type HoldOperation = "Hold" | "Cancel" | "Add" | "";

function getHoldOperation(row: HoldCarryRow): HoldOperation {
  const operation = cleanText(row["Nghiệp vụ"]).toUpperCase();
  if (operation === "C" || operation.includes("CANCEL")) return "Cancel";
  if (operation === "A" || operation.includes("ADD")) return "Add";
  if (operation === "H" || operation.includes("HOLD")) return "Hold";

  if (operation) return "";

  const legacyType = `${cleanText(row["Trạng thái trước lưu"])} ${cleanText(
    row._holdStatusBeforeSave,
  )} ${cleanText(row["Trạng thái"])} ${cleanText(row["Sheet Source"])}`.toUpperCase();
  if (legacyType.includes("CANCEL")) return "Cancel";
  if (legacyType.includes("ADD")) return "Add";
  if (legacyType.includes("HOLD")) return "Hold";
  return "";
}

function hasHoldOrigin(row: HoldCarryRow): boolean {
  if (getHoldOperation(row) === "Hold") return true;
  if (
    cleanText(row._holdCarryKey) ||
    cleanText(row._holdCarryOriginId) ||
    cleanText(row._holdStatusBeforeSave).toUpperCase().includes("HOLD") ||
    cleanText(row["Trạng thái trước lưu"]).toUpperCase().includes("HOLD")
  ) {
    return true;
  }

  // A HOLD changed to CANCEL/ADD keeps the source sheet. This is the durable
  // lineage needed to reconcile old data that predates the internal markers.
  const sheetSource = cleanText(row["Sheet Source"]).toUpperCase();
  return /^HOLD(?:\b|[\s._-])/.test(sheetSource);
}

function operationPriority(operation: HoldOperation): number {
  if (operation === "Cancel") return 3;
  if (operation === "Add") return 2;
  if (operation === "Hold") return 1;
  return 0;
}

function timestampValue(row: HoldCarryRow, keys: string[]): number {
  for (const key of keys) {
    const parsed = Date.parse(cleanText(row[key]));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function preferHoldTransactionRow(
  existing: HoldCarryRow,
  incoming: HoldCarryRow,
): HoldCarryRow {
  const existingOperation = getHoldOperation(existing);
  const incomingOperation = getHoldOperation(incoming);
  const existingPriority = operationPriority(existingOperation);
  const incomingPriority = operationPriority(incomingOperation);
  const existingOperationTimestamp = timestampValue(existing, [
    "_holdOperationUpdatedAt",
  ]);
  const incomingOperationTimestamp = timestampValue(incoming, [
    "_holdOperationUpdatedAt",
  ]);

  // Explicit user changes are authoritative. This lets a later ADD/HOLD
  // replace an earlier CANCEL while still protecting CANCEL from a repeated
  // workbook row that only has an upload timestamp.
  if (existingOperationTimestamp !== incomingOperationTimestamp) {
    return incomingOperationTimestamp > existingOperationTimestamp
      ? incoming
      : existing;
  }

  // A resolved operation always wins over a stale HOLD copy. CANCEL has the
  // highest safety priority so an already-cancelled deduction cannot reopen.
  if (incomingPriority !== existingPriority) {
    return incomingPriority > existingPriority ? incoming : existing;
  }

  const existingIsCarry = Boolean(existing?._holdCarryKey);
  const incomingIsCarry = Boolean(incoming?._holdCarryKey);
  if (existingIsCarry !== incomingIsCarry) {
    return existingIsCarry ? incoming : existing;
  }

  const existingTimestamp = timestampValue(existing, [
    "_uploadTimestamp",
    "_holdCarryCreatedAt",
  ]);
  const incomingTimestamp = timestampValue(incoming, [
    "_uploadTimestamp",
    "_holdCarryCreatedAt",
  ]);
  if (existingTimestamp !== incomingTimestamp) {
    return incomingTimestamp > existingTimestamp ? incoming : existing;
  }

  return existing;
}

function amountForOperation(
  amount: unknown,
  operation: HoldOperation,
): number {
  const absoluteAmount = Math.abs(parseMoneyToNumber(amount));
  return operation === "Add" ? absoluteAmount : -absoluteAmount;
}

function canonicalizeHoldTransactionRow(
  row: HoldCarryRow,
): HoldCarryRow {
  const operation = getHoldOperation(row) || "Hold";
  const amount = amountForOperation(row["TOTAL PAYMENT"], operation);
  if (
    row["TOTAL PAYMENT"] === amount &&
    row["Nghiệp vụ"] === operation &&
    row._holdStatusBeforeSave === "Hold"
  ) return row;
  return {
    ...row,
    "TOTAL PAYMENT": amount,
    "Nghiệp vụ": operation,
    _holdStatusBeforeSave: "Hold",
  };
}

export function parsePayrollMonth(value: unknown): PayrollMonth | null {
  const raw = cleanText(value);
  if (!raw) return null;

  const monthFirst = raw.match(
    /(?:TH[AÁ]NG|THANG|THG|T)?\s*(0?[1-9]|1[0-2])\s*[./-]\s*((?:19|20)\d{2})/i,
  );
  const yearFirst = raw.match(
    /((?:19|20)\d{2})\s*[./-]\s*(0?[1-9]|1[0-2])/i,
  );

  const month = monthFirst
    ? Number(monthFirst[1])
    : yearFirst
      ? Number(yearFirst[2])
      : 0;
  const year = monthFirst
    ? Number(monthFirst[2])
    : yearFirst
      ? Number(yearFirst[1])
      : 0;

  if (month < 1 || month > 12 || year < 1900) return null;

  return {
    month,
    year,
    index: year * 12 + month,
    dot: `${String(month).padStart(2, "0")}.${year}`,
    label: `Tháng ${month}/${year}`,
  };
}

export function getNextPayrollMonth(value: unknown): PayrollMonth | null {
  const parsed = parsePayrollMonth(value);
  if (!parsed) return null;

  const month = parsed.month === 12 ? 1 : parsed.month + 1;
  const year = parsed.month === 12 ? parsed.year + 1 : parsed.year;

  return {
    month,
    year,
    index: year * 12 + month,
    dot: `${String(month).padStart(2, "0")}.${year}`,
    label: `Tháng ${month}/${year}`,
  };
}

function getReportMonth(row: HoldCarryRow): PayrollMonth | null {
  return parsePayrollMonth(
    row["Tháng báo cáo"] || row._fileMonth || row["Tháng"],
  );
}

function getArisingMonth(row: HoldCarryRow): PayrollMonth | null {
  const sourceMonth = getDeductionsSourceMonth(
    row["Sheet Source"], row.Note, getReportMonth(row)?.dot,
  );
  if (sourceMonth) return parsePayrollMonth(sourceMonth);
  const parsed = parsePayrollMonth(
    row["Tháng phát sinh"] || row["Trạng thái"] || row["Sheet Source"],
  );
  if (parsed) return parsed;

  // Source sheets commonly use a short label such as "Hold T2" without a
  // year. Resolve it relative to the report month so the raw imported row and
  // its carried copy receive the same arising-month identity.
  const shortMonthSource = [
    row["Tháng phát sinh"],
    row["Trạng thái"],
    row["Sheet Source"],
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const shortMonthMatch = shortMonthSource.match(
    /\bT(?:H[AÁ]NG)?\s*(0?[1-9]|1[0-2])\b/i,
  );
  const reportMonth = getReportMonth(row);
  if (!shortMonthMatch || !reportMonth) return null;

  const month = Number(shortMonthMatch[1]);
  const year = month > reportMonth.month ? reportMonth.year - 1 : reportMonth.year;
  return {
    month,
    year,
    index: year * 12 + month,
    dot: `${String(month).padStart(2, "0")}.${year}`,
    label: `Tháng ${month}/${year}`,
  };
}

function isHoldRow(row: HoldCarryRow): boolean {
  return getHoldOperation(row) === "Hold";
}

function isHoldMergeCandidate(row: HoldCarryRow): boolean {
  const operation = cleanText(row["Nghiệp vụ"]).toUpperCase();
  if (operation.includes("BONUS")) return false;
  return hasHoldOrigin(row);
}

function normalizedPart(value: unknown): string {
  return cleanText(value).replace(/\s+/g, " ").toUpperCase();
}

function firstPresent(row: HoldCarryRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && cleanText(value) !== "") {
      return value;
    }
  }
  return "";
}

export function getMergedHoldOriginalIndexes(
  row: HoldCarryRow,
): number[] {
  const indexes = Array.isArray(row?._holdMergedOriginalIndexes)
    ? row._holdMergedOriginalIndexes
    : [];
  const originalIndex = Number(row?._originalIndex);

  return Array.from(
    new Set([
      ...indexes
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0),
      ...(Number.isInteger(originalIndex) && originalIndex >= 0
        ? [originalIndex]
        : []),
    ]),
  );
}

/**
 * Replaces every source row represented by a merged HOLD with one canonical
 * row. This makes later operation changes persistent instead of revealing the
 * hidden HOLD copy that previously remained in storage.
 */
export function collapseMergedHoldSourceRows({
  rows,
  mergedRow,
  canonicalIndex,
  updatedRow,
  scopedIdentityOf = getHoldScopedIdentity,
}: {
  rows: HoldCarryRow[];
  mergedRow: HoldCarryRow;
  canonicalIndex: number;
  updatedRow: HoldCarryRow;
  scopedIdentityOf?: (row: HoldCarryRow) => string;
}): HoldCarryRow[] {
  const mergedIndexes = getMergedHoldOriginalIndexes(mergedRow).filter(
    (index) => index < rows.length,
  );

  // Legacy/carried rows do not always retain _originalIndex. Fall back to the
  // report-scoped semantic identity so changing one displayed merged HOLD to
  // CANCEL/ADD physically removes every hidden duplicate from storage.
  const scopedIdentity = scopedIdentityOf(mergedRow);
  const semanticDuplicateIndexes = scopedIdentity
    ? rows
        .map((sourceRow, index) =>
          sourceRow && scopedIdentityOf(sourceRow) === scopedIdentity
            ? index
            : -1,
        )
        .filter((index) => index >= 0)
    : [];
  const representedIndexes = Array.from(
    new Set([...mergedIndexes, ...semanticDuplicateIndexes, canonicalIndex]),
  ).filter((index) => index >= 0 && index < rows.length);

  const indexesToRemove = new Set(
    representedIndexes.filter((index) => index !== canonicalIndex),
  );

  return rows
    .map((row, index) => (index === canonicalIndex ? updatedRow : row))
    .filter((_row, index) => !indexesToRemove.has(index));
}

function sourceIdentity(row: HoldCarryRow, arisingMonth: PayrollMonth): string {
  const persistedIdentity = cleanText(
    row._holdCarryOriginId || row._recordId || row.id,
  );
  if (persistedIdentity) return persistedIdentity;

  return [
    row["ID Number"],
    row["Full name"],
    row["Bank Account Number"],
    row.L07,
    row.BU || row.Business,
    row["TOTAL PAYMENT"],
    arisingMonth.dot,
    row.Note,
    row["Sheet Source"],
  ]
    .map(normalizedPart)
    .join("|");
}

/**
 * Business identity of a HOLD. Reporting month is deliberately excluded:
 * a saved carry and the same row imported in the following month's workbook
 * represent one transaction.
 */
export function getHoldSemanticIdentity(row: HoldCarryRow): string {
  const arisingMonth = getArisingMonth(row);
  if (!arisingMonth) return "";

  // A carried HOLD and the same HOLD re-imported from a later workbook are
  // one business transaction even when enrichment/source labels differ.
  const idNumber = firstPresent(row, ["ID Number", "ID NUMBER", "ID", "Mã AE"]);
  const bankAccount = firstPresent(row, [
    "Bank Account Number",
    "BANK ACCOUNT NUMBER",
    "STK AE",
  ]);
  const fullName = firstPresent(row, [
    "Full name",
    "FULL NAME",
    "Full Name",
    "Beneficiary Name",
  ]);
  const l07 = firstPresent(row, ["L07", "Mã ae", "Mã AE"]);
  const employeeIdentity = cleanText(idNumber)
    ? `ID:${normalizedPart(idNumber)}`
    : cleanText(bankAccount)
      ? `BANK:${normalizedPart(bankAccount)}`
      : `NAME:${normalizedPart(fullName)}|L07:${normalizedPart(l07)}`;
  const amount = Math.abs(
    parseMoneyToNumber(
      firstPresent(row, ["TOTAL PAYMENT", "Total Payment", "Payment Amount"]),
    ),
  );

  return [arisingMonth.dot, employeeIdentity, bankAccount, amount, "HOLD"]
    .map(normalizedPart)
    .join("|");
}

/**
 * Storage identity keeps monthly snapshots separate while reusing the exact
 * report-independent HOLD identity above.
 */
export function getHoldScopedIdentity(
  row: HoldCarryRow,
  fallbackReportMonth?: unknown,
): string {
  const reportMonth = getReportMonth(row) || parsePayrollMonth(fallbackReportMonth);
  const semanticIdentity = getHoldSemanticIdentity(row);
  if (!reportMonth || !semanticIdentity) return "";
  return `${reportMonth.dot}|${semanticIdentity}`;
}

interface HoldRowMetadata {
  candidate: boolean;
  canonicalRow: HoldCarryRow;
  operation: HoldOperation;
  reportMonth: PayrollMonth | null;
  identity: string;
  scopedIdentity: string;
}

function createHoldMetadataLookup() {
  const cache = new WeakMap<HoldCarryRow, HoldRowMetadata>();
  return (row: HoldCarryRow): HoldRowMetadata => {
    const cached = cache.get(row);
    if (cached) return cached;
    const candidate = isHoldMergeCandidate(row);
    const canonicalRow = candidate ? canonicalizeHoldTransactionRow(row) : row;
    const reportMonth = getReportMonth(canonicalRow);
    const identity = getHoldSemanticIdentity(canonicalRow);
    const metadata = {
      candidate, canonicalRow, reportMonth, identity,
      operation: getHoldOperation(canonicalRow),
      scopedIdentity: reportMonth && identity ? `${reportMonth.dot}|${identity}` : "",
    };
    cache.set(row, metadata);
    cache.set(canonicalRow, metadata);
    return metadata;
  };
}

/** Reuse immutable-row metadata across edits without retaining old imports in memory. */
export function createHoldTransactionReconciler() {
  const metadataOf = createHoldMetadataLookup();
  return {
    reconcile: (rows: HoldCarryRow[]) => reconcileHoldTransactionRows(rows, metadataOf),
    merge: (rows: HoldCarryRow[]) => mergeDuplicateHoldRows(rows, {}, metadataOf),
    collapse: (options: Parameters<typeof collapseMergedHoldSourceRows>[0]) =>
      collapseMergedHoldSourceRows({ ...options, scopedIdentityOf: row => metadataOf(row).scopedIdentity }),
  };
}

/**
 * Merge a carried HOLD with the same HOLD imported from the report month's
 * source sheet. A duplicate requires an exact semantic match on arising month,
 * employee identity, L07, BU, bank account, sheet source and absolute TOTAL
 * PAYMENT. Reporting month is not part of the business identity. The optional
 * scope is used only when processing the all-month storage collection.
 */
export function mergeDuplicateHoldRows(
  rows: HoldCarryRow[],
  options: { scopeByReportMonth?: boolean } = {},
  metadataOf = createHoldMetadataLookup(),
): HoldCarryRow[] {
  const result: HoldCarryRow[] = [];
  const holdIndexes = new Map<string, number>();

  rows.forEach((row) => {
    if (!row) {
      result.push(row);
      return;
    }
    const metadata = metadataOf(row);
    if (!metadata.candidate) {
      result.push(row);
      return;
    }
    const canonicalRow = metadata.canonicalRow;
    const semanticIdentity = metadata.identity;
    if (!semanticIdentity) {
      result.push(canonicalRow);
      return;
    }

    const reportMonth = options.scopeByReportMonth
      ? metadata.reportMonth
      : null;
    const key = options.scopeByReportMonth
      ? `${reportMonth?.dot || "UNKNOWN"}|${semanticIdentity}`
      : semanticIdentity;
    const existingIndex = holdIndexes.get(key);
    if (existingIndex === undefined) {
      holdIndexes.set(key, result.length);
      result.push(canonicalRow);
      return;
    }

    const existing = result[existingIndex];
    const preferred = preferHoldTransactionRow(existing, canonicalRow);
    const preferredOperation = getHoldOperation(preferred) || "Hold";
    const duplicateCount =
      Number(existing?._holdMergedDuplicateCount || 1) +
      Number(row?._holdMergedDuplicateCount || 1);
    const mergedOriginalIndexes = Array.from(
      new Set([
        ...getMergedHoldOriginalIndexes(existing),
        ...getMergedHoldOriginalIndexes(canonicalRow),
      ]),
    );

    result[existingIndex] = {
      ...preferred,
      "TOTAL PAYMENT": amountForOperation(
        preferred["TOTAL PAYMENT"],
        preferredOperation,
      ),
      "Nghiệp vụ": preferredOperation,
      _holdMergedDuplicateCount: duplicateCount,
      ...(mergedOriginalIndexes.length > 1
        ? { _holdMergedOriginalIndexes: mergedOriginalIndexes }
        : {}),
      // Preserve the HOLD lineage after the transaction becomes CANCEL/ADD so
      // future source-file copies are reconciled with the resolved row.
      _holdStatusBeforeSave: "Hold",
    };
  });

  return result;
}

/**
 * Reconciles the full multi-month transaction history. Rows are first merged
 * inside each report month. Once a HOLD is resolved as CANCEL/ADD, only later
 * stale HOLD copies of that exact transaction are removed. Resolved ADD and
 * CANCEL rows remain as report-month history and must stay visible.
 */
export function reconcileHoldTransactionRows(
  rows: HoldCarryRow[],
  metadataOf = createHoldMetadataLookup(),
): HoldCarryRow[] {
  const mergedRows = mergeDuplicateHoldRows(rows, {
    scopeByReportMonth: true,
  }, metadataOf);
  const resolvedMonthByIdentity = new Map<string, number>();

  mergedRows.forEach((row) => {
    if (!row) return;
    const { candidate, operation, reportMonth, identity } = metadataOf(row);
    if (!candidate) return;
    if (operation !== "Cancel" && operation !== "Add") return;
    if (!reportMonth || !identity) return;

    const resolvedMonth = resolvedMonthByIdentity.get(identity);
    if (resolvedMonth === undefined || reportMonth.index < resolvedMonth) {
      resolvedMonthByIdentity.set(identity, reportMonth.index);
    }
  });

  return mergedRows.filter((row) => {
    if (!row) return true;
    const { candidate, operation, reportMonth, identity } = metadataOf(row);
    if (!candidate) return true;
    if (!reportMonth || !identity) return true;

    const resolvedMonth = resolvedMonthByIdentity.get(identity);
    return (
      operation !== "Hold" ||
      resolvedMonth === undefined ||
      reportMonth.index <= resolvedMonth
    );
  });
}

/**
 * Deletes the exact raw source rows represented by displayed rows. A merged
 * HOLD can represent two or more raw rows, so all of its original indexes are
 * removed together. The semantic fallback is report-scoped to avoid deleting
 * the same employee/amount from another month.
 */
export function removeSelectedHoldSourceRows(
  sourceRows: HoldCarryRow[],
  displayedRows: HoldCarryRow[],
): { rows: HoldCarryRow[]; removedCount: number } {
  const indexesToDelete = new Set<number>();
  const idsToDelete = new Set<string>();
  const fallbackKeys = new Set<string>();

  displayedRows.filter(Boolean).forEach((row) => {
    const indexes = getMergedHoldOriginalIndexes(row).filter(
      (index) => index < sourceRows.length,
    );
    indexes.forEach((index) => indexesToDelete.add(index));

    const rowIds = [row._recordId, row.id, row._holdCarryKey]
      .map(cleanText)
      .filter(Boolean);
    rowIds.forEach((id) => idsToDelete.add(id));

    if (indexes.length === 0 && rowIds.length === 0) {
      const scopedIdentity = getHoldScopedIdentity(row);
      if (scopedIdentity) fallbackKeys.add(scopedIdentity);
    }
  });

  const rows = sourceRows.filter((row, index) => {
    if (indexesToDelete.has(index)) return false;
    const rowIds = [row?._recordId, row?.id, row?._holdCarryKey]
      .map(cleanText)
      .filter(Boolean);
    if (rowIds.some((id) => idsToDelete.has(id))) return false;
    const scopedIdentity = getHoldScopedIdentity(row);
    return !scopedIdentity || !fallbackKeys.has(scopedIdentity);
  });

  return { rows, removedCount: sourceRows.length - rows.length };
}

export function removeHoldCarryoverFromReport(
  rows: HoldCarryRow[],
  reportMonth: unknown,
): HoldCarryRow[] {
  const current = parsePayrollMonth(reportMonth);
  if (!current) return rows;

  return rows.filter((row) => {
    const carriedFrom = parsePayrollMonth(row?._holdCarryFromReportMonth);
    return carriedFrom?.index !== current.index;
  });
}

export function getEligibleHoldRowsForReport(
  rows: HoldCarryRow[],
  reportMonth: unknown,
): HoldCarryRow[] {
  const current = parsePayrollMonth(reportMonth);
  if (!current) return [];

  const uniqueRows = new Map<string, HoldCarryRow>();

  reconcileHoldTransactionRows(rows).forEach((row) => {
    if (!row || !isHoldRow(row)) return;
    const rowReportMonth = getReportMonth(row);
    const arisingMonth = getArisingMonth(row);
    if (
      rowReportMonth?.index !== current.index ||
      !arisingMonth ||
      arisingMonth.index > current.index
    ) {
      return;
    }

    const mergeKey = getHoldSemanticIdentity(row);
    if (!uniqueRows.has(mergeKey)) {
      uniqueRows.set(mergeKey, row);
    }
  });

  return Array.from(uniqueRows.values());
}

/**
 * Copies eligible HOLD entries into the next reporting month for Deductions.
 * The original arising month is retained and repeated saves are idempotent.
 */
export function carryEligibleHoldsToNextMonth({
  sourceRows,
  existingRows,
  reportMonth,
  createdAt = new Date().toISOString(),
}: {
  sourceRows: HoldCarryRow[];
  existingRows: HoldCarryRow[];
  reportMonth: unknown;
  createdAt?: string;
}): HoldCarryoverResult {
  const current = parsePayrollMonth(reportMonth);
  const next = getNextPayrollMonth(reportMonth);
  if (!current || !next) {
    return { rows: existingRows, carriedCount: 0 };
  }

  // Re-saving a period refreshes only the rows previously generated from that
  // period. Imported and manually-entered rows in the next month stay intact.
  const retainedRows = reconcileHoldTransactionRows(
    removeHoldCarryoverFromReport(existingRows, current.dot),
  );

  const existingCarryKeys = new Set(
    retainedRows.map((row) => cleanText(row?._holdCarryKey)).filter(Boolean),
  );
  const existingSemanticKeys = new Set<string>();

  retainedRows.forEach((row) => {
    if (!row || !isHoldMergeCandidate(row)) return;
    const rowReportMonth = getReportMonth(row);
    const arisingMonth = getArisingMonth(row);
    if (
      rowReportMonth?.index === next.index &&
      arisingMonth &&
      arisingMonth.index <= current.index
    ) {
      existingSemanticKeys.add(getHoldSemanticIdentity(row));
    }
  });

  const carriedRows: HoldCarryRow[] = [];

  const resolvedSemanticKeys = new Set<string>();
  retainedRows.forEach((row) => {
    if (!row || !isHoldMergeCandidate(row)) return;
    const operation = getHoldOperation(row);
    const rowReportMonth = getReportMonth(row);
    if (
      (operation === "Cancel" || operation === "Add") &&
      rowReportMonth &&
      rowReportMonth.index <= current.index
    ) {
      resolvedSemanticKeys.add(getHoldSemanticIdentity(row));
    }
  });

  getEligibleHoldRowsForReport(sourceRows, current.dot).forEach((row) => {
    const arisingMonth = getArisingMonth(row);
    if (!arisingMonth) return;

    const originId = sourceIdentity(row, arisingMonth);
    const carryKey = `${originId}::HOLD-CARRY::${next.dot}`;
    const rowSemanticKey = getHoldSemanticIdentity(row);
    if (
      existingCarryKeys.has(carryKey) ||
      existingSemanticKeys.has(rowSemanticKey) ||
      resolvedSemanticKeys.has(rowSemanticKey)
    ) {
      return;
    }

    const source = { ...row };
    delete source._originalIndex;
    delete source._dimmed;
    delete source._isPastMonthHoldOrCancel;
    delete source._originalTinhTrangThanhToan;

    carriedRows.push({
      ...source,
      id: carryKey,
      _recordId: carryKey,
      _holdCarryKey: carryKey,
      _holdCarryOriginId: originId,
      _holdCarryFromReportMonth: current.dot,
      _holdCarryCreatedAt: createdAt,
      _holdCarrySaved: true,
      _holdStatusBeforeSave: "Hold",
      "Tháng": next.dot,
      _fileMonth: next.dot,
      "Tháng báo cáo": next.dot,
      "Tháng phát sinh": arisingMonth.dot,
      "Trạng thái": arisingMonth.dot,
      "Nghiệp vụ": "Hold",
      "TOTAL PAYMENT": -Math.abs(parseMoneyToNumber(source["TOTAL PAYMENT"])),
      "Tình trạng thanh toán": `Pending từ tháng ${arisingMonth.dot}`,
      "No.": retainedRows.length + carriedRows.length + 1,
      No: retainedRows.length + carriedRows.length + 1,
    });
    existingCarryKeys.add(carryKey);
    existingSemanticKeys.add(rowSemanticKey);
  });

  return {
    rows: reconcileHoldTransactionRows(
      carriedRows.length > 0
        ? [...retainedRows, ...carriedRows]
        : retainedRows,
    ),
    carriedCount: carriedRows.length,
  };
}
