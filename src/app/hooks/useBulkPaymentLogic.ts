import { useTableRestore } from './useTableRestore';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppData } from "../lib/contexts/AppDataContext";
import {
  parseMoneyToNumber,
  getHoldRowAmount,
  formatMoneyVND,
  removeVietnameseTones,
  generateUUID,
} from "../lib/utils/data-utils";
import { toast } from "sonner";
import { classifyHoldOperation } from "../lib/utils/bulk-payment-analytics";
import {
  commitTransactionEdits,
  hasPendingTransactionEdits as hasPendingTransactionEditsInData,
  markTransactionGenerated,
  markTransactionSaved,
} from "../lib/utils/transaction-activity";
import {
  applyTransactionDraftCellEdit,
  saveTransactionDraft,
  type TransactionDraft,
} from "../lib/utils/transaction-draft";
import {
  cacheActiveTransactionMonth,
  calculateReconciliationTotals,
  getDeductionContribution,
  getDeductionReportEntry,
} from "../lib/utils/reconciliation-sync";
import {
  downloadTransactionBankExport,
} from "../lib/utils/excel-export";

// ==========================================
// PURE UTILITY & LOGIC HELPER FUNCTIONS
// ==========================================

export const isSameMonthForSumIf = (rowMonthRaw?: string, workMonthRaw?: string): boolean => {
  if (!rowMonthRaw || !workMonthRaw) return false;
  
  const parsePartsStr = (s: string) => {
    const clean = s.trim().toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^tháng/, "");
    
    const dotSep = clean.replace(/[-_/]/g, ".");
    const parts = dotSep.split(".");
    
    if (parts.length >= 2) {
      const yearIdx = parts.findIndex(p => p.length === 4 && !isNaN(parseInt(p, 10)));
      if (yearIdx !== -1) {
        const year = parseInt(parts[yearIdx], 10);
        let month = 0;
        if (yearIdx === 1) {
          month = parseInt(parts[0], 10);
        } else if (yearIdx === 2) {
          month = parseInt(parts[1], 10);
        } else if (yearIdx === 0) {
          month = parseInt(parts[1], 10);
        }
        if (month >= 1 && month <= 12 && year > 0) {
          return { month, year };
        }
      } else {
        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);
        if (!isNaN(first) && !isNaN(second)) {
          if (first > 12) {
            return { month: second, year: first < 100 ? first + 2000 : first };
          } else {
            return { month: first, year: second < 100 ? second + 2000 : second };
          }
        }
      }
    }
    
    const match = s.match(/(tháng|thg)?\s*(\d{1,2})\s*([./-])\s*(\d{4})/i);
    if (match) {
      return { month: parseInt(match[2], 10), year: parseInt(match[4], 10) };
    }
    
    return null;
  };

  const p1 = parsePartsStr(rowMonthRaw);
  const p2 = parsePartsStr(workMonthRaw);
  
  if (p1 && p2) {
    return p1.month === p2.month && p1.year === p2.year;
  }
  
  const directClean = (str: string) => str.trim().toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^tháng/, "")
    .replace(/[/_]/g, ".");
  return directClean(rowMonthRaw) === directClean(workMonthRaw);
};

export const isPastMonthHold = (row: any, currentMonthNum: number, currentYearNum: number): boolean => {
  if (!row) return false;

  const rawSource = String(row["Sheet Source"] || "").toUpperCase();
  const isBonusSummer = rawSource.includes("BONUS") && (
    rawSource.includes("SUMMER") || 
    rawSource.includes("INSTRUCTOR") || 
    rawSource.includes("INTROSTION")
  );
  if (isBonusSummer) return false;

  const phatSinh = String(row["Tháng phát sinh"] || "").trim().replace(/[-_/]/g, ".");
  const parts = phatSinh.split(".");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    const nghiepVu = String(row["Nghiệp vụ"] || "").trim().toUpperCase();
    const isHoldOrCancel = nghiepVu.includes("HOLD") || nghiepVu.includes("CANCEL");
    if (isHoldOrCancel && !isNaN(m) && !isNaN(y)) {
      if (y < currentYearNum || (y === currentYearNum && m < currentMonthNum)) {
        return true;
      }
    }
  }

  let tttt = "";
  for (const k of Object.keys(row)) {
    const kLower = k.toLowerCase();
    if (kLower.includes("tình trạng thanh toán") || kLower.includes("tình trạng") || kLower.includes("tttt")) {
      tttt = String(row[k] || "");
      break;
    }
  }
  if (!tttt) {
    tttt = String(row["Tình trạng thanh toán"] || row["Tình Trạng Thanh Toán"] || row["TÌNH TRẠNG THANH TOÁN"] || row["Tháng phát sinh"] || row["tháng phát sinh"] || row["Trạng thái"] || row["trạng thái"] || "");
  }

  const ttttLower = tttt.toLowerCase().trim();
  if (ttttLower.includes("pending")) {
    const pendingMatch = ttttLower.match(/pending\s*(?:tháng|thg|t)?\s*(\d+)(\s*([./-])\s*(\d+))?/i);
    if (pendingMatch) {
      const m = parseInt(pendingMatch[1], 10);
      let y = currentYearNum;
      
      const yrMatch = ttttLower.match(/\b(202\d)\b/);
      if (yrMatch) {
        y = parseInt(yrMatch[1], 10);
      } else if (m === 11 || m === 12) {
        y = currentYearNum === 2025 ? 2025 : (currentYearNum === 2026 ? 2025 : currentYearNum);
      }
      
      if (y < currentYearNum || (y === currentYearNum && m < currentMonthNum)) {
        return true;
      }
    }
  }
  return false;
};

// ==========================================
// CORE BULK PAYMENT LOGIC HOOK
// ==========================================

export function useBulkPaymentLogic() {
  const { appData, updateAppData } = useAppData();
  const restoreTable = useTableRestore();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const isRefreshing = false;
  const savedBankExportRows = appData.BankExport.data;
  const [transactionDraft, setTransactionDraft] =
    useState<TransactionDraft | null>(null);
  const activeTransactionDraft =
    transactionDraft?.sourceRows === savedBankExportRows
      ? transactionDraft
      : null;

  const [reportStats, setReportStats] = useState<{
    sheet1Totals: Record<string, number>;
    holdAddItems: { month: string; biz: string; reason: string; amount: number; contribution: number; type: 'HOLD' | 'ADD' | 'CANCEL' }[];
    finalTotals: Record<string, number>;
    isSuccess: boolean;
    bizDiffs: string[];
  } | null>(null);

  // Month period parameters derived from globalMonth
  const monthPeriod = useMemo(() => {
    const currentMonthValComp = appData.globalMonth || "03.2026";
    const currentPeriodPartsComp = currentMonthValComp.split(".");
    const currentMonthNumComp = parseInt(currentPeriodPartsComp[0], 10) || 3;
    const currentYearNumComp = parseInt(currentPeriodPartsComp[1], 10) || 2026;
    const targetMonthLabelComp = `Tháng ${currentMonthNumComp}/${currentYearNumComp}`;
    const monthShortStrComp = `T${currentMonthNumComp}`;
    const monthDashStrComp = `${currentMonthNumComp}/${currentYearNumComp}`;
    return {
      globalMonth: currentMonthValComp,
      targetMonthLabelComp,
      monthShortStrComp,
      monthDashStrComp,
      currentMonthNumComp,
      currentYearNumComp,
    };
  }, [appData.globalMonth]);

  const { targetMonthLabelComp, monthShortStrComp, monthDashStrComp, currentMonthNumComp, currentYearNumComp } = monthPeriod;

  // Month string matching helpers
  const monMatchComp = useCallback(
    (s: string) => {
      if (!s) return null;
      const up = String(s).toUpperCase().trim();
      const yrMatch = up.match(
        /(?:THÁNG|THANG|T)?\s*(\d{1,2})(?:[./\- ]|NĂM\s+|YEAR\s+)+(\d{4})/i,
      );
      if (yrMatch) {
        const m = parseInt(yrMatch[1], 10);
        const y = parseInt(yrMatch[2], 10);
        if (m >= 1 && m <= 12) return `Tháng ${m}/${y}`;
      }
      const tMatch = up.match(/(?:THÁNG|THANG|T)\s*(\d+)/i);
      if (tMatch) {
        const m = parseInt(tMatch[1], 10);
        if (m >= 1 && m <= 12) {
          let y = currentYearNumComp;
          if (m === 11 || m === 12) {
            y = currentYearNumComp === 11 || currentYearNumComp === 12 ? currentYearNumComp : 2025;
          } else if (m > currentMonthNumComp && (currentYearNumComp === 2025 || currentYearNumComp === 2026)) {
            y = currentYearNumComp - 1;
          }
          return `Tháng ${m}/${y}`;
        }
      }
      const dotMatch = up.match(/^(\d{1,2})\.(\d{4})$/);
      if (dotMatch) {
        return `Tháng ${parseInt(dotMatch[1], 10)}/${parseInt(dotMatch[2], 10)}`;
      }
      return null;
    },
    [currentMonthNumComp, currentYearNumComp],
  );

  const isMonthInStrComp = useCallback(
    (s: string) => {
      if (!s) return true;
      const up = String(s || "").toUpperCase();
      return (
        up.includes(targetMonthLabelComp.toUpperCase()) ||
        up.includes(monthShortStrComp.toUpperCase()) ||
        up.includes(monthDashStrComp)
      );
    },
    [targetMonthLabelComp, monthShortStrComp, monthDashStrComp],
  );

  // 1. AGGREGATE DETAILED BU PAYMENT & HOLD DATA
  const holdPaymentDetails = useMemo(() => {
    const idToSheet1: Record<string, string> = {};
    const nameToSheet1: Record<string, string> = {};
    const accToSheet1: Record<string, string> = {};

    const sheet1Rows = appData.Sheet1_AE?.data || [];
    
    let sheet1AhnTotal = 0;
    let sheet1AhpTotal = 0;
    let sheet1AthTotal = 0;
    let sheet1AtnTotal = 0;
    let sheet1AptTotal = 0;
    let sheet1OtherTotal = 0;

    sheet1Rows.forEach((row) => {
      const rowMonthRaw = String(row["Tháng báo cáo"] || row["_fileMonth"] || row["Tháng"] || "").trim();
      const extracted = monMatchComp(rowMonthRaw);
      if (extracted && extracted !== targetMonthLabelComp) {
        return;
      }
      if (!extracted && rowMonthRaw && !isMonthInStrComp(rowMonthRaw)) {
        return;
      }
      
      const id = String(row["ID Number"] || row["Mã AE"] || row["Mã ae"] || "").trim();
      if (!id) return; // BỎ QUA NẾU TRỐNG ID NUMBER
      const name = removeVietnameseTones(row["Full name"] || row["Beneficiary Name"] || "").toUpperCase();
      const acc = String(row["Bank Account Number"] || row["Beneficiary Account No."] || "").trim();
      
      let biz = row["Business"] || row["BU"] || "Unknown";
      if (biz === "AHN_HP") {
        biz = "AHP";
      }
      
      if (id) idToSheet1[id] = biz;
      if (name) nameToSheet1[name] = biz;
      if (acc) accToSheet1[acc] = biz;

      const amount = parseMoneyToNumber(row["TOTAL PAYMENT"] || row["Grand Total"] || row["GRAND TOTAL"] || row["Payment Amount"] || 0);
      if (biz === "AHN") sheet1AhnTotal += amount;
      else if (biz === "AHP") sheet1AhpTotal += amount;
      else if (biz === "ATH") sheet1AthTotal += amount;
      else if (biz === "ATN") sheet1AtnTotal += amount;
      else if (biz === "APT") sheet1AptTotal += amount;
      else sheet1OtherTotal += amount;
    });

    const holdRows = appData.Hold_AE?.data || [];
    const hasData = sheet1Rows.length > 0 || holdRows.length > 0;
    
    let holdAhnTotal = 0;
    let holdAhpTotal = 0;
    let holdAthTotal = 0;
    let holdAtnTotal = 0;
    let holdAptTotal = 0;    
    let holdOtherTotal = 0;

    const dynamicHoldAddItems: Record<string, number> = {};
    const holdBalanceByMonth: Record<string, number> = {};
    const activeMonths = new Set<string>();

    const pivotRows: Record<string, any> = {
      "AHN": { BU: "AHN", months: {} },
      "AHP": { BU: "AHP", months: {} },
      "ATH": { BU: "ATH", months: {} },
      "ATN": { BU: "ATN", months: {} },
      "APT": { BU: "APT", months: {} },   
    };

    holdRows.forEach((row) => {
      const entry = getDeductionReportEntry(row, `${currentMonthNumComp}.${currentYearNumComp}`);
      if (!entry || entry.contribution === 0) return;
      const val = entry.contribution;
      const label = entry.type;
      const isHold = entry.type === "HOLD";

      let biz = row["BU"] || row["Business"] || "";
      if (biz) biz = String(biz).trim().toUpperCase();
      if (biz === "AHN_HP") biz = "AHP";

      const id = String(row["ID Number"] || row["Mã AE"] || row["Mã ae"] || "").trim();
      const name = removeVietnameseTones(row["Full name"] || row["Beneficiary Name"] || "").toUpperCase();
      const acc = String(row["Bank Account Number"] || row["Beneficiary Account No."] || "").trim();

      if (!biz || biz === "UNKNOWN") biz = idToSheet1[id];
      if ((!biz || biz === "UNKNOWN") && name) biz = nameToSheet1[name];

      if (!biz || biz === "UNKNOWN") {
        const textToMatch = [ row["Sheet Source"], row["CENTER NOTE"], row["Center"], row["Center Code"], row["L07"], row["Mã ae"], row["Note"], row["Full name"] ]
          .map(v => String(v || "").toUpperCase()).join(" ");
        if (textToMatch.includes("AHP") || textToMatch.includes("HAIPHONG") || textToMatch.includes("HAI PHONG")) biz = "AHP";
        else if (textToMatch.includes("ATH") || textToMatch.includes("THANH HOA") || textToMatch.includes("THANH HÓA")) biz = "ATH";
        else if (textToMatch.includes("ATN") || textToMatch.includes("THAI NGUYEN") || textToMatch.includes("THÁI NGUYÊN")) biz = "ATN";
        else if (textToMatch.includes("APT") || textToMatch.includes("PHU THO") || textToMatch.includes("PHÚ THỌ")) biz = "APT";
        else if (textToMatch.includes("AHN") || textToMatch.includes("HA NOI") || textToMatch.includes("HÀ NỘI")) biz = "AHN";
        else biz = "AHN";
      }

      if (biz === "AHN_HP") biz = "AHP";

      let monthKey = String(currentMonthNumComp); 
      const searchStr = String(row["Tình trạng thanh toán"] || row["Tháng phát sinh"] || row["Trạng thái"] || row["Sheet Source"] || row["Tháng báo cáo"] || "");
      
      const tMatch = searchStr.match(/T[HÁNG]*\s*(\d+)/i) || searchStr.match(/^(\d{2})\.(\d{4})/) || searchStr.match(/(\d+)/);
      if (tMatch) {
         monthKey = String(parseInt(tMatch[1], 10));
      }

      if (val !== 0) {
        const absVal = Math.abs(val);
        activeMonths.add(monthKey);

        if (biz === "AHN" || biz === "AHP" || biz === "ATH" || biz === "ATN" || biz === "APT") {
          if (!pivotRows[biz].months[monthKey]) pivotRows[biz].months[monthKey] = { hold: 0, add: 0 };
          if (isHold) pivotRows[biz].months[monthKey].hold += absVal;
          else pivotRows[biz].months[monthKey].add += absVal;
        }

        if (biz === "AHN") holdAhnTotal += val;
        else if (biz === "AHP") holdAhpTotal += val;
        else if (biz === "ATH") holdAthTotal += val;
        else if (biz === "ATN") holdAtnTotal += val;
        else if (biz === "APT") holdAptTotal += val;
        else holdOtherTotal += val;
        
        dynamicHoldAddItems[label] = (dynamicHoldAddItems[label] || 0) + val;
        holdBalanceByMonth[`T${monthKey}`] = (holdBalanceByMonth[`T${monthKey}`] || 0) + val;
      }
    });

    const crosstabData = Object.values(pivotRows);
    
    if (activeMonths.size === 0) {
      activeMonths.add(String(currentMonthNumComp));
    }
    const sortedMonths = Array.from(activeMonths).sort((a, b) => Number(a) - Number(b));

    const ahnT5 = sheet1AhnTotal + holdAhnTotal;
    const ahpT5 = sheet1AhpTotal + holdAhpTotal;
    const athT5 = sheet1AthTotal + holdAthTotal;
    const atnT5 = sheet1AtnTotal + holdAtnTotal;
    const aptT5 = sheet1AptTotal + holdAptTotal;
    const otherT5 = sheet1OtherTotal + holdOtherTotal;

    const bankNorthT5 = ahnT5 + ahpT5;
    const bankTinhT5Ae = athT5 + atnT5 + aptT5;
    const bankT5Ae = bankNorthT5 + bankTinhT5Ae + otherT5;
    const holdAddTotal = holdAhnTotal + holdAhpTotal + holdAthTotal + holdAtnTotal + holdAptTotal + holdOtherTotal;

    let holdAddList: { label: string; amount: number }[] = [];
    let holdBalanceList: { month: string; balance: number }[] = [];

    if (hasData) {
      holdAddList = Object.entries(dynamicHoldAddItems)
        .filter(([_, amount]) => amount !== 0)
        .map(([label, amount]) => ({ label, amount }));
      
      holdBalanceList = Object.entries(holdBalanceByMonth)
        .map(([month, balance]) => ({ month, balance }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }

    return {
      ahnT5,
      ahpT5,
      athT5,
      atnT5,
      aptT5,
      otherT5,
      bankNorthT5,
      bankTinhT5Ae,
      bankT5Ae,
      holdAddTotal,
      holdAddList,
      holdBalanceList,
      hasData,
      crosstabData,
      sortedMonths,
    };
  }, [appData.Hold_AE.data, appData.Sheet1_AE.data, currentMonthNumComp, currentYearNumComp, isMonthInStrComp, monMatchComp, targetMonthLabelComp]);

  // 2. RECONCILE CALCULATION SUMMARY
  const calculationSummary = useMemo(() => {
    const currentMonthVal = appData.globalMonth || "03.2026";

    const sheet1Total = appData.Sheet1_AE.data.reduce(
      (sum, r) => {
        const id = String(r["ID Number"] || r["Mã AE"] || r["Mã ae"] || "").trim();
        if (!id) return sum; // BỎ QUA NẾU TRỐNG ID NUMBER
        const rowMonthStr = String(r["Tháng báo cáo"] || "").trim();
        if (!isSameMonthForSumIf(rowMonthStr, currentMonthVal)) return sum;
        return sum + parseMoneyToNumber(r["TOTAL PAYMENT"] || r["Payment Amount"] || r["Grand Total"] || r["GRAND TOTAL"] || r["Total Payment"] || 0);
      },
      0
    );

    const holdTotal = appData.Hold_AE.data.reduce(
      (sum, row) => sum + getDeductionContribution(row, currentMonthVal), 0,
    );

    const calculatedTotal = sheet1Total + holdTotal;
    const aeTotal = appData.Bank_North_AE.data.reduce(
      (sum, r) => {
        const rowMonthRaw = String(r["Tháng báo cáo"] || r["_fileMonth"] || r["Tháng"] || "").trim();
        const extracted = monMatchComp(rowMonthRaw);
        
        const fMonthRaw = String(r["_fileMonth"] || "").trim();
        const fMonthExtracted = monMatchComp(fMonthRaw);
        if (fMonthExtracted === targetMonthLabelComp) {
          return sum + (parseMoneyToNumber(r["TOTAL PAYMENT"]) || 0);
        }

        if (extracted && extracted !== targetMonthLabelComp) return sum;
        if (!extracted && rowMonthRaw && !isMonthInStrComp(rowMonthRaw)) return sum;
        return sum + (parseMoneyToNumber(r["TOTAL PAYMENT"]) || 0);
      },
      0
    );
    const isMatched = Math.abs(calculatedTotal - aeTotal) < 1;
    const diff = calculatedTotal - aeTotal;

    return {
      sheet1Total,
      holdTotal,
      bankNorthTotal: holdPaymentDetails.bankNorthT5,
      calculatedTotal,
      isMatched,
      diff,
      aeTotal,
    };
  }, [appData.Sheet1_AE.data, appData.Hold_AE.data, appData.Bank_North_AE.data, appData.globalMonth, holdPaymentDetails.bankNorthT5, isMonthInStrComp, monMatchComp, targetMonthLabelComp]);

  // 3. DYNAMIC REPORT STATS BY BU & HOLD CATEGORY
  const dynamicReportStats = useMemo(() => {
    const sheet1Totals: Record<string, number> = {};
    appData.Sheet1_AE.data.forEach((r) => {
      const id = String(r["ID Number"] || r["Mã AE"] || r["Mã ae"] || "").trim();
      if (!id) return; // BỎ QUA NẾU TRỐNG ID NUMBER
      const rowMonthStr = String(r["Tháng báo cáo"] || r["_fileMonth"] || r["Tháng"] || r["Month"] || "").trim();
      const extracted = monMatchComp(rowMonthStr);
      if (extracted && extracted !== targetMonthLabelComp) return;
      if (!extracted && rowMonthStr && !isMonthInStrComp(rowMonthStr)) return;

      let biz = r["Business"] || r["BU"] || "Unknown";
      if (biz === "AHN_HP") biz = "AHP";
      const amount = parseMoneyToNumber(r["TOTAL PAYMENT"] || r["Payment Amount"] || r["Grand Total"] || r["GRAND TOTAL"] || r["Total Payment"] || 0);
      sheet1Totals[biz] = (sheet1Totals[biz] || 0) + amount;
    });

    const holdAddItems: { month: string; biz: string; reason: string; amount: number; contribution: number; type: 'HOLD' | 'ADD' | 'CANCEL' | 'BONUS' }[] = [];
    appData.Hold_AE.data.forEach((r) => {
      const entry = getDeductionReportEntry(r, `${currentMonthNumComp}.${currentYearNumComp}`);
      if (!entry) return;
      if (entry.amount !== 0) {
        let biz = r["BU"] || r["Business"] || "Unknown";
        if (biz === "AHN_HP") biz = "AHP";

        if (biz === "Unknown" || !biz || biz === "UNKNOWN") {
          const textToMatch = [ r["Sheet Source"], r["CENTER NOTE"], r["Center"], r["Center Code"], r["L07"], r["Mã ae"], r["Note"], r["Full name"] ]
            .map(v => String(v || "").toUpperCase()).join(" ");
          if (textToMatch.includes("AHP") || textToMatch.includes("HAIPHONG") || textToMatch.includes("HAI PHONG")) biz = "AHP";
          else if (textToMatch.includes("ATH") || textToMatch.includes("THANH HOA") || textToMatch.includes("THANH HÓA")) biz = "ATH";
          else if (textToMatch.includes("ATN") || textToMatch.includes("THAI NGUYEN") || textToMatch.includes("THÁI NGUYÊN")) biz = "ATN";
          else if (textToMatch.includes("APT") || textToMatch.includes("PHU THO") || textToMatch.includes("PHÚ THỌ")) biz = "APT";
          else if (textToMatch.includes("AHN") || textToMatch.includes("HA NOI") || textToMatch.includes("HÀ NỘI")) biz = "AHN";
          else biz = "AHN";
        }

        holdAddItems.push({
          month: String(r["Tháng phát sinh"] || r["Tháng báo cáo"] || r["Tháng"] || r["Month"] || "").trim(),
          biz,
          reason: String(r["Nghiệp vụ"] || r["Ghi chú"] || "N/A"),
          amount: entry.amount,
          contribution: entry.contribution,
          type: entry.type
        });
      }
    });

    const finalTotals: Record<string, number> = {};
    const buList = ["AHN", "AHP", "ATH", "ATN", "APT", "OTHER"];
    buList.forEach(bu => {
      finalTotals[bu] = sheet1Totals[bu] || 0;
    });

    if (sheet1Totals["Unknown"]) {
      finalTotals["AHN"] = (finalTotals["AHN"] || 0) + sheet1Totals["Unknown"];
    }

    let sameMonthHoldTotal = 0;
    let sameMonthAddTotal = 0;
    let diffMonthAddTotal = 0;
    const bonusTotal = 0;

    holdAddItems.forEach(item => {
      if (!finalTotals[item.biz]) {
        finalTotals[item.biz] = 0;
      }
      
      finalTotals[item.biz] += item.contribution;
    });

    if (finalTotals["Unknown"]) {
      finalTotals["AHN"] = (finalTotals["AHN"] || 0) + finalTotals["Unknown"];
      delete finalTotals["Unknown"];
    }

    appData.Hold_AE.data.forEach((row) => {
      const entry = getDeductionReportEntry(row, `${currentMonthNumComp}.${currentYearNumComp}`);
      if (!entry) return;
      if (entry.type === "HOLD") sameMonthHoldTotal += Math.abs(entry.amount);
      if (entry.type === "ADD") {
        if (entry.isPastMonth) diffMonthAddTotal += entry.amount;
        else sameMonthAddTotal += entry.amount;
      }
    });

    return {
      sheet1Totals,
      holdAddItems,
      finalTotals,
      sameMonthHoldTotal,
      sameMonthAddTotal,
      diffMonthAddTotal,
      bonusTotal
    };
  }, [appData.Sheet1_AE.data, appData.Hold_AE.data, currentMonthNumComp, currentYearNumComp, isMonthInStrComp, monMatchComp, targetMonthLabelComp]);

  // 4. REMAINING HOLD BALANCE BY MONTH & BU
  const remainingHoldByMonth = useMemo(() => {
    const results: Record<string, { 
      holdAmount: number; 
      addAmount: number; 
      remaining: number; 
      bus: Record<string, { holdAmount: number; addAmount: number; remaining: number }>
    }> = {};

    appData.Hold_AE.data.forEach((r) => {
      const command = String(r["Lệnh"] || "").trim().toUpperCase();
      if (command === "-") return;
      if (r._dimmed) return;

      const sheetSource = String(r["Sheet Source"] || "").toLowerCase();
      if (sheetSource.includes("sheet 1 ae") || sheetSource.includes("sheet 1") || sheetSource.includes("intern") || sheetSource.includes("report")) return;

      const operation = classifyHoldOperation(r);
      if (!operation || operation === "CANCEL") return;

      const amount = getHoldRowAmount(r);
      if (amount === 0) return;

      const phatSinhRaw = String(r["Tháng phát sinh"] || r["Month of Occurrence"] || r["Tháng"] || r["Month"] || "").trim();
      const baoCaoRaw = String(r["Tháng báo cáo"] || r["_fileMonth"] || "").trim();

      const parseToMMYYYY = (rawStr: string) => {
        if (!rawStr) return null;
        const clean = rawStr.replace(/[-_/]/g, ".");
        const parts = clean.split(".");
        if (parts.length >= 2) {
          const m = parseInt(parts[0], 10);
          let y = parseInt(parts[1], 10);
          if (!isNaN(m) && !isNaN(y)) {
            if (y < 100) y += 2000;
            return `${m < 10 ? "0" + m : m}/${y}`;
          }
        }
        const match = rawStr.match(/(\d{1,2})\s*([./-])\s*(\d{4})/);
        if (match) {
          const m = parseInt(match[1], 10);
          const y = parseInt(match[3], 10);
          return `${m < 10 ? "0" + m : m}/${y}`;
        }
        return null;
      };

      const mOcc = parseToMMYYYY(phatSinhRaw);
      const mRep = parseToMMYYYY(baoCaoRaw) || parseToMMYYYY(appData.globalMonth || "03.2026");

      if (!mOcc) return;

      const isHoldType = operation === "HOLD";

      let biz = r["BU"] || r["Business"] || "Unknown";
      if (biz === "AHN_HP") biz = "AHP";

      if (biz === "Unknown" || !biz || biz === "UNKNOWN") {
        const textToMatch = [ r["Sheet Source"], r["CENTER NOTE"], r["Center"], r["Center Code"], r["L07"], r["Mã ae"], r["Note"], r["Full name"] ]
          .map(v => String(v || "").toUpperCase()).join(" ");
        if (textToMatch.includes("AHP") || textToMatch.includes("HAIPHONG") || textToMatch.includes("HAI PHONG")) biz = "AHP";
        else if (textToMatch.includes("ATH") || textToMatch.includes("THANH HOA") || textToMatch.includes("THANH HÓA")) biz = "ATH";
        else if (textToMatch.includes("ATN") || textToMatch.includes("THAI NGUYEN") || textToMatch.includes("THÁI NGUYÊN")) biz = "ATN";
        else if (textToMatch.includes("APT") || textToMatch.includes("PHU THO") || textToMatch.includes("PHÚ THỌ")) biz = "APT";
        else if (textToMatch.includes("AHN") || textToMatch.includes("HA NOI") || textToMatch.includes("HÀ NỘI")) biz = "AHN";
        else biz = "AHN";
      }

      if (!results[mOcc]) {
        results[mOcc] = { holdAmount: 0, addAmount: 0, remaining: 0, bus: {} };
      }

      if (!results[mOcc].bus[biz]) {
        results[mOcc].bus[biz] = { holdAmount: 0, addAmount: 0, remaining: 0 };
      }

      if (isHoldType) {
        results[mOcc].holdAmount += Math.abs(amount);
        results[mOcc].bus[biz].holdAmount += Math.abs(amount);
      } else {
        results[mOcc].addAmount += Math.abs(amount);
        results[mOcc].bus[biz].addAmount += Math.abs(amount);
      }
    });

    const parsedArray = Object.entries(results).map(([month, data]) => {
      const remaining = data.holdAmount - data.addAmount;
      const buBreakdown: Record<string, { holdAmount: number; addAmount: number; remaining: number }> = {};
      const allBUs = ["AHN", "AHP", "ATH", "ATN", "APT"];
      
      allBUs.forEach(bu => {
        const buData = data.bus[bu] || { holdAmount: 0, addAmount: 0, remaining: 0 };
        buBreakdown[bu] = {
          holdAmount: buData.holdAmount,
          addAmount: buData.addAmount,
          remaining: buData.holdAmount - buData.addAmount
        };
      });

      return {
        month: `Tháng ${month}`,
        holdAmount: data.holdAmount,
        addAmount: data.addAmount,
        remaining: remaining,
        rawMonth: month,
        bus: buBreakdown
      };
    }).sort((a, b) => {
      const [mA, yA] = a.rawMonth.split("/").map(Number);
      const [mB, yB] = b.rawMonth.split("/").map(Number);
      if (yA !== yB) return yA - yB;
      return mA - mB;
    });

    return parsedArray;
  }, [appData.Hold_AE.data, appData.globalMonth]);

  // 5. DATA GENERATION ACTION
  const handleGenerateReport = useCallback(async () => {
    const rawSrc = appData.Bank_North_AE.data;
    if (rawSrc.length === 0) {
      toast.error(
        "KHÔNG CÓ DỮ LIỆU: Không tìm thấy dữ liệu ngân hàng để xuất bảng kê.",
      );
      return;
    }

    const currentMonthVal = appData.globalMonth || "03.2026";
    const currentPeriodParts = currentMonthVal.split(".");
    const currentMonthNum = parseInt(currentPeriodParts[0], 10) || 3;
    const currentYearNum = parseInt(currentPeriodParts[1], 10) || 2026;
    const targetMonthLabel = `Tháng ${currentMonthNum}/${currentYearNum}`;

    const src = rawSrc.filter((r) => {
      const rowMonthRaw = String(r["Tháng báo cáo"] || r["_fileMonth"] || r["Tháng"] || "").trim();
      const extracted = monMatchComp(rowMonthRaw);
      if (extracted && extracted !== targetMonthLabelComp) return false;
      if (!extracted && rowMonthRaw && !isMonthInStrComp(rowMonthRaw)) return false;
      return true;
    });

    if (src.length === 0) {
      toast.error(
        `KHÔNG CÓ DỮ LIỆU THÁNG: Không tìm thấy dữ liệu ngân hàng cho ${targetMonthLabel}.`,
      );
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setReportStats(null);

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      setProgress((i / steps) * 100);
    }

    try {
      const bankNorthTotal = src.reduce(
        (sum, r) => sum + parseMoneyToNumber(r["TOTAL PAYMENT"] || 0),
        0,
      );

      const bizMap: Record<string, string> = {
        NORTH: "AHN",
        "PHU THO": "APT",
        "THANH HOA": "ATH",
        "THAI NGUYEN": "ATN",
      };

      const bankNorthBizTotals: Record<string, number> = {};
      const idToSheet1: Record<string, any> = {};
      const nameToSheet1: Record<string, any> = {};
      const accToSheet1: Record<string, any> = {};

      appData.Sheet1_AE.data.forEach((row) => {
        const id = String(row["ID Number"] || "").trim();
        if (!id) return; // BỎ QUA NẾU TRỐNG ID NUMBER
        const name = removeVietnameseTones(row["Full name"] || "").toUpperCase();
        const acc = String(row["Bank Account Number"] || "").trim();

        let calculatedBiz = row["Business"] || "Unknown";
        if (calculatedBiz === "AHN_HP") {
          calculatedBiz = "AHP";
        }

        const info = {
          biz: calculatedBiz,
          bank: String(row["Bank Name"] || "").trim(),
          month: String(row["Tháng"] || "").trim(),
          taxCode: row["TAX CODE"] || "",
          contractNo: row["Contract No"] || "",
        };

        if (id) idToSheet1[id] = info;
        if (name) nameToSheet1[name] = info;
        if (acc) accToSheet1[acc] = info;
      });

      src.forEach((row) => {
        const id = String(row["ID Number"] || "").trim();
        const name = removeVietnameseTones(row["Full name"] || "").toUpperCase();
        const acc = String(row["Bank Account Number"] || "").trim();

        let info = idToSheet1[id];
        if (!info && name) info = nameToSheet1[name];

        const biz = info ? info.biz : "Unknown";
        const amount = parseMoneyToNumber(row["TOTAL PAYMENT"] || 0);
        bankNorthBizTotals[biz] = (bankNorthBizTotals[biz] || 0) + amount;
      });

      const reportBizTotals: Record<string, number> = {};
      let matchedCount = 0;
      let unknownBizCount = 0;

      const data = src.map((row, idx) => {
        const id = String(row["ID Number"] || "").trim();
        const name = removeVietnameseTones(row["Full name"] || "").toUpperCase();
        const acc = String(row["Bank Account Number"] || "").trim();

        let sheet1Info = idToSheet1[id];
        if (!sheet1Info && name) sheet1Info = nameToSheet1[name];

        if (sheet1Info) matchedCount++;

        sheet1Info = sheet1Info || {
          bank: "",
          month: "",
          taxCode: "",
          contractNo: "",
          biz: "Unknown",
        };

        const monthVal = String(
          row["_fileMonth"] || row["Tháng"] || sheet1Info.month || "",
        ).trim();
        const bankVal = String(
          row["_fileBank"] || sheet1Info.bank || sheet1Info._fileBank || "",
        ).trim().toUpperCase();

        const paymentDetails = `Intern ${bankVal} salary ${monthVal}`
          .replace(/\s+/g, " ")
          .trim();

        let identifiedBiz = "Unknown";
        if (sheet1Info && sheet1Info.biz && sheet1Info.biz !== "Unknown") {
          identifiedBiz = sheet1Info.biz;
        }
        if (identifiedBiz === "AHN_HP") {
          identifiedBiz = "AHP";
        }
        if (identifiedBiz === "Unknown") {
          for (const [key, code] of Object.entries(bizMap)) {
            if (paymentDetails.toUpperCase().includes(key)) {
              identifiedBiz = code;
              break;
            }
          }
        }

        if (identifiedBiz === "Unknown") unknownBizCount++;

        const amount = parseMoneyToNumber(row["TOTAL PAYMENT"] || 0);
        reportBizTotals[identifiedBiz] = (reportBizTotals[identifiedBiz] || 0) + amount;

        return {
          id: generateUUID(),
          "Payment Serial Number": idx + 1,
          "Tháng báo cáo": appData.globalMonth || "03.2026",
          "Transaction Type Code": "BT",
          "Payment Type": "",
          "Customer Reference No": "",
          "Beneficiary Account No.": String(row["Bank Account Number"] || ""),
          "Beneficiary Name": removeVietnameseTones(row["Full name"] || ""),
          "Document ID": String(row["ID Number"] || row["Mã AE"] || row["Mã ae"] || row["Document ID"] || row["CCCD"] || row["ID"] || ""),
          "Place of Issue": "",
          "ID Issuance Date": "",
          "Beneficiary Bank Swift Code / IFSC Code": "",
          "Transaction Currency": "VND",
          "Payment Amount": amount,
          "Charge Type": "OUR",
          "Payment details": paymentDetails,
          "Beneficiary - Nick Name": "",
          "Beneficiary Addr. Line 1": "",
          "Beneficiary Addr. Line 2": "",
        };
      });

      const generatedAt = new Date().toISOString();
      const reconciliationTotals = calculateReconciliationTotals(
        appData,
        currentMonthVal,
      );
      updateAppData((prev) => {
        const next = {
          ...prev,
          BankExport: {
            ...prev.BankExport,
            data: data,
          },
          ReconciliationByMonth: {
            ...(prev.ReconciliationByMonth || {}),
            [currentMonthVal]: { ...reconciliationTotals, generatedAt },
          },
          TransactionActivity: markTransactionGenerated(prev, generatedAt),
        };
        return cacheActiveTransactionMonth(next);
      }, true, true, ["BankExport"]);

      const reportTotal = data.reduce((sum, r) => sum + r["Payment Amount"], 0);
      const isTotalMatch = Math.abs(reportTotal - bankNorthTotal) < 1;

      const sheet1Totals: Record<string, number> = {};
      appData.Sheet1_AE.data.forEach((r) => {
        const id = String(r["ID Number"] || r["Mã AE"] || r["Mã ae"] || "").trim();
        if (!id) return; // BỎ QUA NẾU TRỐNG ID NUMBER
        const rowMonthStr = String(r["Tháng báo cáo"] || "").trim();
        if (!isSameMonthForSumIf(rowMonthStr, currentMonthVal)) return;
        let biz = r["Business"] || "Unknown";
        if (biz === "AHN_HP") biz = "AHP";
        const amount = parseMoneyToNumber(r["TOTAL PAYMENT"] || r["Payment Amount"] || r["Grand Total"] || r["GRAND TOTAL"] || r["Total Payment"] || 0);
        sheet1Totals[biz] = (sheet1Totals[biz] || 0) + amount;
      });
      
      const holdAddItems: { month: string; biz: string; reason: string; amount: number; contribution: number; type: 'HOLD' | 'ADD' | 'CANCEL' }[] = [];
      appData.Hold_AE.data.forEach((r) => {
        const entry = getDeductionReportEntry(r, currentMonthVal);
        if (!entry) return;
        if (entry.amount !== 0) {
          let biz = r["Business"] || r["BU"] || "Unknown";
          if (biz === "AHN_HP") biz = "AHP";
          
          if (biz === "Unknown" || !biz || biz === "UNKNOWN") {
            const textToMatch = [ r["Sheet Source"], r["CENTER NOTE"], r["Mã ae"], r["Note"], r["Full name"] ]
              .map(v => String(v || "").toUpperCase()).join(" ");
            if (textToMatch.includes("HN") || textToMatch.includes("AHN")) biz = "AHN";
            else if (textToMatch.includes("AHP") || textToMatch.includes("HAIPHONG")) biz = "AHP";
            else if (textToMatch.includes("ATH") || textToMatch.includes("THANH HOA")) biz = "ATH";
            else if (textToMatch.includes("ATN") || textToMatch.includes("THAI NGUYEN")) biz = "ATN";
            else if (textToMatch.includes("APT") || textToMatch.includes("PHU THO")) biz = "APT";
            else biz = "AHN";
          }

          holdAddItems.push({
            month: String(r["Tháng phát sinh"] || r["Tháng báo cáo"] || "").trim(),
            biz,
            reason: String(r["Nghiệp vụ"] || r["Ghi chú"] || "N/A"),
            amount: entry.amount,
            contribution: entry.contribution,
            type: entry.type
          });
        }
      });
      
      const finalTotals: Record<string, number> = { ...sheet1Totals };
      holdAddItems.forEach(item => {
        const contribution = item.contribution;
        finalTotals[item.biz] = (finalTotals[item.biz] || 0) + contribution;
      });

      const bizDiffs: string[] = [];
      const allBiz = new Set([
        ...Object.keys(bankNorthBizTotals),
        ...Object.keys(reportBizTotals),
      ]);
      allBiz.forEach((biz) => {
        const north = bankNorthBizTotals[biz] || 0;
        const report = reportBizTotals[biz] || 0;
        if (Math.abs(north - report) > 1) {
          bizDiffs.push(`${biz}: Lệch ${formatMoneyVND(report - north)}`);
        }
      });

      const success = isTotalMatch && bizDiffs.length === 0;
      setIsSuccess(success);
      setReportStats({
        sheet1Totals,
        holdAddItems,
        finalTotals,
        isSuccess: success,
        bizDiffs
      });

      if (success) {
        toast.success(
          `Tạo bảng kê thành công! Đã khớp ${matchedCount}/${src.length} nhân sự.`,
        );
      } else {
        toast.warning(
          "Bảng kê đã được tạo nhưng phát hiện sai lệch dữ liệu. Vui lòng kiểm tra chi tiết.",
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Đã xảy ra lỗi trong quá trình xử lý dữ liệu.");
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, [appData, updateAppData, isMonthInStrComp, monMatchComp, targetMonthLabelComp]);

  // 6. CLEAR REPORT
  const handleClearReport = useCallback(() => {
    updateAppData((prev) => ({
      ...prev,
      BankExport: { ...prev.BankExport, data: [] },
      TransactionMonthCache: undefined,
    }));
    setReportStats(null);
    toast.success("Đã xóa dữ liệu bảng kê");
  }, [updateAppData]);

  // 7. EXPORT EXCEL
  const handleExportExcel = useCallback(() => {
    if (appData.BankExport.data.length === 0) return;

    // ID Number/Document ID remains available in the Transaction UI for
    // reconciliation, but the bank import form requires that column blank.
    downloadTransactionBankExport(appData.BankExport.data);
  }, [appData.BankExport.data]);

  // 8. DATA TABLE ROW & CELL EDIT HANDLERS
  const handleCellChange = useCallback((row: any, colKey: string, value: any) => {
    setTransactionDraft((currentDraft) =>
      applyTransactionDraftCellEdit(
        savedBankExportRows,
        currentDraft,
        row,
        colKey,
        value,
      ),
    );
  }, [savedBankExportRows]);

  const hasPendingTransactionEdits =
    Boolean(activeTransactionDraft) || hasPendingTransactionEditsInData(appData);

  const handleSaveTransactionEdits = useCallback(() => {
    if (!hasPendingTransactionEdits) return;

    if (activeTransactionDraft) {
      updateAppData(
        (prev) => saveTransactionDraft(prev, activeTransactionDraft) || prev,
        true,
        true,
      );
      setTransactionDraft(null);
    } else {
      // Compatibility for edits made by the immediately preceding release,
      // where cell changes were already written into BankExport before Save.
      updateAppData((prev) => {
        if (!hasPendingTransactionEditsInData(prev)) return prev;
        return {
          ...prev,
          TransactionActivity: commitTransactionEdits(prev),
        };
      }, true, true);
    }

    toast.success(
      "Đã lưu sửa Batch Payment trên máy. Bấm Lưu tháng để cập nhật Supabase và lịch sử Check STK & ID.",
    );
  }, [activeTransactionDraft, hasPendingTransactionEdits, updateAppData]);

  const handleDeleteRow = useCallback((rowToDelete: any) => {
    updateAppData((prev) => {
      const includesDraft =
        Boolean(activeTransactionDraft) &&
        prev.BankExport.data === activeTransactionDraft?.sourceRows;
      const data = includesDraft
        ? activeTransactionDraft!.rows
        : prev.BankExport.data;
      const rowIndex = data.findIndex(
        (r) =>
          r === rowToDelete ||
          (r.id && rowToDelete.id && r.id === rowToDelete.id) ||
          (r["Payment Serial Number"] &&
            rowToDelete["Payment Serial Number"] &&
            r["Payment Serial Number"] === rowToDelete["Payment Serial Number"])
      );
      if (rowIndex === -1) return prev;
      
      const newData = [...data];
      newData.splice(rowIndex, 1);
      const updatedData = newData.map((row, idx) => ({
        ...row,
        "Payment Serial Number": idx + 1,
      }));
      return cacheActiveTransactionMonth({
        ...prev,
        BankExport: { ...prev.BankExport, data: updatedData },
        TransactionActivity: includesDraft
          ? commitTransactionEdits(
              prev,
              new Date().toISOString(),
              activeTransactionDraft!.editCount + 1,
            )
          : markTransactionSaved(prev),
      });
    });
    setTransactionDraft(null);
  }, [activeTransactionDraft, updateAppData]);

  const handleDeleteRows = useCallback((rowsToDelete: any[]) => {
    updateAppData((prev) => {
      const includesDraft =
        Boolean(activeTransactionDraft) &&
        prev.BankExport.data === activeTransactionDraft?.sourceRows;
      const data = [
        ...(includesDraft
          ? activeTransactionDraft!.rows
          : prev.BankExport.data),
      ];
      let hasChanges = false;
      
      // We identify rows by original reference or unique fields before any deletion happens
      const rowsToRemoveSet = new Set(rowsToDelete);
      const idsToRemove = new Set(rowsToDelete.map(r => r.id).filter(Boolean));
      const serialsToRemove = new Set(rowsToDelete.map(r => r["Payment Serial Number"]).filter(Boolean));
      
      const newData = data.filter(r => {
         const shouldRemove = rowsToRemoveSet.has(r) || 
                              (r.id && idsToRemove.has(r.id)) || 
                              (r["Payment Serial Number"] && serialsToRemove.has(r["Payment Serial Number"]));
         if (shouldRemove) hasChanges = true;
         return !shouldRemove;
      });

      if (!hasChanges) return prev;
      
      const updatedData = newData.map((row, idx) => ({
        ...row,
        "Payment Serial Number": idx + 1,
      }));
      return cacheActiveTransactionMonth({
        ...prev,
        BankExport: { ...prev.BankExport, data: updatedData },
        TransactionActivity: includesDraft
          ? commitTransactionEdits(
              prev,
              new Date().toISOString(),
              activeTransactionDraft!.editCount + 1,
            )
          : markTransactionSaved(prev),
      });
    });
    setTransactionDraft(null);
  }, [activeTransactionDraft, updateAppData]);

  const handleRefresh = useCallback(() => restoreTable(["BankExport"]), [restoreTable]);

  // 9. TEXT REPORT FORMATTERS & COPY FUNCTIONS
  const generateAllSummaryText = useCallback(() => {
    const buDetailsText = [
      { name: "AHN", value: holdPaymentDetails.ahnT5 },
      { name: "AHP", value: holdPaymentDetails.ahpT5 },
      { name: "ATH", value: holdPaymentDetails.athT5 },
      { name: "ATN", value: holdPaymentDetails.atnT5 },
      { name: "APT", value: holdPaymentDetails.aptT5 },
    ]
      .map((bu) => `${bu.name}:\t${formatMoneyVND(bu.value).replace(" ₫", "")}`)
      .join("\n");

    const sheet1Text = Object.entries(dynamicReportStats?.sheet1Totals || {})
      .map(([biz, amount]) => `${biz}:\t${formatMoneyVND(amount).replace(" ₫", "")}`)
      .join("\n") || "Sheet 1:\t0";

    const holdAddText = dynamicReportStats?.holdAddItems && dynamicReportStats.holdAddItems.length > 0
      ? (() => {
          const aggregated = dynamicReportStats.holdAddItems.reduce<Record<string, { biz: string; type: string; amount: number }>>((acc, item) => {
            const key = `${item.biz}-${item.type}`;
            if (!acc[key]) {
              acc[key] = { biz: item.biz, type: item.type, amount: 0 };
            }
            acc[key].amount += item.amount;
            return acc;
          }, {});
          
          return Object.values(aggregated)
            .map((item) => `${item.biz} [${item.type}]:\t${item.amount >= 0 ? "+" : ""}${formatMoneyVND(item.amount).replace(" ₫", "")}`)
            .join("\n");
        })()
      : "Hold/Add:\t0";

    const finalTotalsText = Object.entries(dynamicReportStats?.finalTotals || {})
      .map(([biz, amount]) => `${biz}:\t${formatMoneyVND(amount).replace(" ₫", "")}`)
      .join("\n");

    const totalBulkPayment = calculationSummary.aeTotal;

    return `BÁO CÁO CHI TIẾT SỐ TIỀN THEO BU\t${appData.globalMonth || "03.2026"}
Số dòng dữ liệu:\t${appData.BankExport?.data?.length || 0} dòng

I. CHI TIẾT SỐ TIỀN THEO BU:
${buDetailsText}

BANK NORTH (AHN+AHP):\t${formatMoneyVND(holdPaymentDetails.bankNorthT5).replace(" ₫", "")}
BANK TỈNH (ATH+ATN+APT):\t${formatMoneyVND(holdPaymentDetails.bankTinhT5Ae).replace(" ₫", "")}

II. CHI PHÍ THÁNG BÁO CÁO (SHEET 1):
${sheet1Text}

III. SỐ TIỀN HOLD / ADD THEO MỤC:
${holdAddText}

IV. SỐ TIỀN THANH TOÁN THEO BU:
${finalTotalsText}

V. TỔNG HỢP ĐỐI SOÁT TÀI KHOẢN (ACCOUNT RECONCILIATION):
TỔNG BULK PAYMENT:\t${formatMoneyVND(totalBulkPayment).replace(" ₫", "")}
TỔNG TIỀN ACC:\t${formatMoneyVND(calculationSummary.calculatedTotal).replace(" ₫", "")}
HOLD (CÙNG THÁNG):\t-${formatMoneyVND(dynamicReportStats?.sameMonthHoldTotal || 0).replace(" ₫", "")}
ADD (KHÁC THÁNG):\t+${formatMoneyVND(dynamicReportStats?.diffMonthAddTotal || 0).replace(" ₫", "")}
TỔNG TIỀN BANK AE:\t${formatMoneyVND(calculationSummary.calculatedTotal - calculationSummary.diff).replace(" ₫", "")}
LỆCH ACC & AE:\t${formatMoneyVND(calculationSummary.diff).replace(" ₫", "")}`;
  }, [holdPaymentDetails, dynamicReportStats, appData.BankExport?.data?.length, appData.globalMonth, calculationSummary]);

  return {
    // Data & Calculations
    globalMonth: appData.globalMonth || "03.2026",
    monthPeriod,
    holdPaymentDetails,
    calculationSummary,
    dynamicReportStats,
    remainingHoldByMonth,
    bankExportData: activeTransactionDraft?.rows || savedBankExportRows,
    
    // Process States
    isGenerating,
    progress,
    isSuccess,
    reportStats,
    isRefreshing,
    hasPendingTransactionEdits,

    // Helpers
    monMatchComp,
    isMonthInStrComp,

    // Operations
    handleGenerateReport,
    handleClearReport,
    handleExportExcel,
    handleCellChange,
    handleSaveTransactionEdits,
    handleDeleteRow,
    handleDeleteRows,
    handleRefresh,

    // Report Summary Text Generator
    generateAllSummaryText,
  };
}
