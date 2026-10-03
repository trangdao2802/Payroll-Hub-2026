import { parseMoneyToNumber } from "./data-utils";
import { resolveL07BuFromAeCode } from "./center-utils";
import { hasRequiredDeductionsFields, type DeductionsRow, type IndexedDeductionsRow } from "./deductions-row-validation";
import { getDeductionsSourceMonth, resolveDeductionsSheetSource } from "./deductions-sheet-source";

function deriveDeductionsRow(row: DeductionsRow, sourceIndex: number, reportMonth: string): IndexedDeductionsRow {
  const currentPeriodParts = reportMonth.split(".");
  const currentMonthNum = parseInt(currentPeriodParts[0], 10) || 3;
  const currentYearNum = parseInt(currentPeriodParts[1], 10) || 2026;

  const val = parseMoneyToNumber(row["TOTAL PAYMENT"] || 0);
  const rawSource = String(row["Sheet Source"] || "");

  // Reporting month belongs to the source workbook; arising month belongs to its sheet.
  let originMonthNum = currentMonthNum;
  let originYearNum = currentYearNum;

  const originMonthStr = String(
    row["Tháng"] || row["_fileMonth"] || row["Tháng báo cáo"] || "",
  ).trim();

  const matchMonthYear = originMonthStr.match(
    /(?:THÁNG|THANG|T)?\s*(\d{1,2})[./\- ]\s*(\d{4})/i,
  );
  const matchMonthDotYear = originMonthStr.match(/(\d{2})\.(\d{4})/);
  if (matchMonthYear) {
    originMonthNum = parseInt(matchMonthYear[1], 10);
    originYearNum = parseInt(matchMonthYear[2], 10);
  } else if (matchMonthDotYear) {
    originMonthNum = parseInt(matchMonthDotYear[1], 10);
    originYearNum = parseInt(matchMonthDotYear[2], 10);
  } else {
    const originMatch = originMonthStr.match(/(\d+)/);
    if (originMatch) {
      originMonthNum = parseInt(originMatch[0], 10);
    }
    if (originMonthNum === 11 || originMonthNum === 12) {
      originYearNum = currentYearNum === 2025 ? 2025 : (currentYearNum === 2026 ? 2025 : currentYearNum);
    } else if (
      originMonthNum > currentMonthNum &&
      (currentYearNum === 2025 || currentYearNum === 2026)
    ) {
      originYearNum = currentYearNum - 1;
    } else {
      originYearNum = currentYearNum;
    }
  }
  const finalReportingMonthStr = `${String(originMonthNum).padStart(2, "0")}.${originYearNum}`;

  // Resolve the originating month from Sheet Source before any persisted derived value.
  let itemMonthNum = originMonthNum;
  let itemYearNum = originYearNum;

  const rawTrangThaiOrPhatSinh = String(row["Tháng phát sinh"] || row["Trạng thái"] || "").trim().toUpperCase();
  const rawSourceUpper = rawSource.toUpperCase();
  const isBonusSummer = rawSourceUpper.includes("BONUS") && (
    rawSourceUpper.includes("SUMMER") ||
    rawSourceUpper.includes("INSTRUCTOR") ||
    rawSourceUpper.includes("INTROSTION")
  );

  if (isBonusSummer) {
    // Force Tháng phát sinh to be the reporting month (Tháng báo cáo)
    itemMonthNum = originMonthNum;
    itemYearNum = originYearNum;
  } else {
    const sourceMonth = getDeductionsSourceMonth(rawSource, row.Note, finalReportingMonthStr);
    const customMmYyyyMatch = rawTrangThaiOrPhatSinh.match(/^(\d{2})\.(\d{4})$/);
    if (sourceMonth) {
      [itemMonthNum, itemYearNum] = sourceMonth.split(".").map(Number);
    } else if (customMmYyyyMatch) {
      itemMonthNum = parseInt(customMmYyyyMatch[1], 10);
      itemYearNum = parseInt(customMmYyyyMatch[2], 10);
    } else {
      const ssMatch =
        String(row["Note"] || "").match(/T[HÁNG]*\s*(\d+)/i) ||
        rawTrangThaiOrPhatSinh.match(/T[HÁNG]*\s*(\d+)/i);
      if (ssMatch) {
        itemMonthNum = parseInt(ssMatch[1], 10);
      }
      if (itemMonthNum > originMonthNum && originMonthNum <= 6 && (originYearNum === 2025 || originYearNum === 2026)) {
        itemYearNum = originYearNum - 1;
      }
    }
  }

  const computedThangPhatSinh = `${String(itemMonthNum).padStart(2, "0")}.${itemYearNum}`;

  // Determine 'Nghiệp vụ' operation type
  let type = "Add";
  const upNvu = String(row["Nghiệp vụ"] || "")
    .trim()
    .toUpperCase();
  const rawTrangThai = String(row["Tháng phát sinh"] || row["Trạng thái"] || "")
    .trim()
    .toUpperCase();
  const operationLabel = upNvu || rawTrangThai;
  if (operationLabel.includes("HOLD") || operationLabel === "H") {
    type = "Hold";
  } else if (operationLabel.includes("CANCEL") || operationLabel === "C") {
    type = "Cancel";
  } else if (operationLabel.includes("ADD") || operationLabel === "A") {
    type = "Add";
  } else if (operationLabel.includes("BONUS") || operationLabel === "B" || operationLabel.includes("⏩") || operationLabel.includes("⏯")) {
    type = "⏩";
  } else {
    type = val >= 0 ? "Add" : "Hold";
  }

  let tinhTrangThanhToan = "";
  if (type.toUpperCase() === "HOLD") {
    tinhTrangThanhToan = `Pending từ tháng ${computedThangPhatSinh}`;
  } else if (type.toUpperCase() === "ADD" || type === "⏩" || type === "⏯") {
    tinhTrangThanhToan = `Đã thanh toán tại tháng ${finalReportingMonthStr}`;
  } else if (type.toUpperCase() === "CANCEL") {
    tinhTrangThanhToan = `Cancel từ tháng ${finalReportingMonthStr}`;
  }

  const isPastMonthHoldOrCancel =
    (type.toUpperCase() === "HOLD" || type.toUpperCase() === "CANCEL") &&
    (itemYearNum * 12 + itemMonthNum < originYearNum * 12 + originMonthNum);

  let l07 = String(row["L07"] || row["Mã ae"] || "").trim();
  let bu = String(row["BU"] || "").trim();
  const resolved = resolveL07BuFromAeCode(l07);
  if (resolved) {
    l07 = resolved.l07;
    if (!bu) bu = resolved.bu;
  }

  return {
    ...row,
    "L07": l07,
    "BU": bu,
    _originalIndex: sourceIndex,
    _originalTinhTrangThanhToan: row["Tình trạng thanh toán"] !== undefined ? String(row["Tình trạng thanh toán"]) : "",
    "Tháng báo cáo": finalReportingMonthStr,
    "Tháng phát sinh": computedThangPhatSinh,
    "Trạng thái": computedThangPhatSinh,
    "Tình trạng thanh toán": tinhTrangThanhToan,
    "Nghiệp vụ": type,
    Note: row["Note"] !== undefined ? String(row["Note"]) : "",
    "Diễn giải": row["Diễn giải"] !== undefined ? String(row["Diễn giải"]) : "",
    _dimmed: isPastMonthHoldOrCancel,
    _isPastMonthHoldOrCancel: isPastMonthHoldOrCancel,
  };
}

/** Cache immutable source rows; reindex after deletes and rebuild when the period changes. */
export function createDeductionsRowProjector(reportMonth: string) {
  const cache = new WeakMap<DeductionsRow, { sourceIndex: number; row: IndexedDeductionsRow }>();
  return (sourceRows: readonly unknown[]): IndexedDeductionsRow[] => {
    const rows: IndexedDeductionsRow[] = [];
    sourceRows.forEach((value, sourceIndex) => {
      if (!hasRequiredDeductionsFields(value)) return;
      const source = value as DeductionsRow;
      let cached = cache.get(source);
      if (!cached || cached.sourceIndex !== sourceIndex) {
        cached = { sourceIndex, row: deriveDeductionsRow(source, sourceIndex, reportMonth) };
        cache.set(source, cached);
      }
      rows.push(cached.row);
    });
    return rows;
  };
}

export function getDeductionsHeaders(headers: string[]): string[] {
  // Ensure headers include our target computed columns and are in the correct order
  let newHeaders = [...headers];
  newHeaders = newHeaders.filter(
    (h) => h !== "Mã GD" && h !== "Trạng thái công nợ",
  );
  const targetHeaders = [
    "Tháng báo cáo",
    "Nghiệp vụ",
    "Tháng phát sinh",
    "Tình trạng thanh toán",
  ];
  targetHeaders.forEach((th) => {
    if (!newHeaders.includes(th)) {
      newHeaders.push(th);
    }
  });

  const totalPaymentIdx = newHeaders.indexOf("TOTAL PAYMENT");
  let baseHeaders: string[] = [];
  if (totalPaymentIdx !== -1) {
    baseHeaders = newHeaders.slice(0, totalPaymentIdx + 1);
  } else {
    baseHeaders = [
      "No.",
      "Tháng báo cáo",
      "BU",
      "L07",
      "ID Number",
      "Full name",
      "Bank Account Number",
      "TAX CODE",
      "Contract No",
      "TOTAL PAYMENT",
    ];
  }

  const reorderedHeaders = [
    ...baseHeaders.filter(
      (h) =>
        h !== "TÊN FILE" &&
        h !== "Sheet Source" &&
        h !== "Note" &&
        h !== "Nghiệp vụ" &&
        h !== "Trạng thái" &&
        h !== "Tháng phát sinh" &&
        h !== "Tình trạng thanh toán" &&
        h !== "Mã ae",
    ),
    "Sheet Source",
    "Nghiệp vụ",
    "Tháng phát sinh",
    "Tình trạng thanh toán",
    "Note",
  ];
  return reorderedHeaders;
}

/** Keep display-row references stable so editing one operation renders only that row. */
export function createDeductionsDisplayProjector() {
  const cache = new WeakMap<DeductionsRow, DeductionsRow>();
  return (row: DeductionsRow): DeductionsRow => {
    const cached = cache.get(row);
    if (cached) return cached;
    const source = resolveDeductionsSheetSource(row["Sheet Source"], row.Note);
    const operation = String(row["Nghiệp vụ"] || "").toUpperCase().trim();
    const amount = parseMoneyToNumber(row["TOTAL PAYMENT"] || 0);
    const negative = operation.includes("HOLD") || operation === "H" || operation.includes("CANCEL") || operation === "C";
    const positive = operation.includes("ADD") || operation === "A" || operation === "" || operation === "B" || operation.includes("BONUS") || operation === "⏩" || operation === "⏯";
    const projected = {
      ...row,
      "ID Number": row["ID Number"] ?? "",
      "Sheet Source": source.sheetSource,
      _needsSheetSourceNote: source.needsSourceMonthNote,
      "TOTAL PAYMENT": negative ? -Math.abs(amount) : positive ? Math.abs(amount) : row["TOTAL PAYMENT"],
    };
    cache.set(row, projected);
    return projected;
  };
}
