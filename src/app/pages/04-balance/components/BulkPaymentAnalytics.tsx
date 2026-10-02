import { registerTableExport } from "../../../lib/utils/table-excel";
import { chooseExcelExport } from "../../../components/ExportScopeDialog";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Download,
  RefreshCw,
  Search,
  Settings,
  Table2,
  Scale,
  BarChart2,
  X,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  Filter,
} from "lucide-react";
import { DataTable, type Column, isAhpBuValue } from "../../../components/DataTable";
import {
  TableInitialMark,
  TableTitleRemainder,
} from "../../../components/TableInitialMark";
import {
  type BulkPaymentAnalyticsResult,
  type PayrollBuMonthSummaryRow,
  type MonthPeriod,
  parseMonthPeriod,
  periodFromParts,
  formatPeriod,
  comparePeriods,
  extractOccurrencePeriod,
  extractReportPeriod,
  isUsableHoldRow,
  classifyHoldOperation,
  dimensionsOf,
  moneyOf,
  fullNameOf,
  employeeIdOf,
} from "../../../lib/utils/bulk-payment-analytics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
} from "../../../components/ui/dialog";
import { useAppData } from "../../../lib/contexts/AppDataContext";
import { removeVietnameseTones } from "../../../lib/utils/data-utils";
import { toast } from "sonner";

interface BulkPaymentAnalyticsProps {
  analytics: BulkPaymentAnalyticsResult;
  selectedBusiness: string;
  allBusinessUnitsValue: string;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onSelectedBusinessChange: (value: string) => void;
  searchVisible: boolean;
  onSearchVisibleChange: (visible: boolean) => void;
  onResetFilters: () => void;
  isBulkPaymentCardVisible: boolean;
  onToggleBulkPaymentCard: () => void;
  onViewChange: (view: "table" | "reconcile" | "visuals") => void;
  onDrilldownToTransaction?: (bu: string, month: string) => void;
}

const CONTEXT_GROUP = "I. THÔNG TIN KỲ THEO DÕI";
const ORIGIN_GROUP = "II. SỐ DƯ TRƯỚC KỲ BÁO CÁO";
const MOVEMENT_GROUP = "III. PHÁT SINH TẠI KỲ BÁO CÁO";
const RESULT_GROUP = "IV. KẾT QUẢ ĐẾN CUỐI KỲ";

const CONTEXT_GROUP_STYLE =
  "!bg-primary/[0.04] !text-primary border-primary/15 tracking-[0.08em] py-2 leading-normal";
const ORIGIN_GROUP_STYLE =
  "!bg-primary/[0.07] !text-primary border-primary/20 tracking-[0.08em] py-2 leading-normal";
const MOVEMENT_GROUP_STYLE =
  "!bg-primary/[0.10] !text-primary border-primary/25 tracking-[0.08em] py-2 leading-normal";
const RESULT_GROUP_STYLE =
  "!bg-primary/[0.12] !text-primary border-primary/30 tracking-[0.08em] py-2 leading-normal";

const formatAmount = (value: number) => {
  const rounded = Math.round(value);
  return rounded.toLocaleString("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

export type QuickFilterType = "all" | "has_remaining" | "has_paid" | "has_new_hold" | "has_cancel";
export type DrilldownCategory =
  | "remaining_unpaid"
  | "paid_in_period"
  | "cancel_in_period"
  | "opening"
  | "total_hold"
  | "all";
export type DrilldownViewMode = "teachers" | "transactions";

export interface ModalDetailRecord {
  id: string;
  stt: number;
  "No."?: number;
  aeCode: string;
  name: string;
  center: string;
  op: "HOLD" | "ADD" | "CANCEL";
  amount: number;
  Amount: number;
  reportPeriod: MonthPeriod;
  occurrencePeriod: MonthPeriod;
  reportMonth: string;
  note: string;
  raw: any;
}

/**
 * 1. TẠO DATA GỐC CHUNG (Single Source of Truth)
 * Hàm getModalDetailData trả về mảng các record thỏa mãn:
 * - Thuộc BU được chọn
 * - Thuộc Tháng phát sinh được chọn
 * - Là khoản HOLD / ADD / CANCEL hợp lệ
 */
function getModalDetailData(
  holdList: any[],
  targetBu: string,
  targetMonthStr: string,
  currentPeriod: MonthPeriod,
): ModalDetailRecord[] {
  if (!holdList || !targetBu || !targetMonthStr) return [];
  const targetOccurrencePeriod = parseMonthPeriod(targetMonthStr, currentPeriod);
  if (!targetOccurrencePeriod) return [];

  const normTargetBu = targetBu.trim().toUpperCase();
  const results: ModalDetailRecord[] = [];

  holdList.forEach((item: any, idx: number) => {
    if (!item || !isUsableHoldRow(item)) return;

    const op = classifyHoldOperation(item);
    if (!op) return;

    const reportPeriod = extractReportPeriod(item, currentPeriod);
    const occurrencePeriod = extractOccurrencePeriod(item, reportPeriod);

    if (!reportPeriod || !occurrencePeriod) return;

    // Bỏ qua các kỳ báo cáo/phát sinh tương lai so với kỳ hiện tại
    if (comparePeriods(reportPeriod, currentPeriod) > 0) return;
    if (comparePeriods(occurrencePeriod, currentPeriod) > 0) return;

    // Phải khớp đúng Tháng phát sinh (Tháng HOLD)
    if (comparePeriods(occurrencePeriod, targetOccurrencePeriod) !== 0) {
      return;
    }

    // Khớp BU
    const directDims = dimensionsOf(item);
    let resolvedBu = directDims.business;
    if (!resolvedBu || resolvedBu === "OTHER" || resolvedBu === "UNKNOWN") {
      const combinedText = [
        item["Sheet Source"],
        item["CENTER NOTE"],
        item["Center"],
        item["Center Code"],
        item["L07"],
        item["ID NUMBER"],
        item["Note"],
        item["Ghi chú"],
        item["Full name"],
      ]
        .map((v) => String(v || "").toUpperCase())
        .join(" ");

      if (
        combinedText.includes("AHP") ||
        combinedText.includes("HAIPHONG") ||
        combinedText.includes("HAI PHONG")
      ) {
        resolvedBu = "AHP";
      } else if (
        combinedText.includes("ATH") ||
        combinedText.includes("THANH HOA") ||
        combinedText.includes("THANH HÓA")
      ) {
        resolvedBu = "ATH";
      } else if (
        combinedText.includes("ATN") ||
        combinedText.includes("THAI NGUYEN") ||
        combinedText.includes("THÁI NGUYÊN")
      ) {
        resolvedBu = "ATN";
      } else if (
        combinedText.includes("APT") ||
        combinedText.includes("PHU THO") ||
        combinedText.includes("PHÚ THỌ")
      ) {
        resolvedBu = "APT";
      } else if (
        combinedText.includes("AHN") ||
        combinedText.includes("HA NOI") ||
        combinedText.includes("HÀ NỘI")
      ) {
        resolvedBu = "AHN";
      } else {
        resolvedBu = "AHN";
      }
    }

    if (normTargetBu && resolvedBu.toUpperCase() !== normTargetBu) {
      return;
    }

    const rawAmt = moneyOf(item);
    const amount = Math.abs(rawAmt);

    const name = fullNameOf(item);
    const aeCode = employeeIdOf(item);
    const center =
      directDims.l07 ||
      item["Center"] ||
      item["Center Code"] ||
      item["Charge to center"] ||
      "";
    const note =
      item["Ghi chú"] ||
      item["Note"] ||
      item["Lý do"] ||
      item["Nội dung"] ||
      "";
    const reportMonth = formatPeriod(reportPeriod);

    results.push({
      id: item.id || item._recordId || `modal_rec_${idx}`,
      stt: results.length + 1,
      "No.": results.length + 1,
      aeCode,
      name,
      center,
      op,
      amount,
      Amount: amount,
      reportPeriod,
      occurrencePeriod,
      reportMonth,
      note,
      raw: item,
    });
  });

  return results;
}

export function BulkPaymentAnalytics({
  analytics,
  selectedBusiness,
  allBusinessUnitsValue,
  searchTerm,
  onSearchTermChange,
  onSelectedBusinessChange,
  searchVisible,
  onSearchVisibleChange,
  onResetFilters,
  isBulkPaymentCardVisible,
  onToggleBulkPaymentCard,
  onViewChange,
  onDrilldownToTransaction,
}: BulkPaymentAnalyticsProps) {
  const { appData } = useAppData();
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("all");
  const [drilldownRow, setDrilldownRow] = useState<PayrollBuMonthSummaryRow | null>(null);
  const [drilldownCategory, setDrilldownCategory] = useState<DrilldownCategory>("all");
  const [drilldownViewMode, setDrilldownViewMode] = useState<DrilldownViewMode>("teachers");
  const [drilldownSearch, setDrilldownSearch] = useState("");

  const handleOpenDrilldown = (
    row: PayrollBuMonthSummaryRow,
    category: DrilldownCategory = "all",
  ) => {
    setDrilldownRow(row);
    setDrilldownCategory(category);
    setDrilldownSearch("");
  };

  const effectiveSelectedBusiness =
    selectedBusiness === allBusinessUnitsValue ||
    selectedBusiness === "EXCLUDE_AHP" ||
    analytics.businessUnits.includes(selectedBusiness)
      ? selectedBusiness
      : allBusinessUnitsValue;

  const baseRows = useMemo(() => {
    if (effectiveSelectedBusiness === "EXCLUDE_AHP") {
      return analytics.summaryRows.filter((row) => !isAhpBuValue(row.BU));
    }
    return effectiveSelectedBusiness === allBusinessUnitsValue
      ? analytics.summaryRows
      : analytics.summaryRows.filter(
          (row) => row.BU === effectiveSelectedBusiness,
        );
  }, [
    allBusinessUnitsValue,
    analytics.summaryRows,
    effectiveSelectedBusiness,
  ]);

  const periodSummary = useMemo(() => {
    return baseRows.reduce(
      (summary, row) => {
        summary.totalInitial += Number(row["Tổng số dư HOLD"] || 0);
        summary.opening += Number(row["Số dư HOLD đầu kỳ"] || 0);
        summary.hold += Number(row["HOLD phát sinh"] || 0);
        summary.paid += Number(row["Thanh toán HOLD tại kỳ"] || 0);
        summary.cancel += Number(row["CANCEL tại kỳ"] || 0);
        summary.remaining += Number(row["Số dư HOLD còn lại"] || 0);
        return summary;
      },
      {
        totalInitial: 0,
        opening: 0,
        hold: 0,
        paid: 0,
        cancel: 0,
        remaining: 0,
      },
    );
  }, [baseRows]);

  const filteredRows = useMemo(() => {
    let rows = baseRows;

    if (quickFilter === "has_remaining") {
      rows = rows.filter((r) => Number(r["Số dư HOLD còn lại"] || 0) > 0);
    } else if (quickFilter === "has_paid") {
      rows = rows.filter((r) => Number(r["Thanh toán HOLD tại kỳ"] || 0) > 0);
    } else if (quickFilter === "has_new_hold") {
      rows = rows.filter((r) => Number(r["HOLD phát sinh"] || 0) > 0);
    } else if (quickFilter === "has_cancel") {
      rows = rows.filter((r) => Number(r["CANCEL tại kỳ"] || 0) > 0);
    }

    return rows.map((row, index) => ({
      ...row,
      "No.": index + 1,
    }));
  }, [baseRows, quickFilter]);

  useEffect(() => registerTableExport("master-analysis", () => ({
    schema: { columns: [
      ["No.", "No."], ["BU", "BU"], ["Tháng HOLD", "THÁNG PHÁT SINH HOLD"],
      ["Tổng số dư HOLD", "TỔNG SỐ DƯ HOLD"], ["Số dư HOLD đầu kỳ", "SỐ DƯ TRƯỚC KỲ BÁO CÁO"],
      ["HOLD phát sinh", "HOLD PHÁT SINH"], ["Thanh toán HOLD tại kỳ", "THANH TOÁN HOLD"],
      ["CANCEL tại kỳ", "CANCEL"], ["Các tháng đã thanh toán", "LỊCH SỬ THANH TOÁN HOLD"],
      ["Số dư HOLD còn lại", "SỐ DƯ HOLD CÒN LẠI"], ["Trạng thái HOLD", "TRẠNG THÁI HOLD"],
    ].map(([key, label]) => ({key, label})), hiddenColumns: [] },
    rows: filteredRows,
  })), [filteredRows]);

  const currentPeriod = useMemo(() => {
    return (
      parseMonthPeriod(analytics.currentPeriod) ||
      (drilldownRow ? parseMonthPeriod(drilldownRow["Kỳ báo cáo"]) : null) ||
      periodFromParts(new Date().getMonth() + 1, new Date().getFullYear())!
    );
  }, [analytics.currentPeriod, drilldownRow]);

  // 1. TẠO DATA GỐC CHUNG (Single Source of Truth):
  const filteredRecords = useMemo(() => {
    if (!drilldownRow) return [];
    return getModalDetailData(
      appData.Hold_AE?.data || [],
      drilldownRow.BU,
      drilldownRow["Tháng HOLD"],
      currentPeriod,
    );
  }, [drilldownRow, appData.Hold_AE?.data, currentPeriod]);

  // 2. BẢNG HIỂN THỊ DÙNG DATA ĐÓ (Group by teacher directly from filteredRecords without any exclusions):
  const teacherSummaries = useMemo(() => {
    if (!drilldownRow || filteredRecords.length === 0) return [];

    const targetOccurrencePeriod = parseMonthPeriod(
      drilldownRow["Tháng HOLD"],
      currentPeriod,
    );
    const isCurrentMonthOccurrence =
      targetOccurrencePeriod &&
      comparePeriods(targetOccurrencePeriod, currentPeriod) === 0;

    const map = new Map<
      string,
      {
        aeCode: string;
        name: string;
        center: string;
        holdInOccurrence: number;
        holdInLater: number;
        paidBefore: number;
        paidInPeriod: number;
        cancelBefore: number;
        cancelInPeriod: number;
        notes: string[];
        records: ModalDetailRecord[];
      }
    >();

    for (const rec of filteredRecords) {
      const key = rec.aeCode ? rec.aeCode.toUpperCase() : rec.name.toUpperCase();
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          aeCode: rec.aeCode,
          name: rec.name,
          center: rec.center,
          holdInOccurrence: 0,
          holdInLater: 0,
          paidBefore: 0,
          paidInPeriod: 0,
          cancelBefore: 0,
          cancelInPeriod: 0,
          notes: [],
          records: [],
        });
      }

      const entry = map.get(key)!;
      if (!entry.center && rec.center) entry.center = rec.center;
      if (!entry.aeCode && rec.aeCode) entry.aeCode = rec.aeCode;
      if (!entry.name && rec.name) entry.name = rec.name;
      if (rec.note && !entry.notes.includes(rec.note)) entry.notes.push(rec.note);
      entry.records.push(rec);

      const before = comparePeriods(rec.reportPeriod, currentPeriod) < 0;

      if (rec.op === "HOLD") {
        const relToOccurrence = comparePeriods(
          rec.reportPeriod,
          rec.occurrencePeriod,
        );
        if (relToOccurrence <= 0) {
          entry.holdInOccurrence += rec.amount;
        } else {
          entry.holdInLater = Math.max(entry.holdInLater, rec.amount);
        }
      } else if (rec.op === "ADD") {
        if (before) {
          entry.paidBefore += rec.amount;
        } else {
          entry.paidInPeriod += rec.amount;
        }
      } else if (rec.op === "CANCEL") {
        if (before) {
          entry.cancelBefore += rec.amount;
        } else {
          entry.cancelInPeriod += rec.amount;
        }
      }
    }

    return Array.from(map.values()).map((t, index) => {
      let totalHold = 0;
      let opening = 0;
      let remaining = 0;

      if (isCurrentMonthOccurrence) {
        totalHold =
          t.holdInOccurrence > 0
            ? t.holdInOccurrence
            : Math.max(
                t.holdInLater,
                t.paidBefore + t.paidInPeriod + t.cancelBefore + t.cancelInPeriod,
              );
        opening = 0;
        remaining = Math.max(0, totalHold - t.paidInPeriod - t.cancelInPeriod);
      } else {
        const baseHold = Math.max(t.holdInOccurrence, t.holdInLater);
        totalHold = Math.max(
          baseHold,
          t.paidBefore + t.paidInPeriod + t.cancelBefore + t.cancelInPeriod,
        );
        opening = Math.max(0, totalHold - t.paidBefore - t.cancelBefore);
        remaining = Math.max(0, opening - t.paidInPeriod - t.cancelInPeriod);
      }

      const totalPaid = t.paidBefore + t.paidInPeriod;
      const totalCancel = t.cancelBefore + t.cancelInPeriod;

      return {
        id: `teacher_${t.aeCode || index}_${index}`,
        stt: index + 1,
        "No.": index + 1,
        aeCode: t.aeCode,
        name: t.name,
        center: t.center,
        totalHold,
        paidBefore: t.paidBefore,
        paidInPeriod: t.paidInPeriod,
        cancelBefore: t.cancelBefore,
        cancelInPeriod: t.cancelInPeriod,
        opening,
        totalPaid,
        totalCancel,
        remaining,
        notes: t.notes.join("; "),
        records: t.records,
      };
    });
  }, [drilldownRow, filteredRecords, currentPeriod]);

  // 3. CARD TỔNG DÙNG DATA ĐÓ (Single Source of Truth):
  const modalTotals = useMemo(() => {
    // Giá trị hiển thị trên Card "TỔNG SỐ DƯ HOLD"
    const totalHold = teacherSummaries.reduce((sum, t) => sum + t.totalHold, 0);
    const opening = teacherSummaries.reduce((sum, t) => sum + t.opening, 0);
    const paidInPeriod = teacherSummaries.reduce((sum, t) => sum + t.paidInPeriod, 0);
    const cancelInPeriod = teacherSummaries.reduce((sum, t) => sum + t.cancelInPeriod, 0);
    const remaining = teacherSummaries.reduce((sum, t) => sum + t.remaining, 0);
    const totalPaid = teacherSummaries.reduce((sum, t) => sum + t.totalPaid, 0);
    const totalCancel = teacherSummaries.reduce((sum, t) => sum + t.totalCancel, 0);

    return {
      totalHold,
      opening,
      paidInPeriod,
      cancelInPeriod,
      remaining,
      totalPaid,
      totalCancel,
    };
  }, [teacherSummaries]);

  // Filter teacher summaries by category and search
  const filteredTeacherSummaries = useMemo(() => {
    let list = teacherSummaries;

    if (drilldownCategory === "remaining_unpaid") {
      list = list.filter((t) => t.remaining > 0);
    } else if (drilldownCategory === "paid_in_period") {
      list = list.filter((t) => t.paidInPeriod > 0);
    } else if (drilldownCategory === "cancel_in_period") {
      list = list.filter((t) => t.cancelInPeriod > 0);
    } else if (drilldownCategory === "opening") {
      list = list.filter((t) => t.opening > 0);
    } else if (drilldownCategory === "total_hold") {
      list = list.filter((t) => t.totalHold > 0);
    }

    if (drilldownSearch.trim()) {
      const lower = removeVietnameseTones(drilldownSearch.toLowerCase());
      list = list.filter((t) => {
        const combined = removeVietnameseTones(
          `${t.aeCode} ${t.name} ${t.center} ${t.notes}`.toLowerCase(),
        );
        return combined.includes(lower);
      });
    }

    return list.map((t, idx) => ({ ...t, stt: idx + 1, "No.": idx + 1 }));
  }, [teacherSummaries, drilldownCategory, drilldownSearch]);

  // Filter raw transactions by category and search
  const filteredDrilldownRecords = useMemo(() => {
    let list = filteredRecords;

    if (drilldownCategory === "remaining_unpaid") {
      const unpaidKeys = new Set(
        teacherSummaries
          .filter((t) => t.remaining > 0)
          .map((t) => (t.aeCode ? t.aeCode.toUpperCase() : t.name.toUpperCase())),
      );
      list = list.filter((r) => {
        const key = r.aeCode ? r.aeCode.toUpperCase() : r.name.toUpperCase();
        return unpaidKeys.has(key);
      });
    } else if (drilldownCategory === "paid_in_period") {
      list = list.filter((r) => r.op === "ADD");
    } else if (drilldownCategory === "cancel_in_period") {
      list = list.filter((r) => r.op === "CANCEL");
    } else if (drilldownCategory === "opening") {
      const openingKeys = new Set(
        teacherSummaries
          .filter((t) => t.opening > 0)
          .map((t) => (t.aeCode ? t.aeCode.toUpperCase() : t.name.toUpperCase())),
      );
      list = list.filter((r) => {
        const key = r.aeCode ? r.aeCode.toUpperCase() : r.name.toUpperCase();
        return openingKeys.has(key);
      });
    } else if (drilldownCategory === "total_hold") {
      list = list.filter((r) => r.op === "HOLD");
    }

    if (drilldownSearch.trim()) {
      const lower = removeVietnameseTones(drilldownSearch.toLowerCase());
      list = list.filter((rec) => {
        const combined = removeVietnameseTones(
          `${rec.aeCode} ${rec.name} ${rec.center} ${rec.op} ${rec.note} ${rec.reportMonth}`.toLowerCase(),
        );
        return combined.includes(lower);
      });
    }

    return list.map((r, idx) => ({ ...r, stt: idx + 1, "No.": idx + 1 }));
  }, [
    filteredRecords,
    drilldownCategory,
    drilldownSearch,
    teacherSummaries,
  ]);

  const SUMMARY_COLUMNS: Column[] = useMemo(
    () => [
      {
        key: "No.",
        label: "No.",
        group: CONTEXT_GROUP,
        groupHeaderClassName: CONTEXT_GROUP_STYLE,
        type: "number",
        width: 52,
        align: "center",
        sortable: true,
        filterable: false,
        readOnly: true,
        renderCell: ({ value }: { value: any }) => (
          <span className="tabular-nums text-center block text-slate-600 font-medium">
            {value !== undefined && value !== null && value !== ""
              ? Math.round(Number(value) || 0)
              : ""}
          </span>
        ),
      },
      {
        key: "BU",
        label: "BU",
        group: CONTEXT_GROUP,
        groupHeaderClassName: CONTEXT_GROUP_STYLE,
        type: "text",
        width: 82,
        align: "left",
        cellClassName: "font-extrabold text-slate-700",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: false,
        footerClassName: "!text-transparent",
      },
      {
        key: "Tháng HOLD",
        label: "THÁNG PHÁT SINH HOLD",
        group: ORIGIN_GROUP,
        groupHeaderClassName: ORIGIN_GROUP_STYLE,
        type: "date",
        width: 130,
        align: "center",
        cellClassName: "font-bold text-slate-700",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: false,
        footerClassName: "!text-transparent",
      },
      {
        key: "Tổng số dư HOLD",
        label: "TỔNG SỐ DƯ HOLD",
        group: ORIGIN_GROUP,
        groupHeaderClassName: ORIGIN_GROUP_STYLE,
        type: "money",
        width: 154,
        align: "right",
        headerClassName: "!bg-primary/[0.06] !text-primary",
        cellClassName: "font-bold text-slate-800 bg-primary/[0.015]",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "total_hold");
              }}
              className="w-full text-right tabular-nums font-bold text-slate-800 hover:text-primary hover:underline cursor-pointer"
              title="Bấm để xem danh sách toàn bộ các khoản HOLD ban đầu"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "Số dư HOLD đầu kỳ",
        label: "SỐ DƯ TRƯỚC KỲ BÁO CÁO",
        group: ORIGIN_GROUP,
        groupHeaderClassName: ORIGIN_GROUP_STYLE,
        type: "money",
        width: 154,
        align: "right",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "opening");
              }}
              className="w-full text-right tabular-nums font-bold text-slate-800 hover:text-amber-600 hover:underline cursor-pointer"
              title="Bấm để xem danh sách các khoản tồn HOLD trước kỳ báo cáo"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "HOLD phát sinh",
        label: "HOLD PHÁT SINH",
        group: MOVEMENT_GROUP,
        groupHeaderClassName: MOVEMENT_GROUP_STYLE,
        type: "money",
        width: 136,
        align: "right",
        headerClassName: "!bg-primary/[0.07] !text-primary",
        cellClassName: "font-bold text-primary bg-primary/[0.025]",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "total_hold");
              }}
              className="w-full text-right tabular-nums font-bold text-primary hover:underline cursor-pointer"
              title="Bấm để xem danh sách các khoản phát sinh HOLD"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "Thanh toán HOLD tại kỳ",
        label: "THANH TOÁN HOLD",
        group: MOVEMENT_GROUP,
        groupHeaderClassName: MOVEMENT_GROUP_STYLE,
        type: "money",
        width: 146,
        align: "right",
        headerClassName: "!bg-primary/[0.08] !text-primary",
        cellClassName: "font-extrabold text-primary bg-primary/[0.035]",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "paid_in_period");
              }}
              className={`w-full text-right tabular-nums font-extrabold hover:underline cursor-pointer ${
                num > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"
              }`}
              title="Bấm để xem danh sách Intern được thanh toán (ADD) tại kỳ này"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "CANCEL tại kỳ",
        label: "CANCEL",
        group: MOVEMENT_GROUP,
        groupHeaderClassName: MOVEMENT_GROUP_STYLE,
        type: "money",
        width: 118,
        align: "right",
        headerClassName: "!bg-primary/[0.09] !text-primary",
        cellClassName: "font-bold text-primary bg-primary/[0.04]",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "cancel_in_period");
              }}
              className="w-full text-right tabular-nums font-bold text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
              title="Bấm để xem danh sách các khoản hủy (CANCEL) tại kỳ này"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "Các tháng đã thanh toán",
        label: "LỊCH SỬ THANH TOÁN HOLD",
        group: MOVEMENT_GROUP,
        groupHeaderClassName: MOVEMENT_GROUP_STYLE,
        type: "text",
        width: 188,
        align: "left",
        cellClassName: "font-semibold text-primary whitespace-pre-wrap leading-5",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: false,
        footerClassName: "!text-transparent",
      },
      {
        key: "Số dư HOLD còn lại",
        label: "SỐ DƯ HOLD CÒN LẠI",
        group: RESULT_GROUP,
        groupHeaderClassName: RESULT_GROUP_STYLE,
        type: "money",
        width: 154,
        align: "right",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: true,
        cellClassName: "font-extrabold text-primary bg-primary/[0.05]",
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const num = Number(value) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, "remaining_unpaid");
              }}
              className={`w-full text-right tabular-nums font-black hover:underline cursor-pointer ${
                num > 0
                  ? "text-rose-700 dark:text-rose-400 font-extrabold"
                  : "text-emerald-700 dark:text-emerald-400 font-bold"
              }`}
              title="Bấm để xem danh sách Intern còn số dư HOLD chưa thanh toán"
            >
              {formatAmount(num)}
            </button>
          );
        },
      },
      {
        key: "Trạng thái HOLD",
        label: "TRẠNG THÁI HOLD",
        group: RESULT_GROUP,
        groupHeaderClassName: RESULT_GROUP_STYLE,
        type: "text",
        width: 146,
        align: "left",
        cellClassName: "font-bold text-slate-700",
        sortable: true,
        filterable: true,
        readOnly: true,
        showGrandTotal: false,
        footerClassName: "!text-transparent",
        renderCell: ({ value, row }: { value: any; row: any }) => {
          const remaining = Number(row["Số dư HOLD còn lại"]) || 0;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrilldown(row, remaining > 0 ? "remaining_unpaid" : "all");
              }}
              className="text-left font-bold hover:underline cursor-pointer"
            >
              {value}
            </button>
          );
        },
      },
      {
        key: "__ACTION__",
        label: "THAO TÁC",
        group: RESULT_GROUP,
        groupHeaderClassName: RESULT_GROUP_STYLE,
        type: "text",
        width: 120,
        align: "center",
        sortable: false,
        filterable: false,
        readOnly: true,
        showGrandTotal: false,
        footerClassName: "!text-transparent",
        renderCell: ({ row }: { row: any }) => {
          const remaining = Number(row["Số dư HOLD còn lại"]) || 0;
          return (
            <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenDrilldown(row, remaining > 0 ? "remaining_unpaid" : "all");
                }}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-all cursor-pointer ${
                  remaining > 0
                    ? "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 hover:bg-rose-200"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
                title={remaining > 0 ? "Xem danh sách khoản còn nợ" : "Xem chi tiết"}
              >
                <Eye className="h-3 w-3" />
                <span>{remaining > 0 ? "Khoản nợ" : "Chi tiết"}</span>
              </button>
            </div>
          );
        },
      },
    ],
    [],
  );

  const handleExportAnalysis = () => {
    if (filteredRows.length === 0) {
      toast.warning("Không có dữ liệu để xuất Excel");
      return;
    }

    const groupHeaders = [
      CONTEXT_GROUP,
      "",
      ORIGIN_GROUP,
      "",
      "",
      MOVEMENT_GROUP,
      "",
      "",
      "",
      RESULT_GROUP,
      "",
    ];
    const columnHeaders = [
      "No.",
      "BU",
      "THÁNG PHÁT SINH HOLD",
      "TỔNG SỐ DƯ HOLD",
      "SỐ DƯ TRƯỚC KỲ BÁO CÁO",
      "HOLD PHÁT SINH",
      "THANH TOÁN HOLD",
      "CANCEL",
      "LỊCH SỬ THANH TOÁN HOLD",
      "SỐ DƯ HOLD CÒN LẠI",
      "TRẠNG THÁI HOLD",
    ];
    const rows = filteredRows.map((row) => [
      row["No."],
      row.BU,
      row["Tháng HOLD"],
      row["Tổng số dư HOLD"],
      row["Số dư HOLD đầu kỳ"],
      row["HOLD phát sinh"],
      row["Thanh toán HOLD tại kỳ"],
      row["CANCEL tại kỳ"],
      row["Các tháng đã thanh toán"],
      row["Số dư HOLD còn lại"],
      row["Trạng thái HOLD"],
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([
      groupHeaders,
      columnHeaders,
      ...rows,
    ]);
    worksheet["!merges"] = [
      XLSX.utils.decode_range("A1:B1"),
      XLSX.utils.decode_range("C1:E1"),
      XLSX.utils.decode_range("F1:I1"),
      XLSX.utils.decode_range("J1:K1"),
    ];
    worksheet["!cols"] = [
      { wch: 8 },
      { wch: 12 },
      { wch: 22 },
      { wch: 20 },
      { wch: 24 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 26 },
      { wch: 24 },
      { wch: 20 },
    ];
    worksheet["!autofilter"] = { ref: `A2:K${rows.length + 2}` };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 2 };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ANALYSIS_HOLD");
    XLSX.writeFile(
      workbook,
      `Analysis_Hold_${analytics.currentPeriod.replace(".", "_")}.xlsx`,
    );
    toast.success("Đã xuất file Excel bảng Analysis thành công");
  };

  const handleExportDrilldown = () => {
    if (!drilldownRow) return;

    const workbook = XLSX.utils.book_new();

    // Sheet 1: Danh sách Intern (theo bộ lọc hiện tại)
    if (filteredTeacherSummaries.length > 0) {
      const teacherRows = filteredTeacherSummaries.map((t) => [
        t["No."] || t.stt,
        t.aeCode,
        t.name,
        t.center,
        t.totalHold,
        t.opening,
        t.paidInPeriod,
        t.cancelInPeriod,
        t.totalPaid,
        t.totalCancel,
        t.remaining,
        t.remaining > 0 ? "Còn nợ HOLD" : "Đã thanh toán hết",
        t.notes,
      ]);
      const teacherHeaders = [
        "No.",
        "ID NUMBER",
        "FULL NAME",
        "Center / L07",
        "Tổng HOLD gốc",
        "Số dư trước kỳ",
        "Thanh toán tại kỳ",
        "CANCEL tại kỳ",
        "Tổng đã thanh toán",
        "Tổng đã CANCEL",
        "Số dư HOLD còn lại",
        "Tình trạng",
        "Ghi chú",
      ];
      const wsTeachers = XLSX.utils.aoa_to_sheet([
        [
          `BẢNG TỔNG HỢP Intern HOLD/ADD - BU ${drilldownRow.BU} - THÁNG PHÁT SINH ${drilldownRow["Tháng HOLD"]}`,
        ],
        [`Kỳ báo cáo: ${drilldownRow["Kỳ báo cáo"]}`],
        [],
        teacherHeaders,
        ...teacherRows,
      ]);
      wsTeachers["!cols"] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 26 },
        { wch: 16 },
        { wch: 20 },
        { wch: 20 },
        { wch: 22 },
        { wch: 18 },
        { wch: 22 },
        { wch: 18 },
        { wch: 24 },
        { wch: 18 },
        { wch: 35 },
      ];
      XLSX.utils.book_append_sheet(workbook, wsTeachers, "Tong_Hop_Giao_Vien");
    }

    // Sheet 2: Chi tiết giao dịch
    if (filteredDrilldownRecords.length > 0) {
      const txRows = filteredDrilldownRecords.map((rec) => [
        rec["No."] || rec.stt,
        rec.aeCode,
        rec.name,
        rec.center,
        rec.op,
        rec.amount,
        rec.reportMonth,
        rec.note,
      ]);
      const txHeaders = [
        "No.",
        "ID NUMBER",
        "FULL NAME",
        "Center / L07",
        "Nghiệp vụ",
        "BASE AMOUNT",
        "Kỳ báo cáo",
        "Ghi chú",
      ];
      const wsTx = XLSX.utils.aoa_to_sheet([
        [
          `CHI TIẾT CHỨNG TỪ GIAO DỊCH HOLD/ADD - BU ${drilldownRow.BU} - THÁNG ${drilldownRow["Tháng HOLD"]}`,
        ],
        [],
        txHeaders,
        ...txRows,
      ]);
      wsTx["!cols"] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 26 },
        { wch: 16 },
        { wch: 14 },
        { wch: 18 },
        { wch: 14 },
        { wch: 35 },
      ];
      XLSX.utils.book_append_sheet(workbook, wsTx, "Chi_Tiet_Giao_Dich");
    }

    XLSX.writeFile(
      workbook,
      `HoldDetail_${drilldownRow.BU}_${drilldownRow["Tháng HOLD"].replace(".", "_")}_${drilldownCategory}.xlsx`,
    );
    toast.success("Đã xuất file Excel chi tiết Intern & chứng từ thành công");
  };

  return (
    <div className="analysis-table-frame unified-table-frame flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--card)] text-[var(--card-foreground)]">
      {/* Header Bar */}
      <div
        className="unified-table-frame-header flex h-[54px] min-h-[54px] shrink-0 items-center justify-between gap-3 p-0 bg-[var(--table-header-bg,#FAF3E8)] border-b border-primary/10"
        style={{ backgroundColor: "var(--table-header-bg, #FAF3E8)" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5 px-3">
          <div className="app-table-title-lockup min-w-0">
            <div className="app-table-title-line">
              <button
                type="button"
                onClick={onToggleBulkPaymentCard}
                className="table-initial-toggle shrink-0 cursor-pointer transition-all active:scale-95"
                title={
                  isBulkPaymentCardVisible
                    ? "Ẩn bảng điều khiển"
                    : "Hiện bảng điều khiển"
                }
                aria-label={
                  isBulkPaymentCardVisible
                    ? "Ẩn bảng điều khiển"
                    : "Hiện bảng điều khiển"
                }
                aria-expanded={isBulkPaymentCardVisible}
              >
                <TableInitialMark label="ACCOUNTS PAYABLE AGING" />
              </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-baseline bg-transparent p-0 text-primary hover:text-primary/80 transition-all active:scale-95 cursor-pointer select-none border-none shadow-none outline-none text-left"
                  title="Chuyển bảng"
                >
                  <TableTitleRemainder
                    label="ACCOUNTS PAYABLE AGING"
                    className="app-table-title-remainder--expanded"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={8}
                collisionPadding={8}
                className="table-switch-menu w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-1 z-[99999]"
              >
                <DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  CHUYỂN BẢNG
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => onViewChange("table")}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Table2 className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
                  <span>Batch Payment</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onViewChange("reconcile")}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Scale className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  <span>Reconciliation</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onViewChange("visuals")}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-bold bg-primary/10 text-primary rounded-lg cursor-pointer"
                >
                  <BarChart2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>Accounts Payable Aging</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            </div>
            <p
              className="app-table-title-meta truncate text-[9.5px] font-medium leading-tight text-muted-foreground"
              title={`Tổng hợp vòng đời các khoản HOLD, ADD & Số dư lũy kế qua các kỳ (Kỳ báo cáo: ${analytics.currentPeriod})`}
            >
              Tổng hợp vòng đời các khoản HOLD, ADD & Số dư lũy kế qua các kỳ (Kỳ báo cáo: {analytics.currentPeriod})
            </p>
          </div>
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 pr-3">
          {searchVisible && (
            <div className="relative hidden w-[clamp(150px,18vw,240px)] min-w-0 sm:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={searchTerm}
                onChange={(event) => onSearchTermChange(event.target.value)}
                className="h-7 w-full rounded-full border border-primary/20 bg-[var(--card)] pl-8 pr-8 text-[9px] font-semibold text-[var(--card-foreground)] outline-none placeholder:text-[var(--muted-foreground)] hover:border-primary/40 focus:border-primary"
                placeholder="Tìm BU hoặc tháng…"
                aria-label="Tìm kiếm trong bảng ANALYSIS"
              />
              <button
                type="button"
                onClick={() => {
                  onSearchTermChange("");
                  onSearchVisibleChange(false);
                }}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-primary/[0.08] hover:text-primary"
                title="Đóng tìm kiếm"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* BU Filter Bar thay thế ở phần Tất cả BU */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground mr-0.5">
              <Filter className="w-3 h-3 text-primary" />
              <span className="hidden sm:inline">Lọc BU:</span>
            </span>
            {/* Nút Tất cả */}
            <button
              type="button"
              onClick={() => onSelectedBusinessChange(allBusinessUnitsValue)}
              className={`px-2.5 py-0.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] ${
                effectiveSelectedBusiness === allBusinessUnitsValue
                  ? "bg-primary text-primary-foreground shadow-2xs font-black"
                  : "bg-background hover:bg-muted text-foreground border border-border/80"
              }`}
            >
              Tất cả
            </button>
            {/* Nút Trừ AHP */}
            <button
              type="button"
              onClick={() =>
                onSelectedBusinessChange(
                  effectiveSelectedBusiness === "EXCLUDE_AHP"
                    ? allBusinessUnitsValue
                    : "EXCLUDE_AHP"
                )
              }
              className={`px-2.5 py-0.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] flex items-center gap-1 ${
                effectiveSelectedBusiness === "EXCLUDE_AHP"
                  ? "bg-amber-600 text-white shadow-2xs ring-1 ring-amber-600 font-black"
                  : "bg-amber-50/80 hover:bg-amber-100/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60"
              }`}
              title="Lọc bảng trừ BU AHP (Hải Phòng)"
            >
              <span>Trừ AHP</span>
              {effectiveSelectedBusiness === "EXCLUDE_AHP" && (
                <span className="text-[8.5px] font-black bg-white/25 px-1 rounded">
                  Đang lọc
                </span>
              )}
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-[var(--card)] text-[var(--card-foreground)] shadow-2xs transition-colors hover:border-primary/40 hover:bg-primary/[0.05] hover:text-primary cursor-pointer"
                title="Cài đặt bảng ANALYSIS"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                Công cụ ANALYSIS
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onSearchVisibleChange(!searchVisible)}
              >
                <Search className="h-4 w-4 shrink-0 text-primary" />
                <span>{searchVisible ? "Ẩn tìm kiếm" : "Tìm kiếm"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setQuickFilter("all");
                  onResetFilters();
                  toast.info("Đã đặt lại bộ lọc bảng Analysis");
                }}
              >
                <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
                <span>Đặt lại bộ lọc</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => chooseExcelExport(handleExportAnalysis)}>
                <Download className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Xuất Excel bảng Analysis</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  window.dispatchEvent(new Event("open-ui-settings"))
                }
              >
                <Settings className="h-4 w-4 shrink-0 text-slate-500" />
                <span>Cài đặt giao diện</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                Chuyển bảng
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onViewChange("table")}>
                <Table2 className="h-4 w-4 shrink-0 text-slate-600" />
                <span>Batch Payment</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewChange("reconcile")}>
                <Scale className="h-4 w-4 shrink-0 text-sky-600" />
                <span>Reconciliation</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KPI Metric Filter Cards Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-3 py-[9.5px] text-center bg-slate-50/80 dark:bg-slate-900/40 border-b border-primary/10 shrink-0 text-[11px]">
        {/* Card 0: Tổng HOLD ban đầu */}
        <button
          type="button"
          onClick={() => setQuickFilter("all")}
          className={`flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
            quickFilter === "all"
              ? "bg-white dark:bg-slate-800 border-primary/40 shadow-xs ring-1 ring-primary/20"
              : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-primary/20"
          }`}
        >
          <span className="text-[9.5px] font-semibold text-slate-600 uppercase tracking-wider text-center">
            Tổng số dư HOLD
          </span>
          <span className="tabular-nums font-bold text-slate-900 dark:text-slate-100 text-[12px] text-center">
            {formatAmount(periodSummary.totalInitial)}
          </span>
        </button>

        {/* Card 1: Số dư trước kỳ */}
        <button
          type="button"
          onClick={() => setQuickFilter("all")}
          className="flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-primary/20 transition-all cursor-pointer"
        >
          <span className="text-[9.5px] font-semibold text-slate-500 uppercase tracking-wider text-center">
            Số dư trước kỳ
          </span>
          <span className="tabular-nums font-bold text-slate-800 dark:text-slate-200 text-[12px] text-center">
            {formatAmount(periodSummary.opening)}
          </span>
        </button>

        {/* Card 2: HOLD phát sinh */}
        <button
          type="button"
          onClick={() =>
            setQuickFilter(quickFilter === "has_new_hold" ? "all" : "has_new_hold")
          }
          className={`flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
            quickFilter === "has_new_hold"
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-400 shadow-xs ring-1 ring-amber-300"
              : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-amber-300"
          }`}
        >
          <span className="text-[9.5px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider text-center">
            HOLD phát sinh mới
          </span>
          <span className="tabular-nums font-bold text-amber-800 dark:text-amber-300 text-[12px] text-center">
            {formatAmount(periodSummary.hold)}
          </span>
        </button>

        {/* Card 3: Thanh toán HOLD */}
        <button
          type="button"
          onClick={() =>
            setQuickFilter(quickFilter === "has_paid" ? "all" : "has_paid")
          }
          className={`flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
            quickFilter === "has_paid"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 shadow-xs ring-1 ring-emerald-300"
              : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
          }`}
        >
          <span className="text-[9.5px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider text-center">
            Thanh toán tại kỳ
          </span>
          <span className="tabular-nums font-bold text-emerald-800 dark:text-emerald-300 text-[12px] text-center">
            {formatAmount(periodSummary.paid)}
          </span>
        </button>

        {/* Card 4: CANCEL */}
        <button
          type="button"
          onClick={() =>
            setQuickFilter(quickFilter === "has_cancel" ? "all" : "has_cancel")
          }
          className={`flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
            quickFilter === "has_cancel"
              ? "bg-rose-50 dark:bg-rose-950/40 border-rose-400 shadow-xs ring-1 ring-rose-300"
              : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-rose-300"
          }`}
        >
          <span className="text-[9.5px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider text-center">
            CANCEL tại kỳ
          </span>
          <span className="tabular-nums font-bold text-rose-800 dark:text-rose-300 text-[12px] text-center">
            {formatAmount(periodSummary.cancel)}
          </span>
        </button>

        {/* Card 5: Số dư HOLD còn lại */}
        <button
          type="button"
          onClick={() =>
            setQuickFilter(
              quickFilter === "has_remaining" ? "all" : "has_remaining",
            )
          }
          className={`flex flex-col items-center text-center px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
            quickFilter === "has_remaining"
              ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
              : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-primary/30"
          }`}
        >
          <span className="text-[9.5px] font-semibold text-primary uppercase tracking-wider text-center">
            Số dư còn lại cuối kỳ
          </span>
          <span className="tabular-nums font-black text-primary text-[12px] text-center">
            {formatAmount(periodSummary.remaining)}
          </span>
        </button>
      </div>

      {/* Main Table */}
      <div className="analysis-table-region min-h-0 flex-1 overflow-hidden bg-[var(--card)] p-0">
        <DataTable
          key={`${analytics.currentPeriod}|${effectiveSelectedBusiness}|${quickFilter}`}
          columns={SUMMARY_COLUMNS}
          data={filteredRows}
          isEditable={false}
          onRowClick={(row) => setDrilldownRow(row)}
          externalSearchTerm={searchTerm}
          onExternalSearchChange={onSearchTermChange}
          storageKey="analys_hold_lifecycle_v12"
          className="analysis-data-table !p-0"
          showFooter={true}
          showPagination={true}
          defaultItemsPerPage={50}
          rowHeight={38}
          stickyHeader={true}
          stickyFirstColumn={false}
          striped={false}
          scrollContainerStyle={{ backgroundColor: "var(--card)" }}
          tableStyle={{ backgroundColor: "var(--card)" }}
          ignoreSavedHiddenColumns={true}
          ignoreSavedPagination={true}
          hideBuFilter={true}
          hideSaveStatus={true}
          headerClassName="bg-primary/[0.055] text-primary border-[#e7dbdc] font-bold text-[9px] uppercase tracking-[0.08em] text-center"
          footerClassName="bg-[var(--table-column-header-bg,#FAF3E8)] text-[var(--table-column-header-text-color,inherit)] border-t-2 border-[var(--border,#cbd5e1)] font-black text-[12.5px] md:text-[13px]"
        />
      </div>

      {/* Drill-down Teacher Detail Dialog */}
      <Dialog
        open={!!drilldownRow}
        onOpenChange={(open) => {
          if (!open) {
            setDrilldownRow(null);
            setDrilldownSearch("");
          }
        }}
      >
        <DialogContent className="!w-[95vw] !max-w-[1100px] !h-[88vh] !max-h-[850px] !p-0 !gap-0 flex flex-col overflow-hidden rounded-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
          {drilldownRow && (
            <>
              {/* Dialog Header */}
              <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-[#881337] dark:text-rose-400 flex flex-wrap items-center gap-2">
                      <span>Chi tiết các khoản HOLD / ADD</span>
                      <span className="rounded bg-[#fbeeed] dark:bg-rose-950/60 px-2.5 py-0.5 text-xs font-bold text-[#881337] dark:text-rose-300">
                        BU: {drilldownRow.BU}
                      </span>
                      <span className="rounded bg-[#fef3c7] dark:bg-amber-950/60 px-2.5 py-0.5 text-xs font-bold text-[#92400e] dark:text-amber-300">
                        Tháng phát sinh: {drilldownRow["Tháng HOLD"]}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Kỳ báo cáo: <b>{drilldownRow["Kỳ báo cáo"]}</b> | Trạng thái:{" "}
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {drilldownRow["Trạng thái HOLD"]}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pr-8">
                    <button
                      type="button"
                      onClick={handleExportDrilldown}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all cursor-pointer shadow-2xs"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Xuất Excel ({filteredTeacherSummaries.length} TA)</span>
                    </button>
                    {onDrilldownToTransaction && (
                      <button
                        type="button"
                        onClick={() => {
                          const bu = drilldownRow.BU;
                          const month = drilldownRow["Tháng HOLD"];
                          setDrilldownRow(null);
                          onDrilldownToTransaction(bu, month);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-bold text-primary transition-all cursor-pointer"
                        title="Mở trong Batch Payment"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Batch Payment</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Interactive Category Filter Cards */}
                <div className="grid grid-cols-5 gap-2.5 mt-3.5 text-xs">
                  {/* Card 1: TỔNG SỐ DƯ HOLD */}
                  <button
                    type="button"
                    onClick={() => setDrilldownCategory("total_hold")}
                    className={`rounded-xl p-2.5 text-left border transition-all cursor-pointer flex flex-col justify-center min-w-0 ${
                      drilldownCategory === "total_hold"
                        ? "bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-500 shadow-xs ring-2 ring-slate-400/50"
                        : "bg-slate-50 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700 hover:border-slate-400"
                    }`}
                  >
                    <div className="text-[10px] text-slate-600 uppercase font-bold tracking-wider leading-tight flex items-center justify-between">
                      <span>TỔNG SỐ DƯ HOLD</span>
                      {drilldownCategory === "total_hold" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-700 animate-pulse" />
                      )}
                    </div>
                    <div className="tabular-nums font-bold text-slate-900 dark:text-slate-100 text-sm mt-1 whitespace-nowrap">
                      {formatAmount(modalTotals.totalHold)}
                    </div>
                  </button>

                  {/* Card 2: SỐ DƯ TRƯỚC KỲ */}
                  <button
                    type="button"
                    onClick={() => setDrilldownCategory("opening")}
                    className={`rounded-xl p-2.5 text-left border transition-all cursor-pointer flex flex-col justify-center min-w-0 ${
                      drilldownCategory === "opening"
                        ? "bg-amber-100/70 dark:bg-amber-950/60 border-amber-400 shadow-xs ring-2 ring-amber-400/50"
                        : "bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/80 hover:border-amber-400"
                    }`}
                  >
                    <div className="text-[10px] text-amber-800 dark:text-amber-400 uppercase font-bold tracking-wider leading-tight flex items-center justify-between">
                      <span>SỐ DƯ TRƯỚC KỲ</span>
                      {drilldownCategory === "opening" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-600 animate-pulse" />
                      )}
                    </div>
                    <div className="tabular-nums font-bold text-amber-900 dark:text-amber-300 text-sm mt-1 whitespace-nowrap">
                      {formatAmount(modalTotals.opening)}
                    </div>
                  </button>

                  {/* Card 3: THANH TOÁN TẠI KỲ */}
                  <button
                    type="button"
                    onClick={() => setDrilldownCategory("paid_in_period")}
                    className={`rounded-xl p-2.5 text-left border transition-all cursor-pointer flex flex-col justify-center min-w-0 ${
                      drilldownCategory === "paid_in_period"
                        ? "bg-emerald-100/70 dark:bg-emerald-950/60 border-emerald-400 shadow-xs ring-2 ring-emerald-400/50"
                        : "bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/80 hover:border-emerald-400"
                    }`}
                  >
                    <div className="text-[10px] text-emerald-800 dark:text-emerald-400 uppercase font-bold tracking-wider leading-tight flex items-center justify-between">
                      <span>THANH TOÁN TẠI KỲ</span>
                      {drilldownCategory === "paid_in_period" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      )}
                    </div>
                    <div className="tabular-nums font-extrabold text-emerald-900 dark:text-emerald-300 text-sm mt-1 whitespace-nowrap">
                      {formatAmount(modalTotals.paidInPeriod)}
                    </div>
                  </button>

                  {/* Card 4: CANCEL TẠI KỲ */}
                  <button
                    type="button"
                    onClick={() => setDrilldownCategory("cancel_in_period")}
                    className={`rounded-xl p-2.5 text-left border transition-all cursor-pointer flex flex-col justify-center min-w-0 ${
                      drilldownCategory === "cancel_in_period"
                        ? "bg-rose-100/70 dark:bg-rose-950/60 border-rose-400 shadow-xs ring-2 ring-rose-400/50"
                        : "bg-rose-50/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/80 hover:border-rose-400"
                    }`}
                  >
                    <div className="text-[10px] text-rose-800 dark:text-rose-400 uppercase font-bold tracking-wider leading-tight flex items-center justify-between">
                      <span>CANCEL TẠI KỲ</span>
                      {drilldownCategory === "cancel_in_period" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-600 animate-pulse" />
                      )}
                    </div>
                    <div className="tabular-nums font-bold text-rose-900 dark:text-rose-300 text-sm mt-1 whitespace-nowrap">
                      {formatAmount(modalTotals.cancelInPeriod)}
                    </div>
                  </button>

                  {/* Card 5: SỐ DƯ CÒN LẠI */}
                  <button
                    type="button"
                    onClick={() => setDrilldownCategory("remaining_unpaid")}
                    className={`rounded-xl p-2.5 text-left border transition-all cursor-pointer flex flex-col justify-center min-w-0 ${
                      drilldownCategory === "remaining_unpaid"
                        ? "bg-rose-100 dark:bg-rose-950/80 border-rose-500 shadow-xs ring-2 ring-rose-500/60"
                        : "bg-[#fff5f5] dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 hover:border-rose-400"
                    }`}
                  >
                    <div className="text-[10px] text-rose-800 dark:text-rose-400 uppercase font-extrabold tracking-wider leading-tight flex items-center justify-between">
                      <span>SỐ DƯ CÒN LẠI</span>
                      {drilldownCategory === "remaining_unpaid" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-600 animate-pulse" />
                      )}
                    </div>
                    <div className="tabular-nums font-black text-rose-900 dark:text-rose-200 text-sm mt-1 whitespace-nowrap">
                      {formatAmount(modalTotals.remaining)}
                    </div>
                  </button>
                </div>
              </div>

              {/* Dialog Body - Search, Filter Tabs & Record List */}
              <div className="p-4 flex-1 overflow-hidden flex flex-col min-h-0 bg-white dark:bg-slate-900">
                {/* Contextual Banner */}
                <div
                  className={`mb-3 p-2.5 rounded-lg text-xs flex items-center justify-between border ${
                    drilldownCategory === "remaining_unpaid"
                      ? "bg-rose-50/80 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200"
                      : drilldownCategory === "paid_in_period"
                      ? "bg-emerald-50/80 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
                      : drilldownCategory === "cancel_in_period"
                      ? "bg-rose-50/80 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200"
                      : drilldownCategory === "opening"
                      ? "bg-amber-50/80 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200"
                      : "bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <span className="font-bold uppercase tracking-wide">
                      {drilldownCategory === "remaining_unpaid" && "📌 Danh sách khoản HOLD còn lại chưa thanh toán:"}
                      {drilldownCategory === "paid_in_period" && "📌 Danh sách khoản HOLD được thanh toán tại kỳ:"}
                      {drilldownCategory === "cancel_in_period" && "📌 Danh sách khoản HOLD đã CANCEL tại kỳ:"}
                      {drilldownCategory === "opening" && "📌 Danh sách khoản HOLD tồn trước kỳ báo cáo:"}
                      {drilldownCategory === "total_hold" && "📌 Danh sách toàn bộ các khoản phát sinh HOLD ban đầu:"}
                      {drilldownCategory === "all" && "📌 Toàn bộ danh sách Intern & chứng từ:"}
                    </span>
                    <span className="tabular-nums font-bold">
                      {drilldownCategory === "remaining_unpaid" &&
                        `${formatAmount(modalTotals.remaining)} (${filteredTeacherSummaries.length} Intern)`}
                      {drilldownCategory === "paid_in_period" &&
                        `${formatAmount(modalTotals.paidInPeriod)} (${filteredTeacherSummaries.length} Intern)`}
                      {drilldownCategory === "cancel_in_period" &&
                        `${formatAmount(modalTotals.cancelInPeriod)} (${filteredTeacherSummaries.length} Intern)`}
                      {drilldownCategory === "opening" &&
                        `${formatAmount(modalTotals.opening)} (${filteredTeacherSummaries.length} Intern)`}
                      {drilldownCategory === "total_hold" &&
                        `${formatAmount(modalTotals.totalHold)} (${filteredTeacherSummaries.length} Intern)`}
                      {drilldownCategory === "all" &&
                        `${formatAmount(modalTotals.totalHold)} (${filteredTeacherSummaries.length} Intern)`}
                    </span>
                  </div>

                  {/* View Mode Toggle */}
                  <div className="flex items-center gap-1 bg-white/90 dark:bg-slate-800 p-0.5 rounded-md border border-slate-200/80 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setDrilldownViewMode("teachers")}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                        drilldownViewMode === "teachers"
                          ? "bg-[#881337] text-white shadow-2xs"
                          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      Theo Intern ({filteredTeacherSummaries.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrilldownViewMode("transactions")}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                        drilldownViewMode === "transactions"
                          ? "bg-[#881337] text-white shadow-2xs"
                          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      Chi tiết Giao dịch ({filteredDrilldownRecords.length})
                    </button>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex items-center justify-between gap-3 mb-2.5 shrink-0">
                  <div className="relative flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={drilldownSearch}
                      onChange={(e) => setDrilldownSearch(e.target.value)}
                      placeholder="Tìm theo tên Intern, ID NUMBER, center, ghi chú..."
                      className="h-8.5 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#f8fafc] dark:bg-slate-800 pl-8.5 pr-3 text-xs outline-none focus:border-[#881337]"
                    />
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setDrilldownCategory("remaining_unpaid")}
                      className={`px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                        drilldownCategory === "remaining_unpaid"
                          ? "bg-rose-100 border-rose-300 text-rose-800 font-bold dark:bg-rose-950/60 dark:text-rose-300"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      Số dư còn lại
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrilldownCategory("paid_in_period")}
                      className={`px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                        drilldownCategory === "paid_in_period"
                          ? "bg-emerald-100 border-emerald-300 text-emerald-800 font-bold dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      Thanh toán tại kỳ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrilldownCategory("cancel_in_period")}
                      className={`px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                        drilldownCategory === "cancel_in_period"
                          ? "bg-rose-100 border-rose-300 text-rose-800 font-bold dark:bg-rose-950/60 dark:text-rose-300"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      CANCEL tại kỳ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrilldownCategory("opening")}
                      className={`px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                        drilldownCategory === "opening"
                          ? "bg-amber-100 border-amber-300 text-amber-800 font-bold dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      Số dư trước kỳ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrilldownCategory("total_hold")}
                      className={`px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                        drilldownCategory === "total_hold"
                          ? "bg-slate-200 border-slate-400 text-slate-900 font-bold dark:bg-slate-700 dark:text-slate-200"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      Tất cả HOLD
                    </button>
                  </div>
                </div>

                {/* Table Region */}
                <div className="flex-1 overflow-auto border-0 rounded-none bg-white dark:bg-slate-900 relative shadow-2xs ring-1 ring-slate-200/50 dark:ring-slate-800">
                  {drilldownViewMode === "teachers" ? (
                    filteredTeacherSummaries.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                        <FileSpreadsheet className="h-8 w-8 text-slate-300 mb-2" />
                        <p className="text-xs font-semibold">
                          Không có Intern nào khớp với bộ lọc hiện tại
                        </p>
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs border-separate border-spacing-0 border-0">
                        <thead className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] text-[var(--table-column-header-text-color,#881337)]">
                          <tr>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 text-center w-12 border-b border-primary/20 font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              No.
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[110px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              ID NUMBER
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[160px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              FULL NAME
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[100px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              L07
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[110px] text-right font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              TỔNG HOLD GỐC
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[110px] text-right font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              {drilldownCategory === "opening"
                                ? "SỐ DƯ TRƯỚC KỲ"
                                : drilldownCategory === "paid_in_period"
                                ? "THANH TOÁN TẠI KỲ"
                                : "ĐÃ THANH TOÁN"}
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[90px] text-right font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              ĐÃ CANCEL
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[120px] text-right font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              SỐ DƯ CÒN LẠI
                            </th>
                            <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[140px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                              GHI CHÚ
                            </th>
                          </tr>
                        </thead>
                        <tbody className="font-sans">
                          {filteredTeacherSummaries.map((t) => (
                            <tr
                              key={t.id}
                              className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors"
                            >
                              <td className="p-2 text-center text-slate-400 tabular-nums text-[11px] border-b border-slate-100 dark:border-slate-800">
                                {t["No."] || t.stt}
                              </td>
                              <td className="p-2 tabular-nums font-bold text-slate-900 dark:text-slate-100 text-xs border-b border-slate-100 dark:border-slate-800">
                                {t.aeCode || "—"}
                              </td>
                              <td className="p-2 font-bold uppercase text-slate-900 dark:text-slate-100 text-xs border-b border-slate-100 dark:border-slate-800">
                                {t.name || "—"}
                              </td>
                              <td className="p-2 font-medium tabular-nums text-slate-600 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
                                {t.center || "—"}
                              </td>
                              <td className="p-2 text-right tabular-nums font-bold text-slate-800 dark:text-slate-200 text-xs border-b border-slate-100 dark:border-slate-800">
                                {formatAmount(t.totalHold)}
                              </td>
                              <td className="p-2 text-right tabular-nums font-bold text-xs border-b border-slate-100 dark:border-slate-800">
                                {drilldownCategory === "opening" ? (
                                  <span className="text-amber-700 dark:text-amber-400">
                                    {formatAmount(t.opening)}
                                  </span>
                                ) : drilldownCategory === "paid_in_period" ? (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-extrabold">
                                    {formatAmount(t.paidInPeriod)}
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    {formatAmount(t.totalPaid)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-right tabular-nums font-bold text-slate-500 text-xs border-b border-slate-100 dark:border-slate-800">
                                {formatAmount(t.totalCancel)}
                              </td>
                              <td className="p-2 text-right tabular-nums font-black text-xs border-b border-slate-100 dark:border-slate-800">
                                <span
                                  className={
                                    t.remaining > 0
                                      ? "text-rose-700 dark:text-rose-400 font-extrabold"
                                      : "text-emerald-700 dark:text-emerald-400 font-bold"
                                  }
                                >
                                  {formatAmount(t.remaining)}
                                </span>
                              </td>
                              <td
                                className="p-2 text-slate-500 max-w-[160px] truncate text-[11px] border-b border-slate-100 dark:border-slate-800"
                                title={t.notes}
                              >
                                {t.notes || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-[#FAF3E8] dark:bg-slate-800 font-extrabold border-t-2 border-primary/30">
                          <tr>
                            <td colSpan={4} className="p-2.5 text-center text-[#881337] dark:text-rose-300 uppercase text-[12.5px] font-black tracking-wide">
                              TỔNG CỘNG ({filteredTeacherSummaries.length} Intern)
                            </td>
                            <td className="p-2.5 text-right tabular-nums text-[13px] font-bold text-slate-900 dark:text-slate-100">
                              {formatAmount(
                                filteredTeacherSummaries.reduce((sum, t) => sum + t.totalHold, 0),
                              )}
                            </td>
                            <td className="p-2.5 text-right tabular-nums text-[13px] font-bold text-emerald-800 dark:text-emerald-300">
                              {formatAmount(
                                filteredTeacherSummaries.reduce(
                                  (sum, t) =>
                                    sum +
                                    (drilldownCategory === "opening"
                                      ? t.opening
                                      : drilldownCategory === "paid_in_period"
                                      ? t.paidInPeriod
                                      : t.totalPaid),
                                  0,
                                ),
                              )}
                            </td>
                            <td className="p-2.5 text-right tabular-nums text-[13px] font-bold text-rose-800 dark:text-rose-300">
                              {formatAmount(
                                filteredTeacherSummaries.reduce((sum, t) => sum + t.totalCancel, 0),
                              )}
                            </td>
                            <td className="p-2.5 text-right tabular-nums text-[13px] text-rose-800 dark:text-rose-300 font-black">
                              {formatAmount(
                                filteredTeacherSummaries.reduce((sum, t) => sum + t.remaining, 0),
                              )}
                            </td>
                            <td className="p-2" />
                          </tr>
                        </tfoot>
                      </table>
                    )
                  ) : filteredDrilldownRecords.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                      <FileSpreadsheet className="h-8 w-8 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold">
                        Không tìm thấy bản ghi chi tiết khớp với điều kiện lọc
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-separate border-spacing-0 border-0">
                      <thead className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] text-[var(--table-column-header-text-color,#881337)]">
                        <tr>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 text-center w-12 border-b border-primary/20 font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            No.
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[120px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            ID NUMBER
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[160px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            FULL NAME
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[110px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            L07
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[90px] text-center font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            NGHIỆP VỤ
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[120px] text-right font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            BASE AMOUNT
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[90px] text-center font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            KỲ BC
                          </th>
                          <th className="sticky top-0 z-20 bg-[var(--table-column-header-bg,#FAF3E8)] p-2 border-b border-primary/20 min-w-[160px] font-bold text-[11px] text-[var(--table-column-header-text-color,#881337)] uppercase tracking-wider">
                            GHI CHÚ
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-sans">
                        {filteredDrilldownRecords.map((rec) => (
                          <tr
                            key={rec.id}
                            className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors"
                          >
                            <td className="p-2 text-center text-slate-400 tabular-nums text-[11px] border-b border-slate-100 dark:border-slate-800">
                              {rec["No."] || rec.stt}
                            </td>
                            <td className="p-2 tabular-nums font-bold text-slate-900 dark:text-slate-100 text-xs border-b border-slate-100 dark:border-slate-800">
                              {rec.aeCode || "—"}
                            </td>
                            <td className="p-2 font-bold uppercase text-slate-900 dark:text-slate-100 text-xs border-b border-slate-100 dark:border-slate-800">
                              {rec.name || "—"}
                            </td>
                            <td className="p-2 font-medium tabular-nums text-slate-600 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
                              {rec.center || "—"}
                            </td>
                            <td className="p-2 text-center border-b border-slate-100 dark:border-slate-800">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold ${
                                  String(rec.op).includes("ADD")
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : String(rec.op).includes("CANCEL")
                                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                }`}
                              >
                                {rec.op}
                              </span>
                            </td>
                            <td className="p-2 text-right tabular-nums font-bold text-slate-800 dark:text-slate-200 text-xs border-b border-slate-100 dark:border-slate-800">
                              {formatAmount(rec.amount)}
                            </td>
                            <td className="p-2 text-center tabular-nums text-slate-500 text-[11px] border-b border-slate-100 dark:border-slate-800">
                              {rec.reportMonth || "—"}
                            </td>
                            <td
                              className="p-2 text-slate-500 max-w-[200px] truncate text-[11px] border-b border-slate-100 dark:border-slate-800"
                              title={rec.note}
                            >
                              {rec.note || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-[#FAF3E8] dark:bg-slate-800 font-extrabold border-t-2 border-primary/30">
                        <tr>
                          <td colSpan={5} className="p-2.5 text-center text-[#881337] dark:text-rose-300 uppercase text-[12.5px] font-black tracking-wide">
                            TỔNG CỘNG ({filteredDrilldownRecords.length} CHỨNG TỪ)
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-[13px] text-slate-900 dark:text-slate-100 font-extrabold">
                            {formatAmount(
                              filteredDrilldownRecords.reduce((sum, r) => sum + r.amount, 0),
                            )}
                          </td>
                          <td colSpan={2} className="p-2" />
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
