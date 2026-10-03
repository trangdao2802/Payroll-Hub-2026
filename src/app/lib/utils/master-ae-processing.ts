/* eslint-disable @typescript-eslint/no-explicit-any */
import { toast } from "sonner";
import type { AppData } from "../../types";
import type { OriginalField } from "./table-originals";
import type { MasterWorkbookPayload } from "../../workers/masterImport.worker";
import {
  applyPivotMktTypeCache, buildPivotFromAppData, getPivotDataMonths,
  readPivotMktTypeCache, PIVOT_CACHE_VERSION, updatePivotMktTypeCache,
  writePivotMktTypeCache,
} from "./pivot-utils";
import {
  parseMoneyToNumber, isMoneyColumn, removeVietnameseTones,
  formatIdNumber, generateUUID,
} from "./master-data-utils";
import {
  isBankMasterSheetName, isHoldMasterSheetName, isRosterMasterSheetName,
  isSheetOneMasterSheetName, normalizeMasterSheetName,
} from "./master-sheet-utils";
import {
  getHoldScopedIdentity, mergeDuplicateHoldRows, reconcileHoldTransactionRows,
} from "./hold-carryover";
import { resolveDeductionsSheetSource } from "./deductions-sheet-source";
import { hasRequiredDeductionsFields } from "./deductions-row-validation";
import { resolveGrossPayTotal } from "./gross-pay";
import {
  mapL07, getCenterInfoByAECode,
  resolveMultiOrSingleAE,
  resolveMktAndCenterL07, resolveSummerBonusCenterL07,
} from "./center-utils";
import { parseDurationToHours } from "../schemas/excel-schema";
import { normalizeGrossPaySpecialCenter } from "./master-special-centers";

function cleanIDNumber(val: any): string {
  return formatIdNumber(val);
}

function cleanFullName(val: any): string {
  if (val === undefined || val === null) return "";
  const str = String(val).trim();
  return removeVietnameseTones(str).toUpperCase();
}
export function parseMonthFromFileName(fileName: string, globalMonth?: string): string | null {
  if (!fileName) return null;
  // Match patterns like 1.2026, 01.2026, 12.2026, or with dashes/slashes 01-2026
  const match = fileName.match(/\b(0?[1-9]|1[0-2])[./-](20\d{2})\b/);
  if (match) {
    const m = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    return `${m < 10 ? "0" + m : m}.${y}`;
  }
  // Try backup pattern: Month name or single digits like T1.2026 or Thang 1
  const tMatch = fileName.match(/(Th\w*|T|Month\s*)(0?[1-9]|1[0-2])\b/i);
  if (tMatch) {
    const m = parseInt(tMatch[2], 10);
    const ref = globalMonth || "03.2026";
    const refParts = ref.split(".");
    const currentMonthNum = parseInt(refParts[0], 10) || 3;
    const currentYearNum = parseInt(refParts[1], 10) || 2026;
    let y = currentYearNum;
    // Explicitly force 2025 for months 11 and 12 as requested
    if (m === 11 || m === 12) {
      y = 2025;
    } else if (m > currentMonthNum) {
      y = currentYearNum - 1;
    }
    return `${m < 10 ? "0" + m : m}.${y}`;
  }
  return null;
}

export interface AERow {
  id: string;
  name: string;
  fileObj?: File | null;
  url?: string;
  status: string;
  bank?: string;
  month?: string;
  columnMapping?: Record<string, string>;
}

export interface MasterAEProcessingContext {
  appData: AppData;
  updateAppData: (updater: (previous: AppData) => AppData, saveToHistory?: boolean, persistImmediately?: boolean, sourceFields?: readonly OriginalField[]) => void;
  preparedMasterFiles: Map<string, MasterWorkbookPayload>;
  parseMasterFileInWorker: (file: File, isMktFile: boolean, targetFields: string[]) => Promise<MasterWorkbookPayload>;
  masterAeFields: string[];
  setIsProcessing: (value: boolean) => void;
  setProgress: (value: number) => void;
  setProcessingMessage: (value: string) => void;
  onComplete: () => void;
}

// Keep workbook processing outside the React component so its control flow
// can be checked independently of rendering and hook compilation.
export async function processMasterAEData(
  {
    appData, updateAppData, preparedMasterFiles, parseMasterFileInWorker,
    masterAeFields, setIsProcessing, setProgress, setProcessingMessage, onComplete,
  }: MasterAEProcessingContext,
  targetOverride?: AERow[],
  preparedOverride?: Map<string, MasterWorkbookPayload>,
) {
  const targets = (targetOverride || appData.Ae_Global_Inputs).filter(
    (item) => item.fileObj,
  );
  if (targets.length === 0) {
    toast.error("Vui lòng chọn ít nhất một File AE Final!");
    return;
  }

  const normalizeMonth = (m: any) => {
    const str = String(m || "").trim().toUpperCase();
    if (!str) return "";
    const match = str.match(/(?:THÁNG|THANG|T)?\s*(\d{1,2})[./\- ]\s*(\d{4})/i);
    if (match) {
      const mm = match[1].padStart(2, "0");
      const yyyy = match[2];
      return `${mm}.${yyyy}`;
    }
    const parts = str.split(/[./]/);
    if (parts.length === 2) {
      const mm = parts[0].trim().padStart(2, "0");
      const yyyy = parts[1].trim();
      if (mm.length === 2 && yyyy.length === 4) {
        return `${mm}.${yyyy}`;
      }
    }
    return str;
  };

  const getColIndex = (
    headers: string[],
    targetField: string,
    mapping?: Record<string, string>,
    fuzzyKeywords: string[] = [],
  ) => {
    if (mapping && mapping[targetField]) {
      const mappedHeader = mapping[targetField].toUpperCase().trim();
      const idx = headers.findIndex(
        (h) => String(h).toUpperCase().trim() === mappedHeader,
      );
      if (idx !== -1) return idx;
    }

    // 1. Exact Match on targetField
    let idx = headers.findIndex((h: any) => String(h).toUpperCase().trim() === targetField.toUpperCase());
    if (idx !== -1) return idx;

    // 2. Exact Match on fuzzy keywords
    if (fuzzyKeywords && fuzzyKeywords.length > 0) {
      idx = headers.findIndex((h: any) => {
        const hUp = String(h).toUpperCase().trim();
        return fuzzyKeywords.some((k) => hUp === k.toUpperCase().trim());
      });
      if (idx !== -1) return idx;
    }

    // 3. Contains Match on targetField
    idx = headers.findIndex((h: any) => String(h).toUpperCase().trim().includes(targetField.toUpperCase()));
    if (idx !== -1) return idx;

    // 4. Contains Match on fuzzy keywords
    if (fuzzyKeywords && fuzzyKeywords.length > 0) {
      return headers.findIndex((h: any) => {
        const hUp = String(h).toUpperCase().trim();
        return fuzzyKeywords.some((k) => hUp.includes(k.toUpperCase().trim()));
      });
    }
    return -1;
  };

  setIsProcessing(true);
  setProgress(0);
  setProcessingMessage("Đang chuẩn bị xử lý dữ liệu AE...");
  await new Promise((resolve) => setTimeout(resolve, 10));

  const totalFiles = targets.length;
  let processedFiles = 0;

  try {
    const bankData: any[] = [];
    const sheet1Data: any[] = [];
    const holdData: any[] = [];
    const soSanhAeData: any[] = [];
    const rosterDataToAppend: any[] = [];
    const statusById = new Map<string, string>();
    const preparedFiles =
      preparedOverride || preparedMasterFiles;

    const sheet1Headers = [
      "No.",
      "Tháng báo cáo",
      "L07",
      "Business",
      "ID Number",
      "Full name",
      "Salary Scale",
      "From",
      "To",
      "Bank Account Number",
      "Bank Name",
      "CITAD code",
      "TAX CODE",
      "Contract No",
      "CHARGE TO LXO",
      "CHARGE TO EC",
      "CHARGE TO PT-DEMO",
      "Charge MKT Local",
      "CHARGE TO OTHER",
      "Charge Renewal Projects",
      "Charge Discovery Camp",
      "Charge Summer Outing",
      "Charge Summer Instructors",
      "Extra Summer Instructors",
      "TOTAL PAYMENT",
      "TÊN FILE",
      "Center",
    ];

    let foundAnySheet = false;
    const aeMap = appData.AE_Map;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      if (!item.fileObj) continue;

      const itemMonth = item.month || parseMonthFromFileName(item.name || item.fileObj.name) || appData.globalMonth || "03.2026";

      processedFiles++;
      setProgress(Math.round((processedFiles / totalFiles) * 100));
      setProcessingMessage(
        `Đang xử lý file ${i + 1}/${targets.length}: ${item.name}...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      const isMktFile =
        String(item.bank || "").toUpperCase().includes("MKT") ||
        String(item.name || "").toUpperCase().includes("MKT") ||
        String(item.name || "").toUpperCase().includes("MARKETING");

      const effectiveBank = isMktFile ? "MKT LOCAL NORTH" : item.bank || "";

      try {
        const parsedWorkbook =
          preparedFiles.get(item.id) ||
          (await parseMasterFileInWorker(
            item.fileObj,
            isMktFile,
            masterAeFields,
          ));
        preparedMasterFiles.set(item.id, parsedWorkbook);
        const itemColumnMapping =
          item.columnMapping && Object.keys(item.columnMapping).length > 0
            ? item.columnMapping
            : parsedWorkbook.mapping;
        let fileProcessedSuccessfully = false;

        if (parsedWorkbook.sheetNames.length === 0) {
          throw new Error("File không có sheet nào.");
        }

        for (const parsedSheet of parsedWorkbook.sheets) {
          const { sheetName, rows } = parsedSheet;
          try {
            if (rows.length <= 1) continue;

            const normalizedSheetName = normalizeMasterSheetName(sheetName);
            let sheetProcessed = false;

            const isRosterSheet = isRosterMasterSheetName(sheetName);
            const isBankSheet = isBankMasterSheetName(sheetName);
            const isHoldSheet = isHoldMasterSheetName(sheetName);
            const isSheetOneSheet = isSheetOneMasterSheetName(sheetName);

            if (isRosterSheet) {
              let headerRowIndex = -1;
              for (let r = 0; r < Math.min(30, rows.length); r++) {
                const rowStr = rows[r]
                  .map((c) => String(c || "").toUpperCase())
                  .join(" ");
                if (
                  (rowStr.includes("FULL NAME") ||
                    rowStr.includes("HỌ VÀ TÊN") ||
                    rowStr.includes("HỌ TÊN") ||
                    rowStr.includes("TÊN") ||
                    rowStr.includes("NAME")) &&
                  (rowStr.includes("ID") ||
                    rowStr.includes("MÃ NV") ||
                    rowStr.includes("MANV") ||
                    rowStr.includes("DATE") ||
                    rowStr.includes("NGÀY") ||
                    rowStr.includes("TYPE") ||
                    rowStr.includes("CLASS"))
                ) {
                  headerRowIndex = r;
                  break;
                }
              }

              if (headerRowIndex === -1) {
                headerRowIndex = 0;
              }

              foundAnySheet = true;
              sheetProcessed = true;
              const h = rows[headerRowIndex].map((c) => String(c || "").trim());

              const iCenter = getColIndex(h, "Center", {}, ["CENTER", "TRUNG TÂM", "MÃ AE", "AE CODE", "AE", "LOCATION"]);
              const iId = getColIndex(h, "ID Number", {}, ["ID", "MÃ NV", "MANV", "TEACHER ID", "EMP ID", "CODE"]);
              const iName = getColIndex(h, "Full name", {}, ["FULL NAME", "NAME", "HỌ VÀ TÊN", "TÊN", "HỌ TÊN"]);
              const iDate = getColIndex(h, "Date", {}, ["DATE", "NGÀY", "TK_DATE", "SESSION DATE", "DAY"]);
              const iType = getColIndex(h, "Type", {}, ["TYPE", "TASK TYPE", "CODE", "LOẠI", "ACTIVITY", "TASKTYPE"]);
              const iClass = getColIndex(h, "Class", {}, ["CLASS", "LỚP", "CLASS CODE", "MÃ LỚP"]);
              const iFrom = getColIndex(h, "From", {}, ["FROM", "START", "START TIME", "TỪ"]);
              const iTo = getColIndex(h, "To", {}, ["TO", "END", "END TIME", "ĐẾN"]);
              const iDuration = getColIndex(h, "Duration", {}, ["DURATION", "HOURS", "SỐ GIỜ", "GIỜ", "TK_DURATION", "TOTAL HOURS"]);
              const iNotes = getColIndex(h, "Notes", {}, ["NOTES", "NOTE", "GHI CHÚ", "REMARKS"]);
              const iChargeMkt = getColIndex(h, "Charge To Center MKT", {}, ["CHARGE TO CENTER MKT", "CHARGE TO CENTER", "CHARGETOCENTER"]);

              for (let r = headerRowIndex + 1; r < rows.length; r++) {
                const row = rows[r];
                if (!row || row.every((cell) => cell === "")) continue;

                const rawCenter = iCenter !== -1 && row[iCenter] !== undefined ? String(row[iCenter]).trim() : "";
                const info = getCenterInfoByAECode(rawCenter);
                const l07 = info?.l07 || rawCenter || "UNKNOWN";
                const business = info?.bus || "";

                const ma_nv = iId !== -1 && row[iId] !== undefined ? String(row[iId]).trim() : "";
                const full_name = iName !== -1 && row[iName] !== undefined ? String(row[iName]).trim() : "";
                const ngay = iDate !== -1 && row[iDate] !== undefined ? String(row[iDate]).trim() : "";
                const type = iType !== -1 && row[iType] !== undefined ? String(row[iType]).trim() : "";
                const className = iClass !== -1 && row[iClass] !== undefined ? String(row[iClass]).trim() : "";
                const gio_vao = iFrom !== -1 && row[iFrom] !== undefined ? String(row[iFrom]).trim() : "";
                const gio_ra = iTo !== -1 && row[iTo] !== undefined ? String(row[iTo]).trim() : "";

                const rawDuration = iDuration !== -1 && row[iDuration] !== undefined ? row[iDuration] : "";
                const duration = parseDurationToHours(rawDuration);

                const notes = iNotes !== -1 && row[iNotes] !== undefined ? String(row[iNotes]).trim() : "";
                const chargeToCenterMkt = iChargeMkt !== -1 && row[iChargeMkt] !== undefined ? String(row[iChargeMkt]).trim() : "";
                const pivotCenter = chargeToCenterMkt || rawCenter;
                const pivotCenterInfo = getCenterInfoByAECode(pivotCenter);
                const pivotL07 = pivotCenterInfo?.l07 || mapL07(pivotCenter) || l07;
                const pivotBusiness = pivotCenterInfo?.bus || business;

                rosterDataToAppend.push({
                  _rowId: generateUUID(),
                  _sourceFile: item.name || "",
                  center: rawCenter,
                  l07: pivotL07,
                  business: pivotBusiness,
                  ma_nv,
                  full_name,
                  ngay,
                  type,
                  class: className,
                  gio_vao,
                  gio_ra,
                  duration,
                  durationHours: duration,
                  notes,
                  chargeToCenterMkt,
                  chargeToCenterCode: chargeToCenterMkt,
                  employeeId: ma_nv,
                  fullName: full_name,
                  maAE: rawCenter,
                  date: ngay,
                  taskType: type,
                  classCode: className,
                  from: gio_vao,
                  to: gio_ra,
                  month: normalizeMonth(itemMonth),
                  _fileMonth: normalizeMonth(itemMonth),
                  isMktLocal: true
                });
              }
            } else if (
              !isMktFile &&
              !isRosterSheet &&
              (isBankSheet ||
                normalizedSheetName.includes("MKT") ||
                normalizedSheetName.includes("MARKETING"))
            ) {
              let headerRowIndex = -1;
              for (let r = 0; r < Math.min(30, rows.length); r++) {
                const rowStr = rows[r]
                  .map((c) => String(c || "").toUpperCase())
                  .join(" ");
                if (
                  (rowStr.includes("FULL NAME") ||
                    rowStr.includes("HỌ VÀ TÊN") ||
                    rowStr.includes("TÊN")) &&
                  (rowStr.includes("ACCOUNT") ||
                    rowStr.includes("SỐ TÀI KHOẢN") ||
                    rowStr.includes("TÀI KHOẢN") ||
                    rowStr.includes("STK"))
                ) {
                  headerRowIndex = r;
                  break;
                }
              }

              if (headerRowIndex !== -1) {
                foundAnySheet = true;
                sheetProcessed = true;
                const h = rows[headerRowIndex].map((c) =>
                  String(c || "").trim(),
                );

                const iS = getColIndex(h, "No", itemColumnMapping, [
                  "NO",
                  "STT",
                  "NO.",
                ]);
                const iId = getColIndex(h, "ID Number", itemColumnMapping, [
                  "ID",
                  "CMND",
                  "MÃ NV",
                ]);
                const iN = getColIndex(h, "Full name", itemColumnMapping, [
                  "NAME",
                  "TÊN",
                  "FULL NAME",
                  "HỌ VÀ TÊN",
                ]);
                const iA = getColIndex(
                  h,
                  "Bank Account Number",
                  itemColumnMapping,
                  ["ACCOUNT", "TÀI KHOẢN", "STK"],
                );
                const iT = getColIndex(
                  h,
                  "TOTAL PAYMENT",
                  itemColumnMapping,
                  ["TOTAL", "TỔNG", "THỰC NHẬN"],
                );
                const iP = getColIndex(
                  h,
                  "Payment details",
                  itemColumnMapping,
                  ["DETAILS", "NỘI DUNG", "DIỄN GIẢI", "DESCRIPTION"],
                );
                // const iBank = getColIndex(
                //   h,
                //   "Bank Name",
                //   itemColumnMapping,
                //   ["BANK", "NGÂN HÀNG", "TEN NGAN HANG", "TÊN NGÂN HÀNG"],
                // );
                const iCenter = getColIndex(h, "Center", itemColumnMapping, [
                  "CENTER",
                  "COST CENTER",
                  "TRUNG TÂM",
                  "AE CODE",
                  "AE",
                  "MÃ AE",
                ]);

                for (let r = headerRowIndex + 1; r < rows.length; r++) {
                  const row = rows[r];
                  if (!row || row.every((cell) => cell === "")) continue;

                  const rawTP =
                    iT !== -1 && row[iT] !== undefined ? row[iT] : "";
                  const t = parseMoneyToNumber(rawTP);
                  const nameVal =
                    iN !== -1 && row[iN] !== undefined
                      ? cleanFullName(row[iN])
                      : "";

                  // Force Bank Account Number to be string
                  let acc = "";
                  if (iA !== -1) {
                    const rawAcc = row[iA];
                    acc =
                      rawAcc !== undefined && rawAcc !== null
                        ? String(rawAcc).replace(/\s/g, "")
                        : "";
                    if (
                      typeof rawAcc === "number" &&
                      (acc.includes("E") || acc.includes("e"))
                    ) {
                      acc = rawAcc.toLocaleString("fullwide", {
                        useGrouping: false,
                      });
                    }
                  }

                  const idVal =
                    iId !== -1 && row[iId] !== undefined
                      ? cleanIDNumber(row[iId])
                      : "";

                  let type = "Liên ngân hàng";
                  if (!acc) type = "⚠️ Thiếu STK";
                  else if (acc.length < 6 || acc.length > 25)
                    type = "⚠️ Sai độ dài";
                  else if (acc.startsWith("0") || acc.startsWith("10"))
                    type = "Nội bộ VCB";

                  const rawCenterVal =
                    iCenter !== -1 && row[iCenter] !== undefined
                      ? String(row[iCenter]).trim()
                      : "";

                  const resolvedAe = resolveMultiOrSingleAE(rawCenterVal, aeMap);
                  let l07 = resolvedAe.l07 || rawCenterVal;
                  let business = resolvedAe.bus || "";

                  // OVERRIDE FOR MKT
                  if (rawCenterVal.toUpperCase().trim() === "MKT LOCAL NORTH") {
                    l07 = "MKT LOCAL NORTH";
                    business = "AHN";
                  } else {
                    const mktRes2 = resolveMktAndCenterL07(rawCenterVal, "", item.name || "", l07);
                    if (mktRes2.isMktLocal) {
                      l07 = mktRes2.l07;
                      business = mktRes2.business;
                    }
                  }

                  bankData.push({
                    No: iS !== -1 && row[iS] !== undefined ? row[iS] : "",
                    "ID Number": idVal,
                    "Full name": nameVal,
                    L07: l07,
                    Business: business,
                    "Bank Account Number": acc,
                    "TOTAL PAYMENT": t,
                    "LOẠI CK": type,
                    "Payment details":
                      iP !== -1 && row[iP] !== undefined
                        ? String(row[iP]).trim()
                        : "",
                    "TÊN FILE": item.name || "",
                    _fileBank: effectiveBank,
                    _fileMonth: itemMonth,
                  });
                }
              }
            }

            if (
              !isMktFile &&
              (normalizedSheetName.includes("SUMMER") ||
                normalizedSheetName.includes("BONUS"))
            ) {
              let headerRowIndex = -1;
              for (let r = 0; r < Math.min(50, rows.length); r++) {
                const rowStr = rows[r].map(c => String(c || "").toUpperCase()).join(" ");
                if (rowStr.includes("BONUS") && (rowStr.includes("INSTRUCTOR") || rowStr.includes("CENTER"))) {
                  headerRowIndex = r;
                  break;
                }
              }

              if (headerRowIndex !== -1) {
                foundAnySheet = true;
                sheetProcessed = true;
                const h = rows[headerRowIndex].map(c => String(c || "").trim());

                const iCenter = getColIndex(h, "Center", itemColumnMapping, ["NORTH CENTER", "DEPARTMENT NAME", "CENTER", "CENTER NOTE", "CENTERS", "TRUNG TÂM", "MÃ AE", "L07"]);
                const iName = getColIndex(h, "Full name", itemColumnMapping, ["HỌ & TÊN INSTRUCTOR", "NAME", "INSTRUCTOR"]);
                const iId = getColIndex(h, "ID Number", itemColumnMapping, ["SỐ CCCD INSTRUCTOR", "ID NUMBER", "CCCD"]);
                const iBonus = getColIndex(h, "TOTAL PAYMENT", itemColumnMapping, ["BONUS"]);

                for (let r = headerRowIndex + 1; r < rows.length; r++) {
                  const row = rows[r];
                  if (!row || row.every(cell => cell === "")) continue;

                  const rawBonus = iBonus !== -1 ? row[iBonus] : 0;
                  const bonusVal = parseMoneyToNumber(rawBonus);
                  if (bonusVal === 0) continue;

                  const idVal = iId !== -1 ? cleanIDNumber(row[iId]) : "";
                  const nameVal = iName !== -1 ? cleanFullName(row[iName]) : "";
                  const centerVal = iCenter !== -1 ? String(row[iCenter] || "").trim() : "";

                  // Resolve Center to BU/L07
                  let l07 = centerVal;
                  let business = "";
                  const centerKey = centerVal.toLowerCase();
                  const mappedSummerCenter = aeMap[centerKey]?.name || centerVal;
                  const resolvedSummerCenter = resolveSummerBonusCenterL07(mappedSummerCenter);
                  l07 = resolvedSummerCenter.l07;
                  business = resolvedSummerCenter.business || aeMap[centerKey]?.bus || "";

                  sheet1Data.push({
                    "No.": sheet1Data.length + 1,
                    "Tháng báo cáo": itemMonth,
                    "ID Number": idVal,
                    "Full name": nameVal,
                    "Extra Summer Instructors": bonusVal,
                    "CHARGE TO EXTRA SUMMER INSTRUCTORS": bonusVal,
                    "TOTAL PAYMENT": bonusVal,
                    "BU": business,
                    "Business": business,
                    "L07": l07,
                    "_rawAE": centerVal,
                    "Sheet Source": sheetName,
                    "Note": `Summer Bonus - ${centerVal}`,
                    "TÊN FILE": item.name || "",
                    _fileMonth: itemMonth
                  });
                }
              }
            }

            if (
              !isMktFile &&
              (isHoldSheet || normalizedSheetName.includes("ADD"))
            ) {
              let headerRowIndex = -1;
              for (let r = 0; r < Math.min(30, rows.length); r++) {
                const rowStr = rows[r]
                  .map((c) => String(c || "").toUpperCase())
                  .join(" ");
                if (
                  (rowStr.includes("FULL NAME") ||
                    rowStr.includes("HỌ VÀ TÊN") ||
                    rowStr.includes("TÊN") ||
                    rowStr.includes("CMND")) &&
                  (rowStr.includes("SỐ TÀI KHOẢN") ||
                    rowStr.includes("TÀI KHOẢN") ||
                    rowStr.includes("STK") ||
                    rowStr.includes("TOTAL PAYMENT") ||
                    rowStr.includes("THỰC NHẬN") ||
                    rowStr.includes("TỔNG") ||
                    rowStr.includes("CENTER") ||
                    rowStr.includes("SỐ TIỀN") ||
                    rowStr.includes("PHÁT SINH"))
                ) {
                  headerRowIndex = r;
                  break;
                }
              }

              foundAnySheet = true;
              sheetProcessed = true;

              // Identify file month
              let fileMonthNum = -1;
              const monthStr = appData.globalMonth || "03.2026";
              const lowerMonth = String(monthStr).toLowerCase().trim();
              const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
              for (let i = 0; i < monthNames.length; i++) {
                if (lowerMonth.includes(monthNames[i])) {
                  fileMonthNum = i + 1;
                  break;
                }
              }
              if (fileMonthNum === -1) {
                const match = lowerMonth.match(/(?:t|tháng|thang)\s*(\d{1,2})/);
                if (match) fileMonthNum = parseInt(match[1], 10);
                else {
                  const match2 = lowerMonth.match(/(\d{1,2})\/\d{4}/);
                  if (match2) fileMonthNum = parseInt(match2[1], 10);
                  else {
                    const match3 = lowerMonth.match(/\b(0?[1-9]|1[0-2])\b/);
                    if (match3) fileMonthNum = parseInt(match3[1], 10);
                  }
                }
              }

              const getRowShouldNegate = (noteValue: string) => {
                let rowShouldNegate = false;
                const sourceResolution = resolveDeductionsSheetSource(
                  sheetName,
                  noteValue,
                );
                const sheetSource = sourceResolution.sheetSource;

                // Keep the existing amount/sign rule tied to the original
                // sheet name. Note only resolves the displayed source month
                // when a HOLD sheet combines multiple months.
                if (isHoldSheet && fileMonthNum !== -1) {
                  const ssMatch = normalizedSheetName.match(
                    /(?:T|THANG|HOLD T|HOLD THANG|HOLD)\s*(\d{1,2})/,
                  );
                  if (ssMatch) {
                    if (parseInt(ssMatch[1], 10) === fileMonthNum) rowShouldNegate = true;
                  } else {
                    const allNumbers = normalizedSheetName.match(/\d+/g);
                    if (allNumbers) {
                      for (const m of allNumbers) {
                        if (parseInt(m, 10) === fileMonthNum) {
                          rowShouldNegate = true;
                          break;
                        }
                      }
                    }
                  }
                }
                return {
                  rowShouldNegate,
                  sheetSource,
                  needsSheetSourceNote:
                    sourceResolution.needsSourceMonthNote,
                };
              };

              if (headerRowIndex !== -1) {
                // Header found - use dynamic mapping
                const h = rows[headerRowIndex].map((c) =>
                  String(c || "").trim(),
                );
                const iId = getColIndex(h, "ID Number", itemColumnMapping, [
                  "ID",
                  "CMND",
                  "MÃ NV",
                  "CĂN CƯỚC",
                ]);
                const iN = getColIndex(h, "Full name", itemColumnMapping, [
                  "NAME",
                  "TÊN",
                  "NV",
                  "GIÁO VIÊN",
                  "KHÁCH HÀNG",
                  "FULL NAME",
                  "HỌ VÀ TÊN",
                ]);
                const iA = getColIndex(
                  h,
                  "Bank Account Number",
                  itemColumnMapping,
                  ["ACCOUNT", "TÀI KHOẢN", "STK"],
                );
                const iT = getColIndex(
                  h,
                  "TOTAL PAYMENT",
                  itemColumnMapping,
                  ["TOTAL", "TỔNG", "THỰC NHẬN", "SỐ TIỀN", "TIỀN", "SỐ PHÁT SINH", "PHÁT SINH", "HOLD", "HOLD T3"],
                );
                // const iBank = getColIndex(
                //   h,
                //   "Bank Name",
                //   itemColumnMapping,
                //   ["BANK", "NGÂN HÀNG", "TEN NGAN HANG", "TÊN NGÂN HÀNG"],
                // );
                const iThang = getColIndex(h, "Tháng", itemColumnMapping, [
                  "THÁNG",
                  "MONTH",
                  "KỲ",
                ]);
                const iNghiepVu = getColIndex(
                  h,
                  "Nghiệp vụ",
                  itemColumnMapping,
                  ["NGHIỆP VỤ", "LOẠI", "OPERATION"],
                );
                const iTax = getColIndex(h, "TAX CODE", itemColumnMapping, [
                  "TAX",
                  "MST",
                ]);
                const iContract = getColIndex(
                  h,
                  "Contract No",
                  itemColumnMapping,
                  ["CONTRACT", "HỢP ĐỒNG"],
                );
                const iCenter = getColIndex(
                  h,
                  "Center",
                  itemColumnMapping,
                  ["CENTER NOTE", "CENTER", "CENTERS", "TRUNG TÂM", "MÃ AE"],
                );
                const iNote = getColIndex(h, "Note", itemColumnMapping, [
                  "NOTE",
                  "GHI CHÚ",
                ]);

                for (let r = headerRowIndex + 1; r < rows.length; r++) {
                  const row = rows[r];
                  if (!row || row.length < 3) continue;

                  const idVal =
                    iId !== -1 && row[iId] !== undefined
                      ? cleanIDNumber(row[iId])
                      : "";
                  const nameVal =
                    iN !== -1 && row[iN] !== undefined
                      ? cleanFullName(row[iN])
                      : "";

                  let accVal = "";
                  if (iA !== -1) {
                    const rawAcc = row[iA];
                    accVal =
                      rawAcc !== undefined && rawAcc !== null
                        ? String(rawAcc).replace(/\s/g, "")
                        : "";
                    if (
                      typeof rawAcc === "number" &&
                      (accVal.includes("E") || accVal.includes("e"))
                    ) {
                      accVal = rawAcc.toLocaleString("fullwide", {
                        useGrouping: false,
                      });
                    }
                  }

                  const taxCode =
                    iTax !== -1 && row[iTax] !== undefined
                      ? String(row[iTax]).trim()
                      : "";
                  const contractNo =
                    iContract !== -1 && row[iContract] !== undefined
                      ? String(row[iContract]).trim()
                      : "";
                  const rawTP =
                    iT !== -1 && row[iT] !== undefined ? row[iT] : "";
                  const note =
                    iNote !== -1 && row[iNote] !== undefined
                      ? String(row[iNote]).trim()
                      : "";
                  const sourceMonth =
                    iThang !== -1 && row[iThang] !== undefined
                      ? String(row[iThang]).trim()
                      : "";
                  const sourceOperation =
                    iNghiepVu !== -1 && row[iNghiepVu] !== undefined
                      ? String(row[iNghiepVu]).trim()
                      : "";

                  const {
                    rowShouldNegate,
                    sheetSource,
                    needsSheetSourceNote,
                  } = getRowShouldNegate(note);

                  let numTP = parseMoneyToNumber(rawTP);
                  if (rowShouldNegate) {
                    numTP = -Math.abs(numTP);
                  }

                  const centerNote =
                    iCenter !== -1 && row[iCenter] !== undefined
                      ? String(row[iCenter]).trim()
                      : "";

                  if (!idVal && !nameVal && numTP === 0) continue;

                  holdData.push({
                    "No.": holdData.length + 1,
                    "ID Number": idVal,
                    "Full name": nameVal,
                    "Bank Account Number": accVal,
                    "TAX CODE": taxCode,
                    "Contract No": contractNo,
                    "TOTAL PAYMENT": numTP,
                    "Mã ae": centerNote,
                    "Sheet Source": sheetSource,
                    _needsSheetSourceNote: needsSheetSourceNote,
                    "Nghiệp vụ": sheetSource.toUpperCase().includes("ADD") ? "ADD" : "Hold",
                    Note: note,
                    _adjacentNote: iNote >= 0 ? String(row[iNote + 1] ?? "").trim() : "",
                    "TÊN FILE": item.name || "",
                    _fileBank: effectiveBank,
                    _fileMonth: itemMonth,
                    _sourceMonth: sourceMonth,
                    _sourceOperation: sourceOperation,
                  });
                }
              } else {
                // No header found - extract data from column B to I (indices 1 to 8)
                // Columns expected: ID Number (B), Full name (C), Bank / Tax (D/E), Contract No (F), TOTAL PAYMENT (G), CENTER (H), NOTE (I)
                const getValidVals = (cIndex: number) => {
                  const s = new Set<string>();
                  for (let r = 0; r < rows.length; r++) {
                    const row = rows[r];
                    if (!row || row.length === 0) continue;
                    const val = String(row[cIndex] || "").trim();
                    if (val && val.length > 2 && val.toUpperCase() !== "NULL" && val !== "0" && !val.match(/^[0]+$/)) {
                      s.add(val);
                    }
                  }
                  return s;
                };

                let cID = 1, cBank = 3, cTax = 4;
                const s1 = getValidVals(1);
                const s3 = getValidVals(3);
                const s4 = getValidVals(4);

                const intersects = (setA: Set<string>, setB: Set<string>) => {
                  for (const elem of setB) {
                    if (setA.has(elem)) return true;
                  }
                  return false;
                };

                if (intersects(s1, s3)) {
                  // Cột B trùng với cột D -> Cột B là ID, D là TAX, còn lại E là Bank
                  cID = 1; cTax = 3; cBank = 4;
                } else if (intersects(s1, s4)) {
                  // Cột B trùng với cột E -> Cột B là ID, E là TAX, còn lại D là Bank
                  cID = 1; cTax = 4; cBank = 3;
                } else if (intersects(s3, s4)) {
                  // Không xác định được với B, nhưng D và E trùng nhau -> D và E là ID và TAX, cột còn lại cột B quan trọng nhất là Bank
                  cBank = 1; cID = 3; cTax = 4;
                }

                for (let r = 0; r < rows.length; r++) {
                  const row = rows[r];
                  if (!row || row.length === 0) continue;

                  const idVal = cleanIDNumber(row[cID]);
                  const nameVal = cleanFullName(row[2]);
                  let accVal = String(row[cBank] || "").trim();
                  const taxCode = String(row[cTax] || "").trim();
                  const contractNo = String(row[5] || "").trim();

                  const centerNote = String(row[7] || "").trim();
                  const note = String(row[8] || "").trim();

                  const {
                    rowShouldNegate,
                    sheetSource,
                    needsSheetSourceNote,
                  } = getRowShouldNegate(note);
                  const nghiepVu = sheetSource.toUpperCase().includes("ADD") ? "ADD" : "Hold";

                  const rawTP = row[6] !== undefined ? row[6] : "";
                  let numTP = parseMoneyToNumber(rawTP);
                  if (rowShouldNegate) {
                    numTP = -Math.abs(numTP);
                  }

                  if (!idVal && !nameVal && numTP === 0) continue;
                  if (idVal && !nameVal && numTP === 0 && idVal.toUpperCase().includes("HOLD")) continue;
                  if (idVal.toUpperCase() === "ID NUMBER" || nameVal.toUpperCase() === "FULL NAME") continue;

                  if (row[cBank] !== undefined && row[cBank] !== null) {
                    accVal = String(row[cBank]).replace(/\s/g, "");
                    if (typeof row[cBank] === "number" && (accVal.includes("E") || accVal.includes("e"))) {
                      accVal = Number(row[cBank]).toLocaleString("fullwide", { useGrouping: false });
                    }
                  }

                  holdData.push({
                    "No.": holdData.length + 1,
                    "ID Number": idVal,
                    "Full name": nameVal,
                    "Bank Account Number": accVal,
                    "TAX CODE": taxCode,
                    "Contract No": contractNo,
                    "TOTAL PAYMENT": numTP,
                    "Mã ae": centerNote,
                    "Sheet Source": sheetSource,
                    _needsSheetSourceNote: needsSheetSourceNote,
                    "Nghiệp vụ": nghiepVu,
                    Note: note,
                    _adjacentNote: String(row[9] ?? "").trim(),
                    "TÊN FILE": item.name || "",
                    _fileBank: effectiveBank,
                    _fileMonth: itemMonth,
                  });
                }
              }
            }

            if (!isMktFile && isSheetOneSheet) {
              let headerRowIndex = -1;
              for (let r = 0; r < Math.min(30, rows.length); r++) {
                const rowStr = rows[r]
                  .map((c) => String(c || "").toUpperCase())
                  .join(" ");
                let matchCount = 0;
                if (
                  rowStr.includes("FULL NAME") ||
                  rowStr.includes("HỌ VÀ TÊN") ||
                  rowStr.includes("TÊN NHÂN VIÊN")
                )
                  matchCount++;
                if (
                  rowStr.includes("ID NUMBER") ||
                  rowStr.includes("MÃ NV") ||
                  rowStr.includes("ID")
                )
                  matchCount++;
                if (
                  rowStr.includes("TOTAL PAYMENT") ||
                  rowStr.includes("THỰC NHẬN") ||
                  rowStr.includes("TỔNG")
                )
                  matchCount++;

                if (matchCount >= 2) {
                  headerRowIndex = r;
                  break;
                }
              }

              if (headerRowIndex !== -1) {
                foundAnySheet = true;
                sheetProcessed = true;
                const h = rows[headerRowIndex].map((c) =>
                  String(c || "").trim(),
                );
                const colIndices: Record<string, number> = {};
                sheet1Headers.forEach((th) => {
                  if (th === "L07" || th === "Business") return;

                  const fuzzyMap: Record<string, string[]> = {
                    "Full name": ["FULL NAME", "HỌ VÀ TÊN", "TÊN NHÂN VIÊN"],
                    "ID Number": ["ID", "MÃ NV", "CMND", "MÃ NHÂN VIÊN", "EMPLOYEE ID", "CĂN CƯỚC"],
                    "Bank Account Number": ["ACCOUNT", "TÀI KHOẢN", "STK", "SỐ TÀI KHOẢN"],
                    "TOTAL PAYMENT": ["TOTAL", "TỔNG", "THỰC NHẬN", "TỔNG THANH TOÁN"],
                    "Bank Name": ["BANK NAME", "NGÂN HÀNG"],
                    Bank: [
                      "BANK",
                      "NGÂN HÀNG",
                      "TEN NGAN HANG",
                      "TÊN NGÂN HÀNG",
                    ],
                    Tháng: ["THÁNG", "MONTH", "KỲ"],
                    "CHARGE TO LXO": ["LXO", "CHARGE LXO", "CHARGE TO LXO", "CHARGE LXP"],
                    "CHARGE TO EC": ["EC", "CHARGE EC", "CHARGE TO EC"],
                    "CHARGE TO PT-DEMO": ["PT-DEMO", "CHARGE PT-DEMO", "CHARGE TO PT-DEMO"],
                    "LDEC01": ["LDEC01", "LDEC", "CHARGE TO LDEC01", "CHARGE LDEC01"],
                    "LDEM01": ["LDEM01", "LDEM", "CHARGE TO LDEM01", "CHARGE LDEM01"],
                    "LPAR01": ["LPAR01", "LPAR", "CHARGE TO LPAR01", "CHARGE LPAR01"],
                    "LRET01": ["LRET01", "LRET", "CHARGE TO LRET01", "CHARGE LRET01"],
                    "MOTH01": ["MOTH01", "MOTH", "CHARGE TO MOTH01", "CHARGE MOTH01"],
                    "Charge MKT Local": ["MKT", "MKT LOCAL", "CHARGE MKT LOCAL", "CHARGE TO MKT LOCAL", "CHARGE MKT", "CHARGE TO CENTER MKT"],
                    "CHARGE TO OTHER": ["CHARGE OTHER", "CHARGE TO OTHER", "OTHER"],
                    "Charge Renewal Projects": ["RENEWAL", "RENEWAL PROJECTS", "CHARGE TO RENEWAL PROJECTS", "CHARGE RENEWAL"],
                    "Charge Discovery Camp": ["DISCOVERY", "DISCOVERY CAMP", "CHARGE TO DISCOVERY CAMP", "CHARGE DISCOVERY"],
                    "Charge Summer Outing": ["SUMMER OUTING", "CHARGE TO SUMMER OUTING", "CHARGE SUMMER"],
                    "Charge Summer Instructors": ["SUMMER INSTRUCTORS", "CHARGE TO SUMMER INSTRUCTORS", "CHARGE INSTRUCTOR", "CHARGE INSTRUCTORS"],
                    "Extra Summer Instructors": ["EXTRA SUMMER INSTRUCTORS", "CHARGE TO EXTRA SUMMER INSTRUCTORS", "EXTRA INSTRUCTOR", "EXTRA INSTRUCTORS", "EXTRA SUMMER INSTRUCTOR", "EXTRA INSTRUCTOR BONUS", "SUMMER INSTRUCTORS BONUS", "BONUS"],
                    "TAX CODE": ["TAX", "MST", "MÃ SỐ THUẾ", "TAX CODE", "MÃ ST"],
                    "Contract No": ["CONTRACT", "HỢP ĐỒNG", "SỐ HỢP ĐỒNG", "CONTRACT NO"],
                    "CITAD code": ["CITAD", "MÃ CITAD", "CITAD CODE", "CITAD CHECK"],
                  };

                  colIndices[th] = getColIndex(
                    h,
                    th,
                    itemColumnMapping,
                    fuzzyMap[th] || [],
                  );
                });

                let centerColIndex = getColIndex(
                  h,
                  "L07",
                  itemColumnMapping,
                  [
                    "L07",
                    "TRUNG TÂM (L07)",
                    "CƠ SỞ (L07)",
                    "MÃ L07",
                    "MA L07",
                    "L07/TRUNG TÂM",
                    "LOCATION",
                    "SITE",
                    "BRANCH",
                  ],
                );

                if (centerColIndex === -1) {
                  centerColIndex = getColIndex(
                    h,
                    "Center",
                    itemColumnMapping,
                    [
                      "CENTER",
                      "COST CENTER",
                      "CENTERS",
                      "TRUNG TÂM",
                      "CƠ SỞ",
                      "TRUNG TAM",
                    ],
                  );
                }

                if (centerColIndex === -1) {
                  centerColIndex = getColIndex(
                    h,
                    "Mã AE",
                    itemColumnMapping,
                    [
                      "MÃ AE",
                      "MÃ CENTERS",
                      "MÃ TT",
                      "AE",
                    ],
                  );
                }

                if (centerColIndex === -1) {
                  centerColIndex = h.findIndex((colHeader) => {
                    const u = String(colHeader || "").toUpperCase().trim();
                    return (
                      u === "L07" ||
                      u === "CENTER" ||
                      u.includes("(L07)")
                    );
                  });
                }

                for (let r = headerRowIndex + 1; r < rows.length; r++) {
                  const row = rows[r];
                  // const idxTP = colIndices["TOTAL PAYMENT"];
                  // const rawTP =
                  //   idxTP !== -1 && row[idxTP] !== undefined
                  //     ? row[idxTP]
                  //     : "";
                  // const numTP = parseMoneyToNumber(rawTP);

                  const idxAcc = colIndices["Bank Account Number"];
                  let accVal = "";
                  if (idxAcc !== -1) {
                    const rawAcc = row[idxAcc];
                    accVal =
                      rawAcc !== undefined && rawAcc !== null
                        ? String(rawAcc).trim()
                        : "";
                    if (
                      typeof rawAcc === "number" &&
                      (accVal.includes("E") || accVal.includes("e"))
                    ) {
                      accVal = rawAcc.toLocaleString("fullwide", {
                        useGrouping: false,
                      });
                    }
                  }

                  const idxName = colIndices["Full name"];
                  const nameVal =
                    idxName !== -1 && row[idxName] !== undefined
                      ? cleanFullName(row[idxName])
                      : "";

                  const idxT = colIndices["TOTAL PAYMENT"];
                  const rawTP = idxT !== -1 ? row[idxT] : 0;
                  const numTP = parseMoneyToNumber(rawTP);

                  if (!accVal && numTP === 0) continue;

                  if (
                    (nameVal !== "" || idxName === -1)
                  ) {
                    const obj: any = {};
                    sheet1Headers.forEach((th) => {
                      if (th === "L07" || th === "Business") return;
                      const idx = colIndices[th];
                      let val =
                        idx !== -1 && row[idx] !== undefined ? row[idx] : "";

                      const valStr = String(val).toUpperCase().trim();
                      if (
                        valStr === "NA" ||
                        valStr === "N/A" ||
                        valStr === "#N/A" ||
                        valStr === "NAN"
                      ) {
                        val = "";
                      }

                      if (th === "Bank Account Number") {
                        val = accVal;
                      } else if (isMoneyColumn(th)) {
                        val = parseMoneyToNumber(val);
                      }

                      obj[th] = val;
                    });

                    const rawCenterVal =
                      centerColIndex !== -1
                        ? String(row[centerColIndex] || "").trim()
                        : "";
                    obj["_rawAE"] = rawCenterVal;

                    const resolvedAe = resolveMultiOrSingleAE(rawCenterVal, aeMap);
                    let l07 = resolvedAe.l07 || rawCenterVal;
                    let business = resolvedAe.bus || "";

                    // OVERRIDE FOR MKT
                    if (rawCenterVal.toUpperCase().trim() === "MKT LOCAL NORTH") {
                      l07 = "MKT LOCAL NORTH";
                      business = "AHN";
                    } else {
                      const mktRes3 = resolveMktAndCenterL07(rawCenterVal, "", item.name || "", l07);
                      if (mktRes3.isMktLocal) {
                        l07 = mktRes3.l07;
                        business = mktRes3.business;
                      }
                    }

                    obj["L07"] = l07;
                    obj["Business"] = business;
                    obj["TÊN FILE"] = item.name || "";
                    obj["_fileBank"] = effectiveBank;
                    obj["_fileMonth"] = normalizeMonth(itemMonth);
                    obj["Tháng báo cáo"] = normalizeMonth(itemMonth);
                    obj["Tháng"] = normalizeMonth(itemMonth);
                    obj["month"] = normalizeMonth(itemMonth);
                    sheet1Data.push(obj);
                  }
                }
              }
            }

            if (!isMktFile && normalizedSheetName.includes("SO SANH AE")) {
              foundAnySheet = true;
              sheetProcessed = true;
              for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                soSanhAeData.push({
                  "ID Number": row[0] || "",
                  "Full name": row[1] || "",
                  "Sheet 1 AE": row[2] || 0,
                  "Bank North AE": row[3] || 0,
                  "Chênh Lệch": row[4] || 0,
                });
              }
            }

            if (sheetProcessed) fileProcessedSuccessfully = true;
          } catch (sheetError: any) {
            console.error(
              `Lỗi xử lý sheet ${sheetName} trong file ${item.name}:`,
              sheetError,
            );
          }
        }

        if (fileProcessedSuccessfully) {
          statusById.set(item.id, "Success");
        } else {
          statusById.set(item.id, "Error: Invalid format");
        }
      } catch (e: any) {
        statusById.set(item.id, `Error: ${e.message}`);
      } finally {
        preparedMasterFiles.delete(item.id);
        preparedFiles.delete(item.id);
      }
    }

    if (!foundAnySheet) {
      updateAppData(
        (prev) => ({
          ...prev,
          Ae_Global_Inputs: prev.Ae_Global_Inputs.map((row) => ({
            ...row,
            status: statusById.get(row.id) || row.status,
          })),
        }),
        false,
      );
      toast.error(
        "Không tìm thấy Sheet 'BANK', 'SHEET 1', 'HOLD', 'ADD' hoặc 'SO SÁNH AE' hợp lệ!",
      );
      return;
    }

    setProcessingMessage("Đang tổng hợp và khử trùng dữ liệu...");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const finalSheet1Data: any[] = [];
    const seenSheet1Keys = new Set();
    sheet1Data.forEach((sourceRow) => {
      const row = normalizeGrossPaySpecialCenter(sourceRow);
      // TẠI CỘT L07 SẼ CHUYỂN HẾT SỐ LIỆU TỪ CỘT OTHER VỀ CỘT CHARGE MKT LOCAL
      const l07Upper = String(row["L07"] || "").trim().toUpperCase();
      if (

        l07Upper === "MKT LOCAL NORTH"
      ) {
        const otherAmt = parseMoneyToNumber(row["CHARGE TO OTHER"] || 0);
        if (otherAmt > 0) {
          const currentMkt = parseMoneyToNumber(row["Charge MKT Local"] || 0);
          row["Charge MKT Local"] = currentMkt + otherAmt;
          row["CHARGE TO OTHER"] = 0;
        }
      }

      // Sheet 1 TOTAL PAYMENT is authoritative. Only derive it from the
      // visible charge columns when the source file does not provide a
      // usable total; otherwise new/custom charge columns would be lost.
      const calcPayment = resolveGrossPayTotal(row);
      row["TOTAL PAYMENT"] = calcPayment;

      const idNum = String(row["ID Number"] || "").trim();
      const fname = String(row["Full name"] || "").trim();
      const l07 = String(row["L07"] || "").trim();
      const rowMonth = normalizeMonth(row["Tháng báo cáo"] || row["_fileMonth"] || appData.globalMonth || "03.2026");
      row["Tháng báo cáo"] = rowMonth;
      const total = calcPayment;
      const key = `${idNum}|${fname}|${l07}|${row.Business || row.BU || ""}|${rowMonth}|${total}`;
      if (!seenSheet1Keys.has(key)) {
        row.id = generateUUID();
        finalSheet1Data.push(row);
        seenSheet1Keys.add(key);
      }
    });

    const finalBankData: any[] = [];
    const seenBankKeys = new Set();
    bankData.forEach((row) => {
      const idNum = String(row["ID Number"] || "").trim();
      const fname = String(row["Full name"] || "").trim();
      const acc = String(row["Bank Account Number"] || "").trim();
      const rowMonth = normalizeMonth(row["Tháng báo cáo"] || row["_fileMonth"] || appData.globalMonth || "03.2026");

      // Bỏ qua nếu Bank Account Number trống (theo yêu cầu)
      if (!acc) return;

      const total = parseMoneyToNumber(row["TOTAL PAYMENT"]);
      const key = `${idNum}|${fname}|${acc}|${rowMonth}|${total}`;
      if (!seenBankKeys.has(key)) {
        row.id = generateUUID();
        row["No"] = finalBankData.length + 1;
        finalBankData.push(row);
        seenBankKeys.add(key);
      }
    });

    const finalHoldData: any[] = [];
    holdData.forEach((row) => {
      row["No"] = finalHoldData.length + 1;

      const rawCenterVal = String(row["Mã ae"] || row["CENTER"] || "").trim();
      const aeMap = appData.AE_Map;

      const resolvedAe = resolveMultiOrSingleAE(rawCenterVal, aeMap);
      const l07 = resolvedAe.l07 || String(row["L07"] || "").trim() || rawCenterVal;
      const business = resolvedAe.bus || String(row["Business"] || row["BU"] || "").trim();

      row["L07"] = l07;
      row["Business"] = business;
      row["BU"] = business;
      row.id = generateUUID();

      finalHoldData.push(row);
    });

    // 4. TỰ ĐỘNG ĐỐI SOÁT (RECONCILIATION LOGIC)
    setProcessingMessage("Đang tự động đối soát Sheet 1 và Bank...");
    setProgress(95);
    const finalSoSanhAeData: any[] = [];
    const sheet1Map: Record<string, any> = {};

    // Tạo Map cho Sheet 1 để tra cứu nhanh
    finalSheet1Data.forEach((row) => {
      const id = String(row["ID Number"] || "").trim();
      if (id) {
        if (!sheet1Map[id]) sheet1Map[id] = [];
        sheet1Map[id].push(row);
      }
    });

    const processedSheet1Ids = new Set<string>();

    // Duyệt qua dữ liệu Bank để so sánh
    finalBankData.forEach((bankRow) => {
      const id = String(bankRow["ID Number"] || "").trim();
      const bankAmount = parseMoneyToNumber(bankRow["TOTAL PAYMENT"]);
      const sheet1Rows = id ? sheet1Map[id] : null;

      if (sheet1Rows && sheet1Rows.length > 0) {
        const sheet1Total = sheet1Rows.reduce(
          (sum: number, r: any) =>
            sum + parseMoneyToNumber(r["TOTAL PAYMENT"]),
          0,
        );
        const diff = sheet1Total - bankAmount;

        finalSoSanhAeData.push({
          "ID Number": id,
          "Full name": bankRow["Full name"] || sheet1Rows[0]["Full name"],
          "Sheet 1 AE": sheet1Total,
          "Bank North AE": bankAmount,
          "Chênh Lệch": diff,
          "Ghi chú":
            diff === 0
              ? "Khớp"
              : diff > 0
                ? "Thừa AE duyệt"
                : "Thiếu AE duyệt",
        });
        processedSheet1Ids.add(id);

        // (Removed auto-pushing to Hold based on user requirement: 'chỉ lấy các sheet chứa từ Hold')
      } else {
        const diff = -bankAmount;
        finalSoSanhAeData.push({
          "ID Number": id,
          "Full name": bankRow["Full name"],
          "Sheet 1 AE": 0,
          "Bank North AE": bankAmount,
          "Chênh Lệch": diff,
          "Ghi chú": "Thiếu Sheet 1 (Chưa duyệt)",
        });

        // (Removed auto-pushing to Hold based on user requirement)
      }
    });

    // Kiểm tra những người có trong Sheet 1 nhưng không có trong Bank
    Object.keys(sheet1Map).forEach((id) => {
      if (!processedSheet1Ids.has(id)) {
        const sheet1Rows = sheet1Map[id];
        const sheet1Total = sheet1Rows.reduce(
          (sum: number, r: any) =>
            sum + parseMoneyToNumber(r["TOTAL PAYMENT"]),
          0,
        );

        finalSoSanhAeData.push({
          "ID Number": id,
          "Full name": sheet1Rows[0]["Full name"],
          "Sheet 1 AE": sheet1Total,
          "Bank North AE": 0,
          "Chênh Lệch": sheet1Total,
          "Ghi chú": "Thừa Sheet 1 (Bank không gửi)",
        });
      }
    });

    // Lọc các bản ghi có số tiền thanh toán khác 0 cho Sheet 1 và KHÔNG ĐƯỢC TRỐNG ID NUMBER
    const verifiedSheet1Data = finalSheet1Data.filter(r => {
      const idNum = String(r["ID Number"] || r["id_number"] || "").trim();
      if (!idNum) return false; // Trống ID Number tại Gross Pay thì hoàn toàn bỏ qua
      const tp = parseMoneyToNumber(r["TOTAL PAYMENT"] || 0);
      const hasAcc = r["Bank Account Number"] && String(r["Bank Account Number"]).trim() !== "";
      return tp !== 0 || hasAcc;
    });
    // Cập nhật map BU, L07 từ Sheet 1 cho Hold Data
    finalHoldData.filter(Boolean).forEach((row) => {
      const id = row["ID Number"];
      if (id && sheet1Map[id] && sheet1Map[id].length > 0) {
        row["L07"] = row["L07"] || sheet1Map[id][0]["L07"];
        row["BU"] = row["BU"] || sheet1Map[id][0]["Business"] || sheet1Map[id][0]["BU"];
      }
    });
    const verifiedHoldData = finalHoldData.filter(
      hasRequiredDeductionsFields,
    );

    updateAppData((prev) => {
      const currentMonth = prev.globalMonth || "03.2026";
      const existingHoldData = prev.Hold_AE?.data || [];
      const uploadTime = new Date().toISOString();

      // Standardize monthly values and fields for new incoming rows
      verifiedHoldData.filter(Boolean).forEach((row) => {
        let rMonth = currentMonth;
        let rNghiepVu = row["Nghiệp vụ"] || "";

        if (row._sourceMonth) rMonth = String(row._sourceMonth).trim();
        if (row._sourceOperation) {
          rNghiepVu = String(row._sourceOperation).trim();
        }

        const rawMonth = row["Tháng báo cáo"] || row["_fileMonth"] || rMonth;
        row["Tháng báo cáo"] = normalizeMonth(rawMonth) || normalizeMonth(currentMonth);
        if (!row["Nghiệp vụ"]) row["Nghiệp vụ"] = rNghiepVu || "Hold";
        delete row._sourceMonth;
        delete row._sourceOperation;
        row.id = row.id || generateUUID();
        row._uploadTimestamp = row._uploadTimestamp || uploadTime;
      });

      const holdKeyFn = (r: any) => {
        if (!r) return "";
        const exactScopedKey = getHoldScopedIdentity(r, currentMonth);
        if (exactScopedKey) return exactScopedKey;

        // Keep malformed legacy rows isolated instead of collapsing them by
        // the old broad ID + amount comparison.
        const reportMonth = normalizeMonth(
          r["Tháng báo cáo"] || r["_fileMonth"] || currentMonth,
        );
        return `LEGACY|${reportMonth}|${String(
          r._recordId || r.id || generateUUID(),
        )}`;
      };

      // Group and map existing data by ID/Key and Timestamp
      const recordsMap = new Map<string, any>();
      const mergeSameScopedRecord = (existing: any, incoming: any) => {
        const reconciledPair = mergeDuplicateHoldRows(
          [existing, incoming],
          { scopeByReportMonth: true },
        );

        // HOLD-origin rows collapse to one transaction and preserve a
        // resolved CANCEL/ADD even when a newer workbook repeats the HOLD.
        if (reconciledPair.length === 1) return reconciledPair[0];

        const existingTime = new Date(existing._uploadTimestamp || 0).getTime();
        const incomingTime = new Date(incoming._uploadTimestamp || 0).getTime();
        return incomingTime >= existingTime ? incoming : existing;
      };

      existingHoldData.filter(hasRequiredDeductionsFields).forEach((row) => {
        const key = holdKeyFn(row);
        row.id = row.id || generateUUID();
        row._recordId = row._recordId || key;
        if (!row._uploadTimestamp) {
          row._uploadTimestamp = new Date(0).toISOString(); // Backfill old records
        }

        const existing = recordsMap.get(key);
        if (!existing) {
          recordsMap.set(key, row);
        } else {
          recordsMap.set(key, mergeSameScopedRecord(existing, row));
        }
      });

      // Merge incoming verified hold data
      verifiedHoldData.forEach((row) => {
        const key = holdKeyFn(row);
        row._recordId = row._recordId || key;

        const existing = recordsMap.get(key);
        if (!existing) {
          recordsMap.set(key, row);
        } else {
          recordsMap.set(key, mergeSameScopedRecord(existing, row));
        }
      });

      const mergedHoldData = reconcileHoldTransactionRows(
        Array.from(recordsMap.values()),
      );

      // Re-calculate row numbers
      mergedHoldData.forEach((row, idx) => {
        row["No."] = idx + 1;
        row["No"] = idx + 1;
      });

      // Merge Sheet1_AE with existing data to keep multiple months
      const existingSheet1 = (prev.Sheet1_AE?.data || []).filter((row: any) =>
        !targets.some(target => row["TÊN FILE"] === target.name &&
          normalizeMonth(row._fileMonth || row["Tháng báo cáo"]) === normalizeMonth(target.month || currentMonth)));

      const sheet1Map = new Map<string, any>();

      const getSheet1Key = (r: any) => {
        if (!r) return "";
        const id = String(r["ID Number"] || "").trim().toUpperCase();
        const fname = String(r["Full name"] || "").trim().toUpperCase();
        const l07 = String(r["L07"] || "").trim().toUpperCase();
        const m = normalizeMonth(r["Tháng báo cáo"] || r["_fileMonth"] || currentMonth);
        const tp = Math.round(parseMoneyToNumber(r["TOTAL PAYMENT"] || 0));
        return `${id}|${fname}|${l07}|${r.Business || r.BU || ""}|${m}|${tp}`;
      };

      existingSheet1.forEach((row) => {
        if (!row) return;
        const k = getSheet1Key(row);
        if (k) sheet1Map.set(k, row);
      });

      verifiedSheet1Data.forEach((row) => {
        if (!row) return;
        const k = getSheet1Key(row);
        if (k) sheet1Map.set(k, row);
      });

      const mergedSheet1Data = Array.from(sheet1Map.values());
      mergedSheet1Data.forEach((row, idx) => {
        row["No."] = idx + 1;
        row["No"] = idx + 1;
      });

      // Bank North is also month-scoped source data for Batch Payment.
      // Preserve untouched months exactly like Gross Pay instead of replacing
      // the whole table every time a newer AE Final workbook is processed.
      const existingBankData = (prev.Bank_North_AE?.data || []).filter((row: any) =>
        !targets.some((target) =>
          row["TÊN FILE"] === target.name &&
          normalizeMonth(row["Tháng báo cáo"] || row["_fileMonth"]) ===
            normalizeMonth(target.month || currentMonth),
        ),
      );
      const bankMap = new Map<string, any>();
      const getBankKey = (r: any) => {
        if (!r) return "";
        const id = String(r["ID Number"] || "").trim().toUpperCase();
        const fname = String(r["Full name"] || "").trim().toUpperCase();
        const acc = String(r["Bank Account Number"] || "").trim();
        const month = normalizeMonth(
          r["Tháng báo cáo"] || r["_fileMonth"] || currentMonth,
        );
        const total = Math.round(parseMoneyToNumber(r["TOTAL PAYMENT"] || 0));
        return `${id}|${fname}|${acc}|${month}|${total}`;
      };

      [...existingBankData, ...finalBankData].forEach((row) => {
        if (!row) return;
        const month = normalizeMonth(
          row["Tháng báo cáo"] || row["_fileMonth"] || currentMonth,
        );
        const normalizedRow = {
          ...row,
          _fileMonth: month,
          "Tháng báo cáo": month,
        };
        const key = getBankKey(normalizedRow);
        if (key) bankMap.set(key, normalizedRow);
      });

      const mergedBankData = Array.from(bankMap.values());
      mergedBankData.forEach((row, idx) => {
        row["No."] = idx + 1;
        row["No"] = idx + 1;
      });

      return {
        ...prev,
        Ae_Global_Inputs: prev.Ae_Global_Inputs.map((row) => ({
          ...row,
          status: statusById.get(row.id) || row.status,
        })),
        Master_Roster: [
          ...(prev.Master_Roster || []).filter(r => !targets.some(t => t.name === r._sourceFile)),
          ...rosterDataToAppend
        ],
        Bank_North_AE: {
          headers: [
            "No",
            "L07",
            "Business",
            "ID Number",
            "Full name",
            "Bank Account Number",
            "TOTAL PAYMENT",
            "LOẠI CK",
            "Payment details",
          ],
          data: mergedBankData,
        },
        Sheet1_AE: { headers: sheet1Headers, data: mergedSheet1Data },
        SoSanh_AE: {
          headers: [
            "ID Number",
            "Full name",
            "Sheet 1 AE",
            "Bank North AE",
            "Chênh Lệch",
            "Ghi chú",
          ],
          data: finalSoSanhAeData,
        },
        Hold_AE_Source: {
          headers: ["No.", "BU", "L07", "ID Number", "Full name", "Bank Account Number", "TOTAL PAYMENT", "Sheet Source", "Tháng báo cáo", "Nghiệp vụ", "Note"],
          data: structuredClone([
            ...(prev.Hold_AE_Source?.data || []).filter((row: any) => !targets.some(item =>
              row["TÊN FILE"] === item.name && normalizeMonth(row._fileMonth || row["Tháng báo cáo"]) === normalizeMonth(item.month || currentMonth))),
            ...verifiedHoldData,
          ]),
        },
        Hold_AE: {
          headers: [
            "No.",
            "TÊN FILE",
            "Tháng báo cáo",
            "BU",
            "L07",
            "ID Number",
            "Full name",
            "Bank Account Number",
            "TAX CODE",
            "Contract No",
            "TOTAL PAYMENT",
            "Mã ae",
            "Sheet Source",
            "Note",
            "Nghiệp vụ",
          ],
          data: mergedHoldData,
        },
      };
    }, false, true, ["Sheet1_AE", "Bank_North_AE", "Hold_AE", "Master_Roster"]);

    // Đồng bộ dữ liệu Pivot Master
    try {
      const retainedRosterRows = (appData.Master_Roster || []).filter(
        (row: any) =>
          !targets.some((target) => target.name === row?._sourceFile),
      );
      const rosterRowsForPivot = [
        ...retainedRosterRows,
        ...rosterDataToAppend,
      ];
      const basePivotResult = buildPivotFromAppData(
        verifiedSheet1Data,
        [],
        [],
        appData.globalMonth || "03.2026",
      );
      const rosterPivotResult = buildPivotFromAppData(
        [],
        [],
        rosterRowsForPivot,
        appData.globalMonth || "03.2026",
      );

      let cachedPivotGroupedData = {};
      let cachedPivotTypeColumns: string[] = [];
      try {
        const rawPivotCache = localStorage.getItem(
          "pivot_master_processed_data",
        );
        if (rawPivotCache) {
          const parsedPivotCache = JSON.parse(rawPivotCache);
          if (parsedPivotCache.cacheVersion === PIVOT_CACHE_VERSION) {
            cachedPivotGroupedData = parsedPivotCache.groupedData || {};
            cachedPivotTypeColumns = Array.isArray(
              parsedPivotCache.typeColumns,
            )
              ? parsedPivotCache.typeColumns
              : [];
          }
        }
      } catch {
        // Nếu cache tổng bị lỗi, cache TYPE riêng vẫn tiếp tục được sử dụng.
      }

      let mktTypeCache = readPivotMktTypeCache(
        cachedPivotGroupedData,
        cachedPivotTypeColumns,
      );
      if (rosterRowsForPivot.length > 0) {
        mktTypeCache = updatePivotMktTypeCache(
          mktTypeCache,
          rosterPivotResult.groupedData || {},
          rosterPivotResult.typeColumns || [],
          getPivotDataMonths(rosterPivotResult.groupedData || {}),
        );
        writePivotMktTypeCache(mktTypeCache);
      }

      const pivotGroupedData = applyPivotMktTypeCache(
        basePivotResult.groupedData || {},
        mktTypeCache,
      );
      const pivotTypeColumns = Array.from(
        new Set([
          ...(basePivotResult.typeColumns || []),
          ...mktTypeCache.typeColumns,
        ]),
      );
      const pivotResult = {
        groupedData: pivotGroupedData,
        typeColumns: pivotTypeColumns,
        logs: [],
        sourceInfo: `Đồng bộ từ ${verifiedSheet1Data.length} dòng Gross Pay và ${rosterRowsForPivot.length} dòng Roster; giữ TYPE MKT đã lưu khi thiếu file`,
      };

      if (pivotResult && pivotResult.groupedData) {
        localStorage.setItem("pivot_master_processed_data", JSON.stringify({
          cacheVersion: PIVOT_CACHE_VERSION,
          groupedData: pivotResult.groupedData,
          typeColumns: pivotResult.typeColumns,
          diagnosticLogs: pivotResult.logs || [],
          sourceInfo: pivotResult.sourceInfo,
          reportingMonth: appData.globalMonth || "03.2026",
          updatedAt: Date.now()
        }));
        window.dispatchEvent(new CustomEvent("pivot-data-updated", {
          detail: {
            groupedData: pivotResult.groupedData,
            typeColumns: pivotResult.typeColumns,
            diagnosticLogs: pivotResult.logs || [],
            sourceInfo: pivotResult.sourceInfo
          }
        }));
      }
    } catch (pivotErr) {
      console.error("Error creating pivot master data:", pivotErr);
    }

    toast.success(
      `Xử lý xong: ${verifiedSheet1Data.length} Sheet1, ${finalBankData.length} Bank, ${verifiedHoldData.length} Hold.`,
    );
    localStorage.setItem("master_ae_active_tab", "Sheet1_AE");
    window.dispatchEvent(
      new CustomEvent("master-ae-request-tab-change", {
        detail: { tab: "Sheet1_AE" },
      }),
    );
    window.dispatchEvent(new Event("master-ae-request-refresh"));
    onComplete();
  } catch (error: any) {
    console.error("Error processing AE data:", error);
    toast.error("Lỗi xử lý file: " + error.message);
  } finally {
    setIsProcessing(false);
  }
}
