/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AppData } from "../../types";
import {
  generateUUID,
  getHoldRowAmount,
  parseMoneyToNumber,
  removeVietnameseTones,
} from "./data-utils";
import { classifyHoldOperation, parseMonthPeriod } from "./bulk-payment-analytics";
import { markTransactionGenerated } from "./transaction-activity";

export interface ReconciliationTotals {
  actual: number;
  expected: number;
  variance: number;
  grossPayTotal: number;
  deductionsTotal: number;
}

type ReconciliationSource = Pick<
  AppData,
  "Sheet1_AE" | "Hold_AE" | "Bank_North_AE"
> & { globalMonth?: string };

function readFirst(row: any, keys: string[]): unknown {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function matchesMonthValue(
  value: unknown,
  reportMonth: string,
  allowMissing: boolean,
): boolean {
  const target = parseMonthPeriod(reportMonth);
  if (!target) return false;
  const raw = String(value ?? "").trim();
  if (!raw) return allowMissing;
  return parseMonthPeriod(raw, target)?.key === target.key;
}

function holdRowMatchesReportMonth(row: any, reportMonth: string): boolean {
  return matchesMonthValue(
    readFirst(row, ["Tháng báo cáo", "_fileMonth", "Tháng", "Month"]),
    reportMonth,
    true,
  );
}

function bankRowMatchesReportMonth(row: any, reportMonth: string): boolean {
  const target = parseMonthPeriod(reportMonth);
  if (!target) return false;
  const fileMonth = String(row?._fileMonth ?? "").trim();
  if (fileMonth && parseMonthPeriod(fileMonth, target)?.key === target.key) {
    return true;
  }
  return matchesMonthValue(
    readFirst(row, ["Tháng báo cáo", "_fileMonth", "Tháng"]),
    reportMonth,
    true,
  );
}

export interface DeductionReportEntry {
  type: "HOLD" | "ADD" | "CANCEL";
  amount: number;
  contribution: number;
  isPastMonth: boolean;
}

// Keep the displayed amount separate from its effect on payroll: CANCEL is display-only.
export function getDeductionReportEntry(row: any, reportMonth: string): DeductionReportEntry | null {
  if (!holdRowMatchesReportMonth(row, reportMonth)) return null;
  if (String(row?.["Lệnh"] || "").trim() === "-" || row?._dimmed) return null;
  const source = String(row?.["Sheet Source"] || "").toUpperCase();
  if (source.includes("SHEET 1") || source.includes("INTERN") || source.includes("REPORT")) return null;

  // The editable Nghiệp vụ value takes precedence over the imported sheet/status.
  const type = classifyHoldOperation(row);
  const target = parseMonthPeriod(reportMonth);
  if (!type || !target) return null;
  const occurrence = parseMonthPeriod(readFirst(row, ["Tháng phát sinh", "Trạng thái"]), target);
  const isDifferentMonth = Boolean(occurrence && occurrence.key !== target.key);
  const isPastMonth = Boolean(occurrence && (occurrence.year < target.year ||
    (occurrence.year === target.year && occurrence.month < target.month)));
  const amount = (type === "ADD" ? 1 : -1) * Math.abs(getHoldRowAmount(row));
  return {
    type,
    amount,
    contribution: type === "CANCEL" || (type === "HOLD" && isDifferentMonth) ? 0 : amount,
    isPastMonth,
  };
}

export function getDeductionContribution(row: any, reportMonth: string): number {
  return getDeductionReportEntry(row, reportMonth)?.contribution ?? 0;
}

export function calculateReconciliationTotals(
  appData: ReconciliationSource,
  reportMonth = appData.globalMonth || "03.2026",
): ReconciliationTotals {
  const grossPayTotal = (appData.Sheet1_AE?.data || []).reduce(
    (sum: number, row: any) => {
      const id = String(
        row?.["ID Number"] || row?.["Mã AE"] || row?.["Mã ae"] || "",
      ).trim();
      if (
        !id ||
        !matchesMonthValue(row?.["Tháng báo cáo"], reportMonth, false)
      ) {
        return sum;
      }
      return (
        sum +
        parseMoneyToNumber(
          row?.["TOTAL PAYMENT"] ??
            row?.["Payment Amount"] ??
            row?.["Grand Total"] ??
            row?.["GRAND TOTAL"] ??
            row?.["Total Payment"] ??
            0,
        )
      );
    },
    0,
  );

  const deductionsTotal = (appData.Hold_AE?.data || []).reduce(
    (sum: number, row: any) => sum + getDeductionContribution(row, reportMonth),
    0,
  );

  const actual = (appData.Bank_North_AE?.data || []).reduce(
    (sum: number, row: any) =>
      bankRowMatchesReportMonth(row, reportMonth)
        ? sum + parseMoneyToNumber(row?.["TOTAL PAYMENT"] ?? 0)
        : sum,
    0,
  );
  const expected = grossPayTotal + deductionsTotal;

  return {
    actual,
    expected,
    variance: actual - expected,
    grossPayTotal,
    deductionsTotal,
  };
}

export function buildBankExportRowsForMonth(
  appData: AppData,
  reportMonth = appData.globalMonth || "03.2026",
): any[] {
  const sourceRows = (appData.Bank_North_AE?.data || []).filter((row: any) =>
    bankRowMatchesReportMonth(row, reportMonth),
  );
  const sheetRows = appData.Sheet1_AE?.data || [];
  const byId = new Map<string, any>();
  const byName = new Map<string, any>();

  sheetRows.forEach((row: any) => {
    const info = {
      bank: String(row?.["Bank Name"] || "").trim(),
      month: String(row?.["Tháng"] || "").trim(),
    };
    const id = String(row?.["ID Number"] || row?.["Mã AE"] || "").trim();
    const name = removeVietnameseTones(row?.["Full name"] || "")
      .trim()
      .toUpperCase();
    if (id) byId.set(id, info);
    if (name) byName.set(name, info);
  });

  return sourceRows.map((row: any, index: number) => {
    const id = String(row?.["ID Number"] || row?.["Mã AE"] || "").trim();
    const name = removeVietnameseTones(row?.["Full name"] || "")
      .trim()
      .toUpperCase();
    const sheetInfo = byId.get(id) || byName.get(name) || {};
    const monthValue = String(
      row?._fileMonth || row?.["Tháng"] || sheetInfo.month || "",
    ).trim();
    const bankValue = String(
      row?._fileBank || sheetInfo.bank || "",
    )
      .trim()
      .toUpperCase();

    return {
      id: generateUUID(),
      "Payment Serial Number": index + 1,
      "Tháng báo cáo": reportMonth,
      "Transaction Type Code": "BT",
      "Payment Type": "",
      "Customer Reference No": "",
      "Beneficiary Account No.": String(row?.["Bank Account Number"] || ""),
      "Beneficiary Name": removeVietnameseTones(row?.["Full name"] || ""),
      "Document ID": String(
        row?.["ID Number"] ||
          row?.["Mã AE"] ||
          row?.["Mã ae"] ||
          row?.["Document ID"] ||
          row?.CCCD ||
          row?.ID ||
          "",
      ),
      "Place of Issue": "",
      "ID Issuance Date": "",
      "Beneficiary Bank Swift Code / IFSC Code": "",
      "Transaction Currency": "VND",
      "Payment Amount": parseMoneyToNumber(row?.["TOTAL PAYMENT"] || 0),
      "Charge Type": "OUR",
      "Payment details": `Intern ${bankValue} salary ${monthValue}`
        .replace(/\s+/g, " ")
        .trim(),
      "Beneficiary - Nick Name": "",
      "Beneficiary Addr. Line 1": "",
      "Beneficiary Addr. Line 2": "",
    };
  });
}

export function cacheActiveTransactionMonth(appData: AppData): AppData {
  const normalizedMonth = parseMonthPeriod(appData.globalMonth || "");
  if (!normalizedMonth) return appData;

  const period = normalizedMonth.key;
  return {
    ...appData,
    TransactionMonthCache: {
      activePeriod: period,
      months: {
        ...(appData.TransactionMonthCache?.months || {}),
        [period]: {
          table: appData.BankExport,
          activity: appData.TransactionActivity,
        },
      },
    },
  };
}

export function syncReportingMonthReconciliation(
  appData: AppData,
  reportMonth: string,
): AppData {
  const normalizedMonth = parseMonthPeriod(reportMonth);
  if (!normalizedMonth) return appData;
  const month = `${String(normalizedMonth.month).padStart(2, "0")}.${normalizedMonth.year}`;
  const generatedAt = new Date().toISOString();
  const totals = calculateReconciliationTotals(appData, month);
  const period = normalizedMonth.key;
  const months = {...appData.TransactionMonthCache?.months};
  const currentTable = appData.BankExport || {headers: [], data: []};
  const groups = new Map<string, any[]>();
  for (const row of currentTable.data) {
    const rowPeriod = parseMonthPeriod(row['Tháng báo cáo'] || row._fileMonth)?.key;
    if (!rowPeriod) continue;
    const group = groups.get(rowPeriod) || [];
    group.push(row);
    groups.set(rowPeriod, group);
  }
  for (const [rowPeriod, rows] of groups) {
    months[rowPeriod] = {
      table: groups.size === 1 ? currentTable : {...currentTable, data: rows},
      activity: appData.TransactionActivity,
    };
  }
  // Keep an intentionally emptied month empty when navigating away and back.
  if (!currentTable.data.length && appData.TransactionMonthCache?.activePeriod) {
    months[appData.TransactionMonthCache.activePeriod] = {
      table: currentTable, activity: appData.TransactionActivity,
    };
  }
  const existing = months[period];
  const refreshedRows = buildBankExportRowsForMonth(appData, month);
  // Only untouched generated data may be refreshed from Bank AE, and only
  // when that month still exists in the source. Never erase a cached historical
  // Batch Payment month merely because Bank North was reloaded without it.
  const keepExisting = Boolean(existing) && (
    existing?.activity?.lastAction !== "generated" ||
    refreshedRows.length === 0
  );
  const table = keepExisting && existing
    ? existing.table
    : { ...currentTable, data: refreshedRows };
  const activity = keepExisting && existing
    ? existing.activity
    : markTransactionGenerated(appData, generatedAt);

  return {
    ...appData,
    globalMonth: month,
    BankExport: table,
    TransactionMonthCache: {
      activePeriod: period,
      months: {...months, [period]: {table, activity}},
    },
    ReconciliationByMonth: {
      ...(appData.ReconciliationByMonth || {}),
      [month]: { ...totals, generatedAt },
    },
    TransactionActivity: activity,
    updatedAt: generatedAt,
  };
}
