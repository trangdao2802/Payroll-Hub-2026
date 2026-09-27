import { applyTimesheetPivotEdit, applyTimesheetRosterCellEdit, getRosterSourceKey, normalizeTimesheetAllocation } from "../../lib/utils/timesheet-edits";
import { useMissingTimesheetCenters } from "../../hooks/useMissingTimesheetCenters";
import { SupabaseSchemaError } from '../../lib/utils/supabase-sync-errors';
import { useTableRestore } from '../../hooks/useTableRestore';
import { buildCenterTable } from "../../lib/utils/center-table";
import { getDynamicEmployeeColumns } from "../../constants/timesheet-columns";
import { chooseExcelExport } from "../../components/ExportScopeDialog";
import { downloadTableExcel } from "../../lib/utils/table-excel";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useMemo, useRef, useState, useEffect, useTransition, useCallback, useDeferredValue } from "react";
import { useLocation } from "react-router";
import { useAppData } from "../../lib/contexts/AppDataContext";
import { useTimesheetCalculations } from "../../hooks/useTimesheetCalculations";
import {
  getAuditRawType,
  isAuditInClassType,
  normalizeDateFilterValue,
  parseMoneyToNumber,
  prepareDataForExport,
} from "../../lib/utils/data-utils";
import { getBusinessFromL07, getCenterInfoByL07, mapL07, resolveMktRosterCenter } from "../../lib/utils/center-utils";
import { useUiSettings } from "../../lib/ui-settings";
import { INITIAL_APP_DATA } from "../../constants/initial-data";
import {
  FileText,
  Users,
  Building2,
  Search,
  ChevronDown,
  XCircle,
  X,
  RefreshCw,
  SlidersHorizontal,
  Save,
  Plus,
  Check,
  Settings,
  Download,
  Cloud,
  Eye,
  Menu,
  ArrowLeft,
  RotateCcw,
  FileSpreadsheet,
  Coins,
  CalendarDays,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Copy, Clock } from "lucide-react";
import { RosterRawTable } from "./tables/RosterRawTable";
import { EmployeeTable } from "./tables/EmployeeTable";
import { CenterTable } from "./tables/CenterTable";
import { MktLocalNorthPivotTable } from "./tables/MktLocalNorthPivotTable";
import { TypeRatesTable } from "./tables/TypeRatesTable";
import TimesheetSummaryPage from "./TimesheetSummary";
import { useNavigate } from "react-router";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { 
  preflightTimesheetSync,
  syncRosterToSupabase, 
  syncEmployeesToSupabase, 
  syncSalaryScalesToSupabase, 
  clearSupabaseData, 
  SQL_SETUP_SCRIPT 
} from "../../lib/supabase-sync-utils";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Calendar } from "../../components/ui/calendar";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import { ROSTER_RAW_COLUMNS } from "../../constants/columns/roster-raw";
import { downloadHierarchicalWorkbook } from "../../lib/utils/excel-export";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
} as const;


function isMktLocalNorthRosterRow(row: any): boolean {
  if (String(row?.overlap_check || "").startsWith("Trùng lịch")) return false;
  if (row?.isMktLocal) return true;
  const values = [
    row?.center,
    row?.l07,
    row?.bank,
    row?.bankName,
    row?.chargeToCenterMkt,
    row?.charge_to_center_mkt,
    row?._sourceFile,
  ].map((value) => String(value || "").toUpperCase());
  return values.some(
    (value) =>
      value === "MKT LOCAL NORTH" ||
      value.startsWith("MKT LOCAL NORTH_") ||
      value.includes("MKT LOCAL NORTH") ||
      value.includes("MKT_LOCAL_NORTH") ||
      value.includes("MKT NORTH") ||
      value === "MKT",
  );
}

function buildTimesheetMktPivotExportRows(rows: any[]): any[] {
  const grouped = new Map<
    string,
    {
      business: string;
      l07: string;
      values: Record<string, number>;
      total: number;
    }
  >();
  const types = new Set<string>();

  rows.filter(isMktLocalNorthRosterRow).forEach((row) => {
    const type = String(row.taskType || row.type || row.sourceType || "")
      .trim()
      .toUpperCase();
    if (!type) return;
    types.add(type);

    const rawL07 = String(
      row.chargeToCenterMkt ||
        row.charge_to_center_mkt ||
        row.center ||
        row.l07 ||
        "",
    ).trim();
    const resolved = resolveMktRosterCenter(rawL07);
    const l07 = resolved.l07 || mapL07(rawL07) || rawL07;
    const business =
      resolved.business ||
      getCenterInfoByL07(l07)?.bus ||
      String(row.business || "").trim() ||
      getBusinessFromL07(l07) ||
      "AHN";
    const key = `${business}||${l07}`;
    const current = grouped.get(key) || {
      business,
      l07,
      values: {},
      total: 0,
    };
    const hours = Number(row.workingHours ?? row.duration) || 0;
    const override = row._mktPivotValueOverride;
    const amount =
      override !== undefined &&
      override !== null &&
      override !== "" &&
      Number.isFinite(Number(override))
        ? Number(override)
        : hours * 20000;
    current.values[type] = (current.values[type] || 0) + amount;
    current.total += amount;
    grouped.set(key, current);
  });

  const sortedTypes = Array.from(types).sort();
  const exportRows: Array<Record<string, unknown>> = Array.from(grouped.values())
    .sort(
      (left, right) =>
        left.business.localeCompare(right.business) ||
        left.l07.localeCompare(right.l07),
    )
    .map((row, index) => ({
      "No.": index + 1,
      Business: row.business,
      "Charge To Center MKT": row.l07,
      ...Object.fromEntries(
        sortedTypes.map((type) => [type, row.values[type] || 0]),
      ),
      "Grand Total": row.total,
    }));

  const totals = Object.fromEntries(
    sortedTypes.map((type) => [
      type,
      exportRows.reduce((sum, row) => sum + Number(row[type] || 0), 0),
    ]),
  );
  exportRows.push({
    "No.": "",
    Business: "TỔNG CỘNG",
    "Charge To Center MKT": "",
    ...totals,
    "Grand Total": exportRows.reduce(
      (sum, row) => sum + Number(row["Grand Total"] || 0),
      0,
    ),
  });
  return exportRows;
}

function DebouncedSearchInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [localValue, value, onChange]);

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
    />
  );
}

function parseFlexibleDateString(str: string): string | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  // 1. Check DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 2. Check YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 3. Check 8-digit continuous DDMMYYYY
  if (/^\d{8}$/.test(trimmed)) {
    const day = parseInt(trimmed.slice(0, 2), 10);
    const month = parseInt(trimmed.slice(2, 4), 10);
    const year = parseInt(trimmed.slice(4, 8), 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 4. Fallback Date constructor
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return format(d, "yyyy-MM-dd");
  }

  return null;
}

interface EditableDateSelectorProps {
  label: string;
  value: string;
  onChange: (newDateStr: string) => void;
  placeholder?: string;
}

function EditableDateSelector({
  label,
  value,
  onChange,
  placeholder = "Chọn ngày",
}: EditableDateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedDisplay = useMemo(() => {
    if (!value) return placeholder;
    try {
      const parsed = new Date(`${value}T00:00:00`);
      if (isNaN(parsed.getTime())) return value;
      return format(parsed, "dd/MM/yyyy");
    } catch {
      return value;
    }
  }, [value, placeholder]);

  const handleStartEditing = () => {
    setIsOpen(false);
    setInputText(formattedDisplay === placeholder ? "" : formattedDisplay);
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleCommitEdit = () => {
    if (!isEditing) return;
    setIsEditing(false);
    if (!inputText.trim()) return;

    const parsed = parseFlexibleDateString(inputText);
    if (parsed) {
      onChange(parsed);
      toast.success(`Đã cập nhật ${label}: ${format(new Date(`${parsed}T00:00:00`), "dd/MM/yyyy")}`);
    } else {
      toast.error(`Ngày "${inputText}" không hợp lệ. Vui lòng nhập dạng dd/mm/yyyy (ví dụ: 21/06/2026)`);
    }
  };

  return (
    <div className="flex flex-col gap-1 relative min-w-0">
      <div className="flex items-center justify-between">
        <span 
          className="tabular-nums text-[9px] tracking-wider uppercase text-muted-foreground font-bold leading-none truncate"
        >
          {label}
        </span>
      </div>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCommitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setIsEditing(false);
            }
          }}
          onBlur={handleCommitEdit}
          placeholder="dd/mm/yyyy"
          className="bg-card rounded-lg px-2 h-8 border border-primary focus:outline-none w-full text-[11px] font-bold text-foreground tabular-nums shadow-2xs"
        />
      ) : (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleStartEditing();
              }}
              title="Click chọn lịch, Nhấp đúp 2 lần để tự gõ ngày"
              className="bg-card rounded-lg border border-border hover:border-primary/50 focus:outline-none transition-all w-full flex items-center justify-between cursor-pointer select-none text-[11px] font-bold text-foreground group px-2 h-8 shadow-2xs min-w-0"
            >
              <span className="truncate">{formattedDisplay}</span>
              <CalendarDays className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 opacity-70 ml-0.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent 
            align="start" 
            side="bottom" 
            sideOffset={6} 
            collisionPadding={12}
            className="w-auto p-1.5 z-[99999] bg-[var(--card)] opacity-100 border border-border shadow-2xl rounded-2xl"
          >
            <Calendar
              mode="single"
              selected={value ? new Date(`${value}T00:00:00`) : undefined}
              defaultMonth={value ? new Date(`${value}T00:00:00`) : undefined}
              onSelect={(d) => {
                const newDate = d ? format(d, "yyyy-MM-dd") : "";
                onChange(newDate);
                setIsOpen(false);
              }}
              className="p-1 pointer-events-auto bg-card"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

const timesheetSearchCache = new WeakMap<any, string>();

const normalizeFilterText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

let hasFetchedSupabase = false;
const pendingSupabaseTableFetches = new Map<string, Promise<any[]>>();

async function fetchAllFromSupabaseTable(tableName: string) {
  const pending = pendingSupabaseTableFetches.get(tableName);
  if (pending) return pending;

  const request = (async () => {
    const pageSize = 1000;
    const maxRows = 200000;
    const fetchPage = async (from: number, includeCount = false) => {
      const query = includeCount
        ? supabase.from(tableName).select("*", { count: "exact" })
        : supabase.from(tableName).select("*");
      const { data, error, count } = await query.range(
        from,
        from + pageSize - 1,
      );

      if (error) {
        if (
          (error as any).status === 416 ||
          error.code === "PGRST103" ||
          error.message?.includes("Range Not Satisfiable")
        ) {
          return { rows: [] as any[], count: count ?? null };
        }
        throw error;
      }
      return { rows: data || [], count: count ?? null };
    };

    const firstPage = await fetchPage(0, true);
    const allRows = [...firstPage.rows];
    if (firstPage.rows.length < pageSize) return allRows;

    const cappedTotal = Math.min(firstPage.count ?? maxRows, maxRows);
    if (firstPage.count !== null) {
      const offsets: number[] = [];
      for (let from = pageSize; from < cappedTotal; from += pageSize) {
        offsets.push(from);
      }
      // A small amount of parallelism removes one network round-trip per page
      // without flooding Supabase when the roster is exceptionally large.
      for (let index = 0; index < offsets.length; index += 6) {
        const pages = await Promise.all(
          offsets.slice(index, index + 6).map((from) => fetchPage(from)),
        );
        pages.forEach((page) => allRows.push(...page.rows));
      }
      return allRows;
    }

    // Fallback for projects where exact row counts are disabled.
    for (let from = pageSize; from < maxRows; from += pageSize) {
      const page = await fetchPage(from);
      allRows.push(...page.rows);
      if (page.rows.length < pageSize) break;
    }
    return allRows;
  })();

  pendingSupabaseTableFetches.set(tableName, request);
  try {
    return await request;
  } finally {
    pendingSupabaseTableFetches.delete(tableName);
  }
}

export function TimesheetHub() {
  const { appData, updateAppData } = useAppData();
  const restoreTable = useTableRestore();
  const location = useLocation();
  const uiSettings = useUiSettings();
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const tableRef = useRef<any>(null);

  const [activeTab, setActiveTab] = useState<
    "roster_raw" | "employee" | "center" | "mkt_local_north" | "type_rates"
  >("employee");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  const [view, setView] = useState<"final" | "upload">("final");
  const [fromDate, setFromDate] = useState(appData.Timesheet_Dates?.from || "");
  const [toDate, setToDate] = useState(appData.Timesheet_Dates?.to || "");
  const [debouncedFromDate, setDebouncedFromDate] = useState(appData.Timesheet_Dates?.from || "");
  const [debouncedToDate, setDebouncedToDate] = useState(appData.Timesheet_Dates?.to || "");
  const [showSidebar, setShowSidebar] = useState(true);
  const handleToggleSidebar = useCallback(() => {
    setShowSidebar((isVisible) => !isVisible);
  }, []);
  const [showRosterCard, setShowRosterCard] = useState(true);
  const [isMonthOpen, setIsMonthOpen] = useState(false);
  const [showControlBar, setShowControlBar] = useState(true);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [totalSyncRows, setTotalSyncRows] = useState(0);
  const [syncedRowsCount, setSyncedRowsCount] = useState(0);
  const [showSqlDialog, setShowSqlDialog] = useState(false);
  const [syncSchemaError, setSyncSchemaError] = useState('');
  

  useEffect(() => {
    const fetchRealtimeData = async () => {
      if (!isSupabaseConfigured()) {
        console.log("Supabase is not configured yet. Using local state.");
        return;
      }
      if (appData.Timesheet_SkipSupabaseRestore) {
        hasFetchedSupabase = true;
        console.log("Timesheet was explicitly cleared. Skipping automatic Supabase restore.");
        return;
      }
      if (hasFetchedSupabase) {
        console.log("Supabase data already loaded in this session. Skipping auto-fetch on tab switch.");
        return;
      }
      if (
        (appData.Timesheet_Roster && appData.Timesheet_Roster.length > 0) ||
        (appData.Q_Staff && appData.Q_Staff.length > 0)
      ) {
        console.log("Local data already exists. Skipping auto-fetch from Supabase to prevent overwriting unsynced local data.");
        hasFetchedSupabase = true;
        return;
      }
      try {
        // Fetch all data from tables
        const [dbRoster, dbStaff, dbSalary] = await Promise.all([
          fetchAllFromSupabaseTable("roster_cham_cong"),
          fetchAllFromSupabaseTable("nhan_vien"),
          fetchAllFromSupabaseTable("thang_luong"),
        ]);

        if ((dbRoster || []).length === 0 && (dbStaff || []).length === 0 && (dbSalary || []).length === 0) {
          console.log("Supabase tables are empty. Keeping initial local data so user can sync.");
          hasFetchedSupabase = true;
          return;
        }

        // Map Roster rows
        const mappedRoster = (dbRoster || []).map((row: any) => ({
          ...(row.raw_data || {}),
          _rowId: row.unique_id || `supa-r-${row.id}`,
          _uuid: row.unique_id || `supa-u-${row.id}`,
          _sourceFile: row.raw_data?._sourceFile || "Supabase_Live",
          center: row.center || row.l07 || "",
          l07: row.l07 || "",
          business: row.business || "",
          ma_nv: row.ma_nv || "",
          full_name: row.full_name || "",
          ngay: row.ngay || "",
          type: row.type || "",
          class: row.class || "",
          gio_vao: row.gio_vao || "",
          gio_ra: row.gio_ra || "",
          duration: Number(row.duration) || 0,
          notes: row.notes || "",
          employeeId: row.ma_nv || "",
          fullName: row.full_name || "",
          maAE: row.center || row.l07 || "",
          date: row.ngay || "",
          taskType: row.type || "",
          classCode: row.class || "",
          from: row.gio_vao || "",
          to: row.gio_ra || "",
          chargeToCenterMkt: row.charge_to_center_mkt || ""
        }));

        // Map Staff rows
        const mappedStaff = (dbStaff || []).map((row: any) => ({
          ...(row.raw_data || {}),
          _rowId: row.ma_nv || row.employee_id || row.id,
          employeeId: row.ma_nv || row.employee_id,
          fullName: row.ho_ten || row.full_name,
          bankAccountNumber: row.bank_number_acc || row.bank_account_number,
          salaryScale: row.salary_scale,
          business: row.business,
          center: row.center,
          from: row.from,
          to: row.to,
          className: row.class_name,
          noteDays: row.note_days
        }));

        // Map Salary scale rows
        const mappedSalary = (dbSalary || []).map((row: any) => ({
          ...(row.raw_data || {}),
          _rowId: row.unique_id,
          sCode: row.s_code,
          academicPrice: Number(row.academic_price) || 0,
          baseSalary: Number(row.base_salary) || 0,
          totalSalary: Number(row.total_salary) || 0,
          deductionHours: Number(row.deduction_hours) || 0
        }));

        hasFetchedSupabase = true;

        updateAppData((prev) => ({
          ...prev,
          Timesheet_Roster: mappedRoster,
          Q_Staff: mappedStaff,
          Q_Salary_Scale: mappedSalary
        }), false);

        console.log("Successfully loaded real-time data from Supabase:", {
          roster: mappedRoster.length,
          staff: mappedStaff.length,
          salary: mappedSalary.length
        });
      } catch (err) {
        console.error("Error fetching realtime Supabase data:", err);
      }
    };

    fetchRealtimeData();
  }, [updateAppData]);



  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const handleRequestTabChange = (e: any) => {
      if (e.detail && e.detail.tab) {
        if (e.detail.tab === "upload") {
          setView("upload");
        } else {
          setView("final");
          setActiveTab(e.detail.tab as any);
        }
      }
    };
    window.addEventListener("timesheet-request-tab-change", handleRequestTabChange);
    return () => window.removeEventListener("timesheet-request-tab-change", handleRequestTabChange);
  }, []);

  const [targetDate, setTargetDate] = useState("");
  const [targetCenter, setTargetCenter] = useState("");
  const [auditCascadeFilters, setAuditCascadeFilters] = useState<Record<string, string>>({});
  const isAuditNavigation = useMemo(() => {
    const from = String((location.state as any)?.from || "");
    return from === "audit" || from === "audit_applied" || from.includes("audit");
  }, [location.state]);

  const activeAuditFilterEntries = useMemo(() => {
    const navigationState = location.state as any;
    if (!isAuditNavigation) return [];

    const labels: Record<string, string> = {
      audit_type: "Type",
      l07: "L07",
      center: "Center",
      class: "Class",
      ngay: "Date",
      date: "Date",
      ma_nv: "TA ID",
      full_name: "TA Name",
    };
    const entries: { key: string; label: string; value: string }[] = [];
    const seenValues = new Set<string>();
    const addEntry = (key: string, value: unknown, label?: string) => {
      const displayValue = String(value || "").trim();
      const normalizedValue = normalizeFilterText(displayValue);
      if (!displayValue || seenValues.has(normalizedValue)) return;
      seenValues.add(normalizedValue);
      entries.push({ key, label: label || labels[key] || key, value: displayValue });
    };

    Object.entries(auditCascadeFilters).forEach(([key, value]) => addEntry(key, value));
    addEntry("center", targetCenter, "Center");
    addEntry("date", targetDate, "Date");
    addEntry("keyword", searchTerm, navigationState?.filterLabel || "Keyword");
    return entries;
  }, [auditCascadeFilters, isAuditNavigation, location.state, searchTerm, targetCenter, targetDate]);

  const handleDismissAuditFilters = useCallback(() => {
    startTransition(() => {
      setSearchTerm("");
      setDebouncedSearchTerm("");
      setTargetDate("");
      setTargetCenter("");
      setAuditCascadeFilters({});
    });
    tableRef.current?.clearAllFilters?.();
    navigate(location.pathname, {
      replace: true,
      state: { from: "cleared", activeTab: "roster_raw" },
    });
    toast.success("Đã hủy bộ lọc Audit và giữ nguyên bảng Raw Data");
  }, [location.pathname, navigate]);

  const handleClearFilters = useCallback(() => {
    startTransition(() => {
      setSearchTerm("");
      setDebouncedSearchTerm("");
      setTargetDate("");
      setTargetCenter("");
      setAuditCascadeFilters({});
      setFromDate("");
      setToDate("");
      setDebouncedFromDate("");
      setDebouncedToDate("");
    });
    updateAppData((prev) => {
      if (!prev.Timesheet_Dates?.from && !prev.Timesheet_Dates?.to) return prev;
      return {
        ...prev,
        Timesheet_Dates: { from: "", to: "" },
      };
    }, false);
    navigate(location.pathname, {
      replace: true,
      state: { from: "cleared" },
    });
    if (tableRef.current) {
      tableRef.current.clearAllFilters();
    }
  }, [location.pathname, navigate, updateAppData]);

  const handleResetDateFilter = useCallback(() => {
    startTransition(() => {
      setFromDate("");
      setToDate("");
      setDebouncedFromDate("");
      setDebouncedToDate("");
      setTargetDate("");
      setTargetCenter("");
      setAuditCascadeFilters({});
    });
    updateAppData((prev) => ({
      ...prev,
      Timesheet_Dates: { from: "", to: "" },
    }), false);
    toast.success("Đã hủy lọc thời gian (Đang hiển thị toàn bộ dữ liệu)");
  }, [updateAppData]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Remove effect syncing globalMonth down to local selectedMonth
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFromDate(fromDate);
      setDebouncedToDate(toDate);
    }, 180);
    return () => clearTimeout(timer);
  }, [fromDate, toDate]);

  useEffect(() => {
    const handleResetAllFiltersEvent = () => {
      handleClearFilters();
    };
    window.addEventListener("reset-all-filters", handleResetAllFiltersEvent);
    return () => {
      window.removeEventListener("reset-all-filters", handleResetAllFiltersEvent);
    };
  }, [handleClearFilters]);

  useEffect(() => {
    updateAppData((prev) => {
      if (
        prev.Timesheet_Dates?.from === debouncedFromDate &&
        prev.Timesheet_Dates?.to === debouncedToDate
      ) {
        return prev;
      }

      return {
        ...prev,
        Timesheet_Dates: { from: debouncedFromDate, to: debouncedToDate },
      };
    }, false);
  }, [debouncedFromDate, debouncedToDate, updateAppData]);

  const calculatedRosterData = useMemo(
    () => appData.Timesheet_Roster || [],
    [appData.Timesheet_Roster],
  );
  const calculatedSalaryScaleData = useMemo(() => appData.Q_Salary_Scale || [], [appData.Q_Salary_Scale]);
  const calculatedStaffData = useMemo(() => appData.Q_Staff || [], [appData.Q_Staff]);
  const calculatedCacheData = useMemo(() => appData.Q_Cache || [], [appData.Q_Cache]);

  const { processedRosterData, employeeSummary, centerSummary, isCalculating } =
    useTimesheetCalculations(
      calculatedRosterData,
      calculatedSalaryScaleData,
      calculatedStaffData,
      calculatedCacheData,
      debouncedFromDate,
      debouncedToDate,
      view === "final",
    );

  const employeeTotalHours = useMemo(() => {
    return employeeSummary.reduce((sum: number, r: any) => sum + (Number(r.totalHours ?? r.workingHours) || 0), 0);
  }, [employeeSummary]);

  const tabs = useMemo(
    () =>
      [
        { id: "employee", label: "Total Paid Hours", icon: Users },
        { id: "center", label: "Roster Center", icon: Building2 },
        { id: "mkt_local_north", label: "Pivot Timesheet", icon: FileText },
        { id: "roster_raw", label: "Raw Data", icon: FileText },
        { id: "type_rates", label: "Unit Rate Type", icon: Coins },
      ] as const,
    [],
  );

  useEffect(() => {
    const tabId = view === "upload" ? "upload" : activeTab;
    const label = tabId === "upload" ? "Setting Timesheet" : (tabs.find((t) => t.id === activeTab)?.label || "Timesheet Overview");
    const event = new CustomEvent("timesheet-tab-changed", { detail: { label, tab: tabId } });
    window.dispatchEvent(event);
  }, [activeTab, view, tabs]);

  const mktLocalNorthData = useMemo(() => {
    if (activeTab !== "center" && activeTab !== "mkt_local_north") return [];
    return processedRosterData.filter(isMktLocalNorthRosterRow);
  }, [activeTab, processedRosterData]);

  const displayEmployeeSummary = useMemo(() => {
    const overrides = appData.Timesheet_EmployeeOverrides || {};
    if (!employeeSummary || employeeSummary.length === 0) return [];
    if (Object.keys(overrides).length === 0) return employeeSummary;

    return employeeSummary.map((row: any) => {
      const empId = String(row.employeeId || row.ma_nv || row.id || row["ID Number"] || "").trim();
      const empOverride = overrides[empId];
      if (!empOverride) return row;
      return {
        ...row,
        ...empOverride,
        _overrideKey: empId,
      };
    });
  }, [employeeSummary, appData.Timesheet_EmployeeOverrides]);

  const displayCenterSummary = useMemo(() => {
    const overrides = appData.Timesheet_CenterOverrides || {};
    if (!centerSummary || centerSummary.length === 0) return [];
    if (Object.keys(overrides).length === 0) return centerSummary;

    return centerSummary.map((row: any) => {
      const centerKey = String(row.l07 || row.center || row.id || "").trim().toUpperCase();
      const centerOverride = overrides[centerKey];
      if (!centerOverride) return row;
      return {
        ...row,
        ...centerOverride,
        _overrideKey: centerKey,
      };
    });
  }, [centerSummary, appData.Timesheet_CenterOverrides]);

  const currentData = useMemo(() => {
    if (view !== "final") return [];
    if (activeTab === "roster_raw") {
      // Raw Data should be usable immediately while the calculation worker is
      // still enriching rows in the background.
      return isCalculating ? calculatedRosterData.map(normalizeTimesheetAllocation) : processedRosterData;
    }
    if (activeTab === "employee") return displayEmployeeSummary;
    if (activeTab === "center") return displayCenterSummary;
    if (activeTab === "mkt_local_north") return mktLocalNorthData;
    if (activeTab === "type_rates") return [{ id: "type_rates_active" }];
    return [];
  }, [view, activeTab, calculatedRosterData, displayCenterSummary, displayEmployeeSummary, isCalculating, mktLocalNorthData, processedRosterData]);

  const centerCoverageRows = useMemo(() => activeTab === "mkt_local_north"
    ? currentData.filter((row: Record<string, unknown>) => String(row.taskType || row.type || row.sourceType || "").trim())
    : currentData, [activeTab, currentData]);
  const centerCoverage = useMissingTimesheetCenters(
    centerCoverageRows,
    activeTab === "mkt_local_north" ? "allocation" : "l07",
    {
      from: debouncedFromDate,
      to: debouncedToDate,
      preferredYear: uiSettings.defaultAuditYear || Number(debouncedFromDate.slice(0, 4)) || new Date().getFullYear(),
    },
    view === "final",
  );

  const rosterMetrics = useMemo(() => {
    let unpaidRows = 0;
    let totalDuration = 0;
    for (const row of calculatedRosterData) {
      if (row.loai === "KL") unpaidRows += 1;
      totalDuration += Number(row.duration) || 0;
    }
    return { unpaidRows, totalDuration };
  }, [calculatedRosterData]);

  const searchData = useMemo(() => {
    let data = currentData;

    const cascadeEntries = Object.entries(auditCascadeFilters).filter(([, value]) => value);
    if (targetDate || targetCenter || cascadeEntries.length > 0) {
      const normalizedTargetDate = normalizeDateFilterValue(targetDate);
      const normalizedTargetCenter = normalizeFilterText(targetCenter);

      data = data.filter((row: any) => {
        const rowDate = normalizeDateFilterValue(row.ngay ?? row.date);
        const rowL07 = normalizeFilterText(row.l07);
        const rowCenterCode = normalizeFilterText(row.center);

        if (normalizedTargetDate && rowDate !== normalizedTargetDate) return false;
        if (normalizedTargetCenter && rowL07 !== normalizedTargetCenter && rowCenterCode !== normalizedTargetCenter) return false;

        for (const [key, expected] of cascadeEntries) {
          if (key === "audit_type") {
            if (!isAuditInClassType(getAuditRawType(row))) return false;
            continue;
          }
          if (key === "ngay" || key === "date") {
            if (rowDate !== normalizeDateFilterValue(expected)) return false;
            continue;
          }
          if (key === "l07" || key === "center") {
            const normalizedExpected = normalizeFilterText(expected);
            if (rowL07 !== normalizedExpected && rowCenterCode !== normalizedExpected) return false;
            continue;
          }
          if (key === "class") {
            if (normalizeFilterText(row.class ?? row.classCode) !== normalizeFilterText(expected)) return false;
            continue;
          }
          if (key === "ma_nv") {
            const actualId = normalizeFilterText(row.ma_nv ?? row.employeeId).replace(/^0+/, "");
            const expectedId = normalizeFilterText(expected).replace(/^0+/, "");
            if (actualId !== expectedId) return false;
            continue;
          }
          if (key === "full_name") {
            if (normalizeFilterText(row.full_name ?? row.fullName) !== normalizeFilterText(expected)) return false;
            continue;
          }
          if (normalizeFilterText(row[key]) !== normalizeFilterText(expected)) return false;
        }
        return true;
      });
    }

    if (debouncedSearchTerm) {
      const lowerSearch = normalizeFilterText(debouncedSearchTerm);
      const lowerSearchTrimmedZero = lowerSearch.replace(/^0+/, "");

      // Check if this search term is already strictly satisfied by cascadeFilters
      const isSearchInCascade = cascadeEntries.some(([, val]) => {
        const normVal = normalizeFilterText(val);
        return normVal && (normVal === lowerSearch || normVal.replace(/^0+/, "") === lowerSearchTrimmedZero);
      });

      if (!isSearchInCascade) {
        const searchCache = timesheetSearchCache;

        data = data.filter((row: any) => {
          // Use precomputed _searchStr if available
          let rowSearchStr = typeof row._searchStr === "string"
            ? row._searchStr
            : searchCache.get(row);
          
          if (rowSearchStr !== undefined) {
            if (rowSearchStr.includes(lowerSearch)) return true;
            if (lowerSearchTrimmedZero && rowSearchStr.includes(lowerSearchTrimmedZero)) return true;
            return false;
          }

          rowSearchStr = "";
          
          // Optimize search to only search in keys that might be displayed
          for (const [key, value] of Object.entries(row)) {
            if (value == null) continue;
            if (typeof value === "string" || typeof value === "number") {
              rowSearchStr += `|${normalizeFilterText(value)}`;
            }
          }
          
          // Cache it for future filtering
          searchCache.set(row, rowSearchStr);

          return rowSearchStr.includes(lowerSearch) || (lowerSearchTrimmedZero ? rowSearchStr.includes(lowerSearchTrimmedZero) : false);
        });
      }
    }

    return data;
  }, [currentData, debouncedSearchTerm, targetDate, targetCenter, auditCascadeFilters]);
  const deferredRawData = useDeferredValue(searchData);

  // Handle deep linking and navigation resets
  useEffect(() => {
    const state = location.state as any;
    if (state && state.from === "audit") {
      // Apply filters
      if (state.activeTab) setActiveTab(state.activeTab);

      const cascade = state.cascadeFilters as Record<string, string> | undefined;

      if (cascade && Object.keys(cascade).length > 0) {
        setAuditCascadeFilters(cascade);
        // Set top bar control values
        if (cascade["l07"]) {
          setTargetCenter(cascade["l07"]);
        } else if (state.filterCenter) {
          setTargetCenter(state.filterCenter);
        } else {
          setTargetCenter("");
        }

        if (cascade["ngay"]) {
          setTargetDate(cascade["ngay"]);
        } else if (state.filterDate) {
          setTargetDate(state.filterDate);
        } else {
          setTargetDate("");
        }

        // Set KEYWORD input search term in top card
        const keywordVal =
          state.filterValue ||
          state.searchTerm ||
          cascade["class"] ||
          cascade["ma_nv"] ||
          cascade["full_name"] ||
          "";
        setSearchTerm(keywordVal);
        setDebouncedSearchTerm(keywordVal);

      } else {
        setAuditCascadeFilters({});
        const filterCol = state.filterColumn;
        const filterVal = state.filterValue;

        if (filterCol && filterVal) {
          if (filterCol === "ngay") {
            setTargetDate(filterVal);
            setTargetCenter("");
            setSearchTerm("");
            setDebouncedSearchTerm("");
          } else if (filterCol === "l07" || filterCol === "center") {
            setTargetCenter(filterVal);
            setTargetDate("");
            setSearchTerm("");
            setDebouncedSearchTerm("");
          } else {
            setTargetDate("");
            setTargetCenter("");
            setSearchTerm(filterVal);
            setDebouncedSearchTerm(filterVal);
          }
        } else {
          if (state.searchTerm) {
            setSearchTerm(state.searchTerm);
            setDebouncedSearchTerm(state.searchTerm);
          } else {
            setSearchTerm("");
            setDebouncedSearchTerm("");
          }
          if (state.filterDate) setTargetDate(state.filterDate);
          else setTargetDate("");
          if (state.filterCenter) setTargetCenter(state.filterCenter);
          else setTargetCenter("");
        }

      }

      // Scroll to the table after a brief delay to ensure rendering
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);

      // Clear location state but DO NOT trigger cleanup
      navigate(location.pathname, {
        replace: true,
        state: { ...state, from: "audit_applied" },
      });
    }
  }, [location.state, navigate, location.pathname]);

  // Separate effect for clearing filters when navigating NOT from audit
  useEffect(() => {
    const state = location.state as any;
    // Only clear if the user manually changed the URL, not because we cleared the state internally
    if (
      !state ||
      (state.from !== "audit" &&
        state.from !== "audit_applied" &&
        state.from !== "cleared" &&
        !state.activeTab)
    ) {
      handleClearFilters();
      setActiveTab("roster_raw");
      setView("final");
    }
  }, [location.state, handleClearFilters]);

  // 1. Get unique non-empty type values for Pivot Table columns (excluding empty key values as requested)
  const mktPivotUniqueTypes = useMemo(() => {
    if (activeTab !== "mkt_local_north") return [];
    const typesSet = new Set<string>();
    searchData.forEach((r: any) => {
      const type = String(r.taskType || r.type || r.sourceType || "").trim().toUpperCase();
      if (type) {
        typesSet.add(type);
      }
    });
    return Array.from(typesSet).sort();
  }, [activeTab, searchData]);

  // 2. Aggregate row data by business -> center -> chargeToCenterMkt
  const mktPivotRows = useMemo(() => {
    if (activeTab !== "mkt_local_north") return [];
    
    const map = new Map<string, {
      business: string;
      center: string;
      chargeToCenterMkt: string;
      values: Record<string, number>;
      total: number;
      sourceRowKeys: string[];
      sourceRowKeysByType: Record<string, string[]>;
    }>();

    searchData.forEach((r: any) => {
      const type = String(r.taskType || r.type || r.sourceType || "").trim().toUpperCase();
      if (!type) return; // skip empty data as requested

      const chargeMkt = String(r.chargeToCenterMkt || r.charge_to_center_mkt || r.center || r.l07 || "").trim();
      // Pivot allocation follows the destination L07, not the generic MKT
      // source BU. This makes TN0001.LNQ -> ATN and TH0001.TPU -> ATH
      // authoritative even for rows imported with a stale AHN value.
      const resolved = resolveMktRosterCenter(chargeMkt);
      const canonicalChargeMkt = resolved.l07 || mapL07(chargeMkt) || chargeMkt;
      const knownAllocation = getCenterInfoByL07(canonicalChargeMkt);
      const bus = resolved.business
        || knownAllocation?.bus
        || String(r.business || "").trim()
        || getBusinessFromL07(canonicalChargeMkt || chargeMkt || String(r.l07 || ""))
        || "AHN";
      const key = `${bus}||${canonicalChargeMkt}`;

      if (!map.has(key)) {
        map.set(key, {
          business: bus,
          center: "",
          chargeToCenterMkt: canonicalChargeMkt,
          values: {},
          total: 0,
          sourceRowKeys: [],
          sourceRowKeysByType: {},
        });
      }

      const item = map.get(key)!;
      const sourceRowKey = getRosterSourceKey(r);
      if (sourceRowKey && !item.sourceRowKeys.includes(sourceRowKey)) {
        item.sourceRowKeys.push(sourceRowKey);
      }
      if (!item.sourceRowKeysByType[type]) item.sourceRowKeysByType[type] = [];
      if (sourceRowKey && !item.sourceRowKeysByType[type].includes(sourceRowKey)) {
        item.sourceRowKeysByType[type].push(sourceRowKey);
      }
      const hours = Number(r.workingHours ?? r.duration) || 0;
      // Value: working hours * 20,000 as requested
      const rawOverride = r._mktPivotValueOverride;
      const hasOverride =
        rawOverride !== undefined &&
        rawOverride !== null &&
        rawOverride !== "" &&
        Number.isFinite(Number(rawOverride));
      const value = hasOverride ? Number(rawOverride) : hours * 20000;

      item.values[type] = (item.values[type] || 0) + value;
      item.total += value;
    });

    return Array.from(map.values()).sort((a, b) => {
      const comp1 = a.business.localeCompare(b.business);
      if (comp1 !== 0) return comp1;
      return a.chargeToCenterMkt.localeCompare(b.chargeToCenterMkt);
    });
  }, [activeTab, searchData]);

  // 3. Compute column and grand totals for the Pivot Grid
  const mktPivotGrandTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    let grandTotal = 0;
    
    mktPivotRows.forEach((row) => {
      mktPivotUniqueTypes.forEach((type) => {
        totals[type] = (totals[type] || 0) + (row.values[type] || 0);
      });
      grandTotal += row.total;
    });

    return { totals, grandTotal };
  }, [mktPivotRows, mktPivotUniqueTypes]);

  const handleMktPivotCellChange = useCallback((row: any, field: string, value: unknown) => {
    const sourceKeys = new Set<string>(
      field === "chargeToCenterMkt"
        ? row.sourceRowKeys || []
        : row.sourceRowKeysByType?.[field] || [],
    );
    if (sourceKeys.size === 0) {
      toast.error("Không tìm thấy dòng dữ liệu nguồn để cập nhật.");
      return;
    }

    if (field === "chargeToCenterMkt") {
      const rawL07 = String(value || "").trim();
      if (!rawL07) {
        toast.error("L07 không được để trống.");
        return;
      }
      updateAppData((prev) => ({
        ...prev,
        Timesheet_Roster: applyTimesheetPivotEdit(prev.Timesheet_Roster || [], sourceKeys, field, rawL07),
        updatedAt: new Date().toISOString(),
      }), true, true);
      toast.success("Đã lưu L07 của Pivot Timesheet.");
      return;
    }

    updateAppData((prev) => ({
      ...prev,
      Timesheet_Roster: applyTimesheetPivotEdit(prev.Timesheet_Roster || [], sourceKeys, field, value),
      updatedAt: new Date().toISOString(),
    }), true, true);
    toast.success("Đã cập nhật giá trị Pivot Timesheet.");
  }, [updateAppData]);

  const handleExportExcel = () => {
    const key = activeTab === "roster_raw" ? "timesheet_roster_raw" : activeTab === "employee" ? "timesheet_employee" : "timesheet_center";
    if (activeTab !== "mkt_local_north" && downloadTableExcel(key)) return;
    if (currentData.length === 0) return;

    if (activeTab === "mkt_local_north") {
      const rows = mktPivotRows.map((row) => {
        const item: any = {
          "Business": row.business,
          "Charge To Center MKT": row.chargeToCenterMkt,
        };
        mktPivotUniqueTypes.forEach((type) => {
          item[type] = row.values[type] || 0;
        });
        item["Grand Total"] = row.total;
        return item;
      });

      // Add Grand Totals Row
      const totalsRow: any = {
        "Business": "TỔNG CỘNG",
        "L07 (Region)": "",
        "Charge To Center MKT": "",
      };
      mktPivotUniqueTypes.forEach((type) => {
        totalsRow[type] = mktPivotGrandTotals.totals[type] || 0;
      });
      totalsRow["Grand Total"] = mktPivotGrandTotals.grandTotal;
      rows.push(totalsRow);

      const ws = XLSX.utils.json_to_sheet(prepareDataForExport(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Phí MKT Local North (Pivot)");
      XLSX.writeFile(wb, `Pivot_Phi_MKT_Local_North.xlsx`);
      return;
    }

    let exportRows = currentData;
    
    if (activeTab === "roster_raw") {
      exportRows = currentData.map((row: any) => {
        const mappedRow: any = {};
        ROSTER_RAW_COLUMNS.forEach(col => {
          if (!col.hidden) {
            mappedRow[col.label] = row[col.key];
          }
        });
        return mappedRow;
      });
    }

    const ws = XLSX.utils.json_to_sheet(prepareDataForExport(exportRows));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeTab);
    XLSX.writeFile(wb, `Timesheet_Hub_${activeTab}.xlsx`);
  };

  const handleExportAllExcel = useCallback(() => {
    const exportRoster = isCalculating
      ? calculatedRosterData
      : processedRosterData;
    const rawRows = exportRoster.map((row: any) => {
      const mappedRow: Record<string, unknown> = {};
      ROSTER_RAW_COLUMNS.forEach((column) => {
        if (!column.hidden) mappedRow[column.label] = row[column.key];
      });
      return mappedRow;
    });
    const centerTable = buildCenterTable(centerSummary, mktLocalNorthData);
    const pivotRows = buildTimesheetMktPivotExportRows(exportRoster);
    const pivotTotal = Number(
      pivotRows[pivotRows.length - 1]?.["Grand Total"] || 0,
    );
    const sumByKeys = (rows: any[], keys: string[]) =>
      rows.reduce((total, row) => {
        const key = keys.find(
          (candidate) =>
            row?.[candidate] !== undefined && row?.[candidate] !== "",
        );
        return total + (key ? parseMoneyToNumber(row[key]) : 0);
      }, 0);
    const dateStamp = new Date().toISOString().slice(0, 10);

    void downloadHierarchicalWorkbook({
      title: "TIMESHEET",
      fileName: `Payroll_Hub_Timesheet_${dateStamp}.xlsx`,
      pages: [
        {
          title: "Total Paid Hours",
          children: [
            {
              title: "Employee Paid Hours",
              sheetName: "Total Paid Hours",
              table: {
                storageKey: "timesheet_employee",
                columns: getDynamicEmployeeColumns(exportRoster).map(c => ({key: String(c.key), label: String(c.label), type: String(c.type || "text"), hidden: Boolean(c.hidden)})),
                rows: employeeSummary,
                cards: [
                  { label: "Employees", value: employeeSummary.length },
                  {
                    label: "Total Paid Hours",
                    value: sumByKeys(employeeSummary, [
                      "totalPaidHours",
                      "paidHours",
                      "workingHours",
                      "Total Hours",
                      "Tổng giờ",
                    ]),
                  },
                  { label: "From Date", value: fromDate || "Tất cả" },
                  { label: "To Date", value: toDate || "Tất cả" },
                ],
              },
            },
          ],
        },
        {
          title: "Roster Center",
          children: [
            {
              title: "Center Summary",
              sheetName: "Roster Center",
              table: {
                storageKey: "timesheet_center",
                columns: centerTable.centerColumns,
                rows: centerTable.centerRows,
                cards: [
                  { label: "Centers", value: centerSummary.length },
                  {
                    label: "Total Hours",
                    value: sumByKeys(centerSummary, [
                      "totalHours",
                      "workingHours",
                      "Total Hours",
                      "Tổng giờ",
                    ]),
                  },
                ],
              },
            },
          ],
        },
        {
          title: "Pivot Timesheet",
          children: [
            {
              title: "MKT Local North Cost Allocation",
              sheetName: "Pivot Timesheet",
              table: {
                rows: pivotRows,
                cards: [
                  {
                    label: "Allocation Rows",
                    value: Math.max(pivotRows.length - 1, 0),
                  },
                  { label: "Grand Total", value: pivotTotal },
                ],
              },
            },
          ],
        },
        {
          title: "Raw Data",
          children: [
            {
              title: "Roster Raw Data",
              sheetName: "Raw Data",
              table: {
                storageKey: "timesheet_roster_raw",
                rows: exportRoster,
                columns: ROSTER_RAW_COLUMNS,
                cards: [
                  { label: "Rows", value: rawRows.length },
                  { label: "Total Duration", value: rosterMetrics.totalDuration },
                  { label: "Unpaid Rows", value: rosterMetrics.unpaidRows },
                ],
              },
            },
          ],
        },
      ],
    })
      .then(() =>
        toast.success("Đã xuất toàn bộ 4 trang Timesheet và dữ liệu card."),
      )
      .catch((error) => {
        console.error("Timesheet workbook export failed:", error);
        toast.error("Không thể xuất workbook Timesheet.");
      });
  }, [
    calculatedRosterData,
    mktLocalNorthData,
    centerSummary,
    employeeSummary,
    fromDate,
    isCalculating,
    processedRosterData,
    rosterMetrics.totalDuration,
    rosterMetrics.unpaidRows,
    toDate,
  ]);

  const handleSyncToSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase chưa được cấu hình! Vui lòng cài đặt URL và Anon Key trong phần cấu hình.");
      return;
    }

    const rosterData = appData.Timesheet_Roster || [];
    const staffData = appData.Q_Staff || [];
    const salaryData = appData.Q_Salary_Scale || [];

    if (rosterData.length === 0 && staffData.length === 0 && salaryData.length === 0) {
      toast.warning("Không có dữ liệu để đồng bộ.");
      return;
    }

    setIsSyncing(true);
    setTotalSyncRows(rosterData.length + staffData.length + salaryData.length);
    setSyncedRowsCount(0);
    setSyncProgress(0);

    try {
      await preflightTimesheetSync([
        ...(rosterData.length ? ['roster_cham_cong' as const] : []),
        ...(staffData.length ? ['nhan_vien' as const] : []),
        ...(salaryData.length ? ['thang_luong' as const] : []),
      ]);
      let overallSuccessCount = 0;
      const totalToSync = rosterData.length + staffData.length + salaryData.length;

      // 1. Sync Staff
      if (staffData.length > 0) {
        const { successCount } = await syncEmployeesToSupabase(
          staffData,
          (current) => {
            setSyncedRowsCount(current);
            setSyncProgress(Math.round((current / totalToSync) * 100));
          }
        );
        overallSuccessCount += successCount;
      }

      // 2. Sync Salary Scale
      if (salaryData.length > 0) {
        const { successCount } = await syncSalaryScalesToSupabase(
          salaryData,
          (current) => {
            const currentTotal = staffData.length + current;
            setSyncedRowsCount(currentTotal);
            setSyncProgress(Math.round((currentTotal / totalToSync) * 100));
          }
        );
        overallSuccessCount += successCount;
      }

      // 3. Sync Roster
      if (rosterData.length > 0) {
        const { successCount } = await syncRosterToSupabase(
          rosterData,
          (current) => {
            const currentTotal = staffData.length + salaryData.length + current;
            setSyncedRowsCount(currentTotal);
            setSyncProgress(Math.round((currentTotal / totalToSync) * 100));
          }
        );
        overallSuccessCount += successCount;
      }

      toast.success(`Đồng bộ thành công ${overallSuccessCount.toLocaleString()}/${totalToSync.toLocaleString()} dòng lên Supabase.`);
      
      updateAppData((prev: any) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        lastSupabaseSyncAt: new Date().toISOString(),
        Timesheet_SkipSupabaseRestore: false,
      }), true);
      toast.success("Đã tự động lưu cứng dữ liệu trên web.");
    } catch (err: unknown) {
      console.error("Supabase Sync Error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(`Đồng bộ thất bại: ${errMsg}`);
      if (err instanceof SupabaseSchemaError) {
        setSyncSchemaError(err.message);
        setShowSqlDialog(true);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [appData.Timesheet_Roster, appData.Q_Staff, appData.Q_Salary_Scale, updateAppData]);

  const handleFetchFromSupabase = useCallback(async (isSilent = false) => {
    if (!isSupabaseConfigured()) {
      if (!isSilent) {
        toast.error("Supabase chưa được cấu hình! Vui lòng cài đặt URL và Anon Key trong phần cấu hình.");
      }
      return;
    }

    const loadToastId = !isSilent ? toast.loading("Đang tải dữ liệu từ Supabase...") : null;

    try {
      // Fetch all data from tables
      const [dbRoster, dbStaff, dbSalary] = await Promise.all([
        fetchAllFromSupabaseTable("roster_cham_cong"),
        fetchAllFromSupabaseTable("nhan_vien"),
        fetchAllFromSupabaseTable("thang_luong"),
      ]);

      if ((dbRoster || []).length === 0 && (dbStaff || []).length === 0 && (dbSalary || []).length === 0) {
        if (!isSilent) {
          toast.warning("Dữ liệu trên Supabase hiện đang trống. Hãy bấm 'Đồng bộ Supabase' trước để đẩy dữ liệu lên.");
        }
        if (loadToastId) toast.dismiss(loadToastId);
        return;
      }

      // Map Roster rows
      const mappedRoster = (dbRoster || []).map((row: any) => ({
        ...(row.raw_data || {}),
        _rowId: row.unique_id || `supa-r-${row.id}`,
        _uuid: row.unique_id || `supa-u-${row.id}`,
        _sourceFile: row.raw_data?._sourceFile || "Supabase_Live",
        center: row.center || row.l07 || "",
        l07: row.l07 || "",
        business: row.business || "",
        ma_nv: row.ma_nv || "",
        full_name: row.full_name || "",
        ngay: row.ngay || "",
        type: row.type || "",
        class: row.class || "",
        gio_vao: row.gio_vao || "",
        gio_ra: row.gio_ra || "",
        duration: Number(row.duration) || 0,
        notes: row.notes || "",
        employeeId: row.ma_nv || "",
        fullName: row.full_name || "",
        maAE: row.center || row.l07 || "",
        date: row.ngay || "",
        taskType: row.type || "",
        classCode: row.class || "",
        from: row.gio_vao || "",
        to: row.gio_ra || "",
        chargeToCenterMkt: row.charge_to_center_mkt || ""
      }));

      // Map Staff rows
      const mappedStaff = (dbStaff || []).map((row: any) => ({
        ...(row.raw_data || {}),
        _rowId: row.ma_nv || row.employee_id || row.id,
        employeeId: row.ma_nv || row.employee_id,
        fullName: row.ho_ten || row.full_name,
        bankAccountNumber: row.bank_number_acc || row.bank_account_number,
        salaryScale: row.salary_scale,
        business: row.business,
        center: row.center,
        from: row.from,
        to: row.to,
        className: row.class_name,
        noteDays: row.note_days
      }));

      // Map Salary scale rows
      const mappedSalary = (dbSalary || []).map((row: any) => ({
        ...(row.raw_data || {}),
        _rowId: row.unique_id,
        sCode: row.s_code,
        academicPrice: Number(row.academic_price) || 0,
        baseSalary: Number(row.base_salary) || 0,
        totalSalary: Number(row.total_salary) || 0,
        deductionHours: Number(row.deduction_hours) || 0
      }));

      hasFetchedSupabase = true;

      updateAppData((prev) => ({
        ...prev,
        Timesheet_Roster: mappedRoster,
        Q_Staff: mappedStaff,
        Q_Salary_Scale: mappedSalary,
        updatedAt: new Date().toISOString(),
        Timesheet_SkipSupabaseRestore: false,
      }), true);

      if (loadToastId) {
        toast.dismiss(loadToastId);
        toast.success(`Đã lấy dữ liệu từ Supabase về ứng dụng thành công (${mappedRoster.length} dòng Roster, ${mappedStaff.length} Nhân viên)!`);
      }
    } catch (err: any) {
      console.error("Error fetching Supabase data:", err);
      if (loadToastId) {
        toast.dismiss(loadToastId);
        toast.error(`Không thể lấy dữ liệu từ Supabase: ${err.message}`);
      }
    }
  }, [updateAppData]);

  const handleSaveData = useCallback(async () => {
    updateAppData((prev: any) => ({
      ...prev,
      updatedAt: new Date().toISOString()
    }), true);
    
    if (isSupabaseConfigured()) {
      toast.info("Đang tự động đồng bộ dữ liệu thay đổi lên Supabase...");
      await handleSyncToSupabase();
    } else {
      toast.success("Đã lưu dữ liệu thay đổi offline thành công!");
    }
  }, [updateAppData, handleSyncToSupabase]);

  const handleRestoreOriginal = useCallback(async () => {
    if (isSupabaseConfigured()) {
      const choice = window.confirm(
        "BẠN CÓ MUỐN LẤY LẠI DỮ LIỆU ĐÃ ĐỒNG BỘ TRÊN SUPABASE KHÔNG?\n\n" +
        "- Bấm OK: Để khôi phục bằng cách tải dữ liệu đã lưu từ Supabase về ứng dụng (An toàn, khuyên dùng).\n" +
        "- Bấm Cancel (Hủy): Để khôi phục hoàn toàn về DỮ LIỆU MẪU BAN ĐẦU (Sẽ XÓA SẠCH toàn bộ dữ liệu hiện tại trên Supabase và tải lại dữ liệu mẫu)."
      );
      
      if (choice) {
        await handleFetchFromSupabase();
        return;
      }
      
      const confirmForceReset = window.confirm(
        "CẢNH BÁO NGUY HIỂM: Bạn đã chọn khôi phục về DỮ LIỆU MẪU BAN ĐẦU.\n\n" +
        "Thao tác này sẽ XÓA SẠCH TOÀN BỘ dữ liệu của bạn trên Supabase để ghi đè dữ liệu mẫu ban đầu. Bạn có thực sự muốn tiếp tục không?"
      );
      if (!confirmForceReset) return;
    } else {
      const confirmReset = window.confirm(
        "Bạn có chắc chắn muốn khôi phục dữ liệu mẫu ban đầu không? Toàn bộ thay đổi của bạn sẽ bị xóa.",
      );
      if (!confirmReset) return;
    }

    const loadToastId = toast.loading("Đang xóa dữ liệu Supabase và đồng bộ lại dữ liệu mẫu...");

    try {
      // 1. Clear old data on Supabase
      await clearSupabaseData();

      // 2. Sync Employees
      const staffData = INITIAL_APP_DATA.Q_Staff || [];
      if (staffData.length > 0) {
        await syncEmployeesToSupabase(staffData);
      }

      // 3. Sync Salary Scales
      const salaryData = INITIAL_APP_DATA.Q_Salary_Scale || [];
      if (salaryData.length > 0) {
        await syncSalaryScalesToSupabase(salaryData);
      }

      // 4. Sync Rosters
      const rosterData = INITIAL_APP_DATA.Timesheet_Roster || [];
      if (rosterData.length > 0) {
        await syncRosterToSupabase(rosterData, () => {});
      }

      // 5. Update Local App Data to match
      updateAppData((prev) => ({
        ...prev,
        Timesheet_Roster: [...rosterData],
        Q_Staff: [...staffData],
        Q_Salary_Scale: [...salaryData],
        Q_Cache: INITIAL_APP_DATA.Q_Cache ? [...INITIAL_APP_DATA.Q_Cache] : [],
        updatedAt: new Date().toISOString(),
        lastSupabaseSyncAt: new Date().toISOString()
      }), true);

      toast.dismiss(loadToastId);
      toast.success("Khôi phục và đồng bộ dữ liệu mẫu lên Supabase thành công!");
    } catch (error: any) {
      console.error("Lỗi khôi phục Supabase:", error);
      toast.dismiss(loadToastId);
      toast.error(`Khôi phục thất bại: ${error.message}`);
      if (
        error.message.includes("chưa tồn tại") || 
        error.message.includes("relation") || 
        error.message.includes("does not exist") ||
        error.message.includes("unique_nv_ngay") ||
        error.message.includes("ràng buộc") ||
        error.message.includes("trùng lặp")
      ) {
        setShowSqlDialog(true);
      }
    }
  }, [updateAppData, handleFetchFromSupabase]);

  const handleRosterCellChange = useCallback((row: any, colKey: string, value: any) => {
    const sourceKey = getRosterSourceKey(row);
    updateAppData((prev) => ({
      ...prev,
      Timesheet_Roster: (prev.Timesheet_Roster || []).map((sourceRow) =>
        getRosterSourceKey(sourceRow) === sourceKey
          ? applyTimesheetRosterCellEdit(sourceRow, colKey, value)
          : sourceRow,
      ),
      updatedAt: new Date().toISOString(),
    }), true, true);
    toast.success("Đã lưu thay đổi vào bảng Raw Data");
  }, [updateAppData]);

  const handleEmployeeCellChange = useCallback((row: any, colKey: string, value: any) => {
    const empId = String(row._overrideKey || row.employeeId || row.ma_nv || row.id || row["ID Number"] || "").trim();
    if (!empId) {
      toast.error("Không tìm thấy mã nhân viên để cập nhật.");
      return;
    }

    updateAppData((prev) => {
      const prevOverrides = prev.Timesheet_EmployeeOverrides || {};
      const currentEmpOverride = prevOverrides[empId] || {};
      const updatedOverrides = {
        ...prevOverrides,
        [empId]: {
          ...currentEmpOverride,
          [colKey]: value,
        },
      };

      // Also update Timesheet_Roster and Q_Staff if core employee fields are modified
      let nextRoster = prev.Timesheet_Roster || [];
      let nextStaff = prev.Q_Staff || [];

      if (colKey === "fullName" || colKey === "full_name") {
        nextRoster = nextRoster.map((r: any) => {
          if (String(r.ma_nv || r.employeeId || "").trim().toLowerCase() === empId.toLowerCase()) {
            return applyTimesheetRosterCellEdit(r, "full_name", value);
          }
          return r;
        });
        nextStaff = nextStaff.map((s: any) => {
          if (String(s.id || s["id number"] || s.ma_nv || "").trim().toLowerCase() === empId.toLowerCase()) {
            return { ...s, fullName: value, full_name: value, name: value, "Full Name": value };
          }
          return s;
        });
      } else if (colKey === "center" || colKey === "l07") {
        nextRoster = nextRoster.map((r: any) => {
          if (String(r.ma_nv || r.employeeId || "").trim().toLowerCase() === empId.toLowerCase()) {
            return applyTimesheetRosterCellEdit(r, "l07", value);
          }
          return r;
        });
      } else if (colKey === "business") {
        nextRoster = nextRoster.map((r: any) => {
          if (String(r.ma_nv || r.employeeId || "").trim().toLowerCase() === empId.toLowerCase()) {
            return applyTimesheetRosterCellEdit(r, "business", value);
          }
          return r;
        });
      } else if (colKey === "bankAccountNumber") {
        nextStaff = nextStaff.map((s: any) => {
          if (String(s.id || s["id number"] || s.ma_nv || "").trim().toLowerCase() === empId.toLowerCase()) {
            return { ...s, bankAccountNumber: value, "Bank Account": value };
          }
          return s;
        });
      } else if (colKey === "salaryScale") {
        nextStaff = nextStaff.map((s: any) => {
          if (String(s.id || s["id number"] || s.ma_nv || "").trim().toLowerCase() === empId.toLowerCase()) {
            return { ...s, salaryScale: value, "Salary Scale": value, scale: value };
          }
          return s;
        });
      }

      return {
        ...prev,
        Timesheet_EmployeeOverrides: updatedOverrides,
        Timesheet_Roster: nextRoster,
        Q_Staff: nextStaff,
        updatedAt: new Date().toISOString(),
      };
    }, true, true);

    toast.success(`Đã lưu ${colKey} cho nhân viên ${row.fullName || empId}!`);
  }, [updateAppData]);

  const handleCenterCellChange = useCallback((row: any, colKey: string, value: any) => {
    if (row._isSubtotal || row._isTotalRow) {
      toast.warning("Không thể chỉnh sửa dòng tổng cộng");
      return;
    }

    const centerKey = String(row._overrideKey || row.l07 || row.center || row.id || "").trim().toUpperCase();
    if (!centerKey) {
      toast.error("Không tìm thấy mã cơ sở để cập nhật.");
      return;
    }

    const sourceFields = new Map<string, string>();
    processedRosterData.forEach((source: any) => {
      const effectiveCenter = source.isMktLocal && source.chargeToCenterMkt
        ? source.chargeToCenterMkt : source.l07 || source.center;
      if (String(effectiveCenter || "").trim().toUpperCase() === centerKey) {
        sourceFields.set(getRosterSourceKey(source), source.isMktLocal ? "chargeToCenterMkt" : "l07");
      }
    });
    updateAppData((prev) => {
      const prevOverrides = prev.Timesheet_CenterOverrides || {};
      const currentCenterOverride = prevOverrides[centerKey] || {};
      const updatedOverrides = {
        ...prevOverrides,
        [centerKey]: {
          ...currentCenterOverride,
          [colKey]: value,
        },
      };

      let nextRoster = prev.Timesheet_Roster || [];
      if (colKey === "business") {
        nextRoster = nextRoster.map((r: any) => {
          if (sourceFields.has(getRosterSourceKey(r))) {
            return applyTimesheetRosterCellEdit(r, "business", value);
          }
          return r;
        });
      } else if (colKey === "l07" || colKey === "center") {
        nextRoster = nextRoster.map((r: any) => {
          const sourceField = sourceFields.get(getRosterSourceKey(r));
          if (sourceField) {
            return applyTimesheetRosterCellEdit(r, sourceField, value);
          }
          return r;
        });
        if (sourceFields.size > 0) {
          const nextKey = (mapL07(String(value ?? "")) || String(value ?? "")).trim().toUpperCase();
          if (nextKey && nextKey !== centerKey) {
            updatedOverrides[nextKey] = { ...prevOverrides[nextKey], ...updatedOverrides[centerKey] };
            delete updatedOverrides[centerKey];
          }
        }
      }

      return {
        ...prev,
        Timesheet_CenterOverrides: updatedOverrides,
        Timesheet_Roster: nextRoster,
        updatedAt: new Date().toISOString(),
      };
    }, true, true);

    toast.success(`Đã lưu ${colKey} cho cơ sở ${row.l07 || centerKey}!`);
  }, [processedRosterData, updateAppData]);

  const handleRosterDeleteRows = useCallback((rowsToDelete: any[]) => {
    const idsToDelete = new Set(
      rowsToDelete.map((r) => r.id || r._uuid || r._recordId || `${r.ma_nv}_${r.ngay}_${r.gio_vao}`)
    );
    updateAppData((prev) => ({
      ...prev,
      Timesheet_Roster: (prev.Timesheet_Roster || []).filter((r: any) => {
        const key = r.id || r._uuid || r._recordId || `${r.ma_nv}_${r.ngay}_${r.gio_vao}`;
        return !idsToDelete.has(key);
      }),
    }), true, true, ["Timesheet_Roster"]);
    toast.success(`Đã xóa ${rowsToDelete.length} dòng dữ liệu Roster`);
  }, [updateAppData]);

  const handleEmployeeDeleteRows = useCallback((rowsToDelete: any[]) => {
    const empCodesToDelete = new Set(
      rowsToDelete.map((r) => String(r.employeeId || r.ma_nv || r.ma_nv_calculated || r["ID Number"] || "").trim().toLowerCase())
    );
    updateAppData((prev) => {
      const prevOverrides = { ...(prev.Timesheet_EmployeeOverrides || {}) };
      empCodesToDelete.forEach((code) => {
        delete prevOverrides[code];
      });
      return {
        ...prev,
        Timesheet_EmployeeOverrides: prevOverrides,
        Timesheet_Roster: (prev.Timesheet_Roster || []).filter((r: any) => {
          const empCode = String(r.ma_nv || r.employeeId || "").trim().toLowerCase();
          return !empCodesToDelete.has(empCode);
        }),
      };
    }, true, true, ["Timesheet_Roster"]);
    toast.success(`Đã xóa dữ liệu của ${rowsToDelete.length} nhân viên`);
  }, [updateAppData]);

  const handleCenterDeleteRows = useCallback((rowsToDelete: any[]) => {
    const centersToDelete = new Set(
      rowsToDelete.map((r) => String(r.l07 || r.center || "").trim().toLowerCase())
    );
    updateAppData((prev) => {
      const prevOverrides = { ...(prev.Timesheet_CenterOverrides || {}) };
      centersToDelete.forEach((cen) => {
        delete prevOverrides[cen.toUpperCase()];
      });
      return {
        ...prev,
        Timesheet_CenterOverrides: prevOverrides,
        Timesheet_Roster: (prev.Timesheet_Roster || []).filter((r: any) => {
          const center = String(r.l07 || r.center || "").trim().toLowerCase();
          return !centersToDelete.has(center);
        }),
      };
    }, true, true, ["Timesheet_Roster"]);
    toast.success(`Đã xóa dữ liệu của ${rowsToDelete.length} cơ sở`);
  }, [updateAppData]);

  return (
    <>
      <AnimatePresence initial={false}>
        {view === "final" && (
          <motion.div
            key="final"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit={{ y: "100%", opacity: 0 }}
            className="flex-1 flex flex-col min-h-0 relative overflow-hidden bg-transparent w-full p-0"
            style={{ paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px" }}
          >
            {/* Inner Content Area holding Sidebar and Table - Clean 2-Part Modular Grid with Gap */}
            <div 
              className={`timesheet-workspace-grid flex-1 grid min-h-0 relative overflow-hidden ${
                showSidebar ? "timesheet-workspace-grid--with-sidebar grid-cols-[250px_1fr] gap-3" : "grid-cols-1"
              } grid-rows-1 w-full h-full p-0 m-0`}
            >
              {/* PHẦN 1: Left Panel - Timesheet Control Station (Isolated Modular Card) */}
              {showSidebar && (
                <aside 
                  aria-label="Bảng điều khiển Timesheet"
                  className="timesheet-control-panel w-full shrink-0 flex flex-col h-full select-none bg-card border border-border rounded-none p-2.5 overflow-hidden z-20 shadow-2xs"
                >
                  <div className="flex flex-col h-full w-full side-panel overflow-y-auto custom-scrollbar pr-0.5 justify-between gap-2.5">
                    {/* Module 1: Overview & KPI Hero Block */}
                    <div className="flex flex-col gap-1.5 w-full">
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums text-[9px] font-black uppercase tracking-wider text-primary">
                          [01] OVERVIEW
                        </span>
                        <span className="text-[9.5px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/60 truncate max-w-[130px]">
                          {fromDate && toDate 
                            ? format(new Date(`${toDate}T00:00:00`), "MM/yyyy")
                            : "Toàn bộ"}
                        </span>
                      </div>

                      {/* Hero Card: Total Duration Hours */}
                      <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-2.5 flex flex-col gap-1 relative overflow-hidden shadow-2xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-primary" />
                            <span className="text-[8.5px] font-bold uppercase tracking-wider text-muted-foreground">Tổng giờ công</span>
                          </div>
                          <span className="text-[8px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md uppercase">
                            Hợp lệ
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5 pt-0.5">
                          <span className="text-2xl font-black tabular-nums tracking-tight text-foreground leading-none">
                            {rosterMetrics.totalDuration.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </span>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">HRS</span>
                        </div>
                      </div>

                      {/* 2 Sub-metric Cards */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-card border border-border/80 rounded-xl p-2 flex flex-col gap-0.5 shadow-2xs">
                          <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Tổng dòng</span>
                          <span className="text-xs font-black tabular-nums text-foreground leading-tight">
                            {currentData.length.toLocaleString('vi-VN')}
                          </span>
                        </div>
                        <div className="bg-card border border-border/80 rounded-xl p-2 flex flex-col gap-0.5 shadow-2xs">
                          <span className="text-[8px] font-bold uppercase tracking-wider text-rose-500">Chưa chi (KL)</span>
                          <span className="text-xs font-black tabular-nums text-rose-600 dark:text-rose-400 leading-tight">
                            {rosterMetrics.unpaidRows.toLocaleString('vi-VN')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Module 2: Filters & Search Card */}
                    <div className="bg-card border border-border/80 rounded-xl p-2.5 flex flex-col gap-2 shadow-2xs w-full">
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
                          [02] BỘ LỌC DỮ LIỆU
                        </span>
                        {(fromDate || toDate || searchTerm || activeAuditFilterEntries.length > 0) && (
                          <button
                            type="button"
                            onClick={() => {
                              handleResetDateFilter();
                              if (searchTerm) {
                                startTransition(() => {
                                  setSearchTerm("");
                                  setDebouncedSearchTerm("");
                                });
                              }
                            }}
                            className="text-[9px] font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1 cursor-pointer transition-colors px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 shadow-2xs active:scale-[0.98]"
                            title="Hủy toàn bộ lọc"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>Reset</span>
                          </button>
                        )}
                      </div>

                      {/* Month Quick Select */}
                      <div className="flex flex-col gap-1">
                        <Popover open={isMonthOpen} onOpenChange={setIsMonthOpen}>
                          <PopoverTrigger asChild>
                            <button className="h-8 bg-card hover:bg-muted/50 rounded-lg px-2.5 border border-border focus:outline-none transition-all w-full flex items-center justify-between cursor-pointer select-none text-xs font-bold text-foreground shadow-2xs">
                              <span className="truncate">
                                {fromDate && toDate 
                                  ? `Chu kỳ ${format(new Date(`${toDate}T00:00:00`), "MM/yyyy")}`
                                  : "Chọn tháng chu kỳ"}
                              </span>
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[270px] bg-card border border-border shadow-xl rounded-xl p-2 z-[99999]" align="start">
                            <div className="grid grid-cols-3 gap-1 p-1">
                              {Array.from({ length: 12 }, (_, i) => {
                                const month = i + 1;
                                const currentYear = uiSettings.defaultAuditYear || new Date().getFullYear();
                                return (
                                  <button
                                    key={month}
                                    onClick={() => {
                                      const year = currentYear;
                                      const prevMonth = month === 1 ? 12 : month - 1;
                                      const prevYear = month === 1 ? year - 1 : year;
                                      
                                      const start = `${prevYear}-${String(prevMonth).padStart(2, '0')}-21`;
                                      const end = `${year}-${String(month).padStart(2, '0')}-20`;
                                      
                                      startTransition(() => {
                                        setFromDate(start);
                                        setToDate(end);
                                        setTargetDate("");
                                        setTargetCenter("");
                                      });
                                      setIsMonthOpen(false);
                                    }}
                                    className="py-2 text-xs font-bold rounded-lg hover:bg-muted text-foreground transition-colors cursor-pointer text-center"
                                  >
                                    Th{month}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Date Range: 2 columns side by side */}
                      <div className="grid grid-cols-2 gap-1.5 w-full">
                        <EditableDateSelector
                          label="TỪ NGÀY"
                          value={fromDate}
                          onChange={(newDate) => {
                            startTransition(() => {
                              setFromDate(newDate);
                              setTargetDate("");
                              setTargetCenter("");
                            });
                          }}
                          placeholder="Chọn ngày"
                        />
                        <EditableDateSelector
                          label="ĐẾN NGÀY"
                          value={toDate}
                          onChange={(newDate) => {
                            startTransition(() => {
                              setToDate(newDate);
                              setTargetDate("");
                              setTargetCenter("");
                            });
                          }}
                          placeholder="Chọn ngày"
                        />
                      </div>

                      {/* Search Keyword */}
                      <div className="relative">
                        <DebouncedSearchInput
                          placeholder="Tìm mã NV, tên..."
                          value={searchTerm}
                          onChange={(val) => {
                            startTransition(() => {
                              setSearchTerm(val);
                              setDebouncedSearchTerm(val);
                            });
                          }}
                          className="h-8 bg-card rounded-lg pl-7 pr-3 border border-border hover:border-primary/50 focus:border-primary focus:outline-none transition-all w-full text-xs font-medium text-foreground shadow-2xs"
                        />
                        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      {activeAuditFilterEntries.length > 0 && (
                        <div className="flex flex-col gap-1 rounded-lg border border-primary/15 bg-primary/[0.04] p-1.5 shadow-2xs max-h-16 overflow-y-auto">
                          <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                            ACTIVE FILTERS ({activeAuditFilterEntries.length})
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {activeAuditFilterEntries.map((entry) => (
                              <span
                                key={`${entry.key}-${entry.value}`}
                                className="inline-flex min-w-0 items-center gap-1 rounded-md border border-primary/15 bg-card px-1.5 py-0.5 text-[8.5px] font-bold text-foreground"
                                title={`${entry.label}: ${entry.value}`}
                              >
                                <span className="shrink-0 text-primary/70">{entry.label}:</span>
                                <span className="max-w-[120px] truncate">{entry.value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Module 3: Cloud Sync & Status Card */}
                    <div className="bg-card border border-border/80 rounded-xl p-2.5 flex flex-col gap-2 shadow-2xs w-full">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Cloud className="w-3.5 h-3.5 text-primary" />
                          <span className="tabular-nums text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
                            [03] ĐỒNG BỘ CLOUD
                          </span>
                        </div>
                        <span className={`text-[8.5px] font-bold px-2 py-0.5 rounded-full border ${
                          appData?.lastSupabaseSyncAt 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
                        }`}>
                          {appData?.lastSupabaseSyncAt ? "Đã đồng bộ" : "Chưa lưu"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[9.5px] text-muted-foreground bg-muted/40 rounded-lg px-2 py-1 border border-border/60">
                        <span className="text-[8.5px] uppercase tracking-wider font-semibold">Lần cuối:</span>
                        <span className="font-bold tabular-nums text-foreground">
                          {appData?.lastSupabaseSyncAt 
                            ? format(new Date(appData.lastSupabaseSyncAt), "dd.MM.yy HH:mm")
                            : "Chưa đồng bộ"}
                        </span>
                      </div>

                      {/* Quick Sync & Reload Actions */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={handleSyncToSupabase}
                          className="h-7.5 px-2 rounded-lg border border-border bg-muted/40 hover:bg-muted text-foreground font-bold text-[10px] flex items-center justify-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
                          title="Đồng bộ dữ liệu lên Supabase"
                        >
                          <Check className="w-3 h-3 shrink-0 text-emerald-600" />
                          <span>{isSyncing ? "Đang lưu..." : "Sync Cloud"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => restoreTable(["Timesheet_Roster"])}
                          className="h-7.5 px-2 rounded-lg border border-border bg-muted/40 hover:bg-muted text-foreground font-bold text-[10px] flex items-center justify-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-[0.98]"
                          title="Reset to default — Khôi phục Timesheet_Roster về dữ liệu mặc định chưa chỉnh sửa"
                          aria-label="Reset to default"
                        >
                          <RefreshCw className="w-3 h-3 shrink-0 text-primary" />
                          <span>Reset</span>
                        </button>
                      </div>
                    </div>

                    {/* Module 4: Bottom Action Buttons */}
                    <div className="actions w-full shrink-0 flex flex-col gap-2 pt-1 border-t border-border/70">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="btn-secondary w-full h-8.5 flex items-center justify-center gap-2 rounded-lg border border-border bg-card hover:bg-muted font-bold text-xs uppercase tracking-wider text-foreground transition-all active:scale-[0.98]"
                            title="Cài đặt & Tiện ích"
                          >
                            <Settings className="w-3.5 h-3.5 text-primary hover:rotate-45 transition-transform duration-300 shrink-0" />
                            <span>Settings</span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 p-1.5 bg-card border border-border shadow-2xl rounded-2xl z-[99999]">
                          <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-3 py-1.5">
                            CÀI ĐẶT & THAO TÁC
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-border/60" />

                          <DropdownMenuItem
                            onClick={() => window.dispatchEvent(new Event("open-ui-settings"))}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer text-foreground hover:bg-muted"
                          >
                            <Settings className="w-3.5 h-3.5 text-primary" />
                            <span>Cài đặt Giao diện</span>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator className="bg-border/60" />

                          {/* Sync & Save */}
                          <DropdownMenuItem
                            disabled={isSyncing}
                            onClick={handleSyncToSupabase}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer text-foreground hover:bg-muted disabled:opacity-40"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{isSyncing ? "Đang đồng bộ..." : "Sync & Save"}</span>
                          </DropdownMenuItem>

                          {/* Reload */}
                          <DropdownMenuItem
                            onClick={() => restoreTable(["Timesheet_Roster"])}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer text-foreground hover:bg-muted"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-primary" />
                            <span>Reset to default</span>
                          </DropdownMenuItem>

                          {/* Export Excel */}
                          <DropdownMenuItem
                            onClick={() => chooseExcelExport(handleExportExcel, handleExportAllExcel)}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer text-foreground hover:bg-muted"
                          >
                            <Download className="w-3.5 h-3.5 text-blue-600" />
                            <span>Xuất Excel</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button 
                        className="btn-primary w-full h-8.5 flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs uppercase tracking-wider transition-all shadow-xs active:scale-[0.98]"
                        onClick={() => setView("upload")}
                        title="Setting Timesheet"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                        <span>Setting Timesheet</span>
                      </button>
                    </div>
                  </div>
                </aside>
              )}

              {/* PHẦN 2: Right Panel - Timesheet Data Viewport (Padding = 0, Completely Isolated) */}
              <section 
                aria-label="Khung hiển thị Bảng Timesheet"
                className="timesheet-data-panel flex-1 flex flex-col min-h-0 min-w-0 h-full overflow-hidden relative p-0 m-0"
              >
                <div 
                  className="unified-table-frame table-container flex-1 flex flex-col min-h-0 relative bg-card overflow-hidden p-0 m-0" 
                  style={{ 
                    borderRadius: "var(--table-radius, 12px)", 
                    borderWidth: "1px", 
                    borderColor: "var(--table-frame-border, var(--border))",
                    padding: 0
                  }}
                >
                {isAuditNavigation && (
                  <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between z-[150] shrink-0">
                    <div className="flex items-center gap-2 text-rose-800 text-xs font-bold">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      <span>Viewing source data from Audit Discrepancy Details</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate("/audit", { state: { activeTab: "detail" } })}
                        className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Audit Discrepancy Details</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissAuditFilters}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-300 bg-white text-rose-700 shadow-sm transition-all hover:bg-rose-100 active:scale-95"
                        title="Hủy lọc Audit và tiếp tục xem Raw Data"
                        aria-label="Hủy lọc Audit và tiếp tục xem Raw Data"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {isSyncing && (
                  <div className="absolute top-0 right-0 p-4 z-[100]">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-foreground rounded-full border border-none shadow-sm animate-pulse">
                      <RefreshCw className="w-3 h-3 text-primary animate-spin" />
                      <span className="text-[9px] font-black text-foreground uppercase tracking-wider">{syncProgress}% Synced</span>
                    </div>
                  </div>
                )}
                {activeTab === "type_rates" ? (
                  <TypeRatesTable
                    showSidebar={showSidebar}
                    onToggleSidebar={handleToggleSidebar}
                  />
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                      {/* Search Result Feedback when empty */}
                      {searchTerm && searchData.length === 0 && (
                        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-card/85 backdrop-blur-sm animate-in fade-in duration-300 rounded-[32px] overflow-hidden">
                          <div className="bg-card p-8 rounded-2xl border border-border shadow-xl flex flex-col items-center text-center max-w-sm">
                            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mb-4 border border-accent/20 text-accent shadow-inner">
                              <XCircle className="w-8 h-8" />
                            </div>
                            <h3 
                              className="text-xl font-bold text-foreground tracking-tight mb-2"
                              style={{ fontSize: '14px' }}
                            >
                              Không tìm thấy kết quả
                            </h3>
                            <p className="text-[11px] font-medium text-foreground/70 leading-relaxed mb-6 font-sans">
                              Không tìm thấy bản ghi nào khớp với từ khóa "{searchTerm}" trong khoảng thời gian này.
                            </p>
                            <button
                              onClick={handleClearFilters}
                              className="py-2.5 px-6 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider rounded-full hover:bg-primary/90 transition-all cursor-pointer font-sans"
                            >
                              Xóa lọc
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Sync/Load Indicator */}
                      {(isCalculating && activeTab !== "roster_raw") || isPending ? (
                        <div className="flex-1 flex flex-col items-center justify-center bg-card/60 relative z-10 p-12">
                          <div className="relative">
                            <div className="w-12 h-12 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
                          </div>
                          <p className="mt-6 text-[10px] font-black uppercase tracking-[0.25em] text-accent/80 animate-pulse font-sans">
                            {isPending
                              ? "Đang chuyển bảng..."
                              : `Đang xử lý ${appData.Timesheet_Roster?.length || 0} dòng dữ liệu...`}
                          </p>
                        </div>
                      ) : activeTab === "mkt_local_north" ? (
                        <MktLocalNorthPivotTable
                          centerCoverage={centerCoverage}
                          rows={mktPivotRows}
                          types={mktPivotUniqueTypes}
                          grandTotals={mktPivotGrandTotals}
                          onCellChange={handleMktPivotCellChange}
                          showSidebar={showSidebar}
                          onToggleSidebar={handleToggleSidebar}
                        />
                      ) : activeTab === "roster_raw" ? (
                        <RosterRawTable
                          centerCoverage={centerCoverage}
                          tableRef={tableRef}
                          data={deferredRawData}
                          employeeSummary={employeeSummary}
                          employeeTotalHours={employeeTotalHours}
                          onCellChange={handleRosterCellChange}
                          onDeleteRows={handleRosterDeleteRows}
                          showSidebar={showSidebar}
                          onToggleSidebar={handleToggleSidebar}
                        />
                      ) : activeTab === "employee" ? (
                        <EmployeeTable
                          centerCoverage={centerCoverage}
                          tableRef={tableRef}
                          data={searchData}
                          calculatedRosterData={calculatedRosterData}
                          onCellChange={handleEmployeeCellChange}
                          onDeleteRows={handleEmployeeDeleteRows}
                          showSidebar={showSidebar}
                          onToggleSidebar={handleToggleSidebar}
                        />
                      ) : activeTab === "center" ? (
                        <CenterTable
                          centerCoverage={centerCoverage}
                          tableRef={tableRef}
                          data={searchData}
                          mktLocalNorthData={mktLocalNorthData}
                          onCellChange={handleCenterCellChange}
                          onDeleteRows={handleCenterDeleteRows}
                          showSidebar={showSidebar}
                          onToggleSidebar={handleToggleSidebar}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        )}
        {view === "upload" && (
          <motion.div
            key="upload"
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 flex flex-col w-full p-3.5"
            style={{
              paddingLeft: "14px",
              paddingRight: "14px",
              paddingTop: "12px",
              paddingBottom: "12px",
            }}
          >
            <TimesheetSummaryPage onBack={() => setView("final")} />
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={showSqlDialog} onOpenChange={setShowSqlDialog}>
        <DialogContent className="max-w-2xl bg-card rounded-3xl border-none shadow-2xl p-0 overflow-hidden">
          <div className="bg-primary p-8 text-primary-foreground">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black uppercase tracking-wider">Thiết lập & Cập nhật Supabase</DialogTitle>
              <DialogDescription className="text-primary-foreground/80 font-medium text-[11px] leading-relaxed">
                {syncSchemaError || 'Cấu trúc dữ liệu Supabase cần cập nhật.'} Chạy script trong đúng dự án Supabase, sau đó thử Sync & Save lại.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-8">
            <div className="relative group">
              <pre className="bg-foreground text-secondary p-6 rounded-2xl text-[10px] tabular-nums leading-relaxed overflow-x-auto max-h-[300px] border border-primary/20 shadow-inner custom-scrollbar">
                {SQL_SETUP_SCRIPT}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-4 right-4 bg-card/10 hover:bg-card/20 border-white/20 text-primary-foreground gap-2 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all"
                onClick={() => {
                  navigator.clipboard.writeText(SQL_SETUP_SCRIPT);
                  toast.success("Đã copy script SQL!");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                SAO CHÉP
              </Button>
            </div>
            <div className="mt-6 space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-foreground/50">Các bước thực hiện:</h4>
              <ol className="text-[11px] font-bold text-foreground/80 space-y-2 list-decimal pl-4">
                <li>Truy cập vào Dashboard Supabase của bạn.</li>
                <li>Chọn dự án và vào phần <span className="text-primary">SQL Editor</span>.</li>
                <li>Bấm <span className="text-primary">New Query</span> và dán nội dung script trên vào.</li>
                <li>Bấm <span className="text-primary">Run</span> để tạo bảng và cấu hình quyền truy cập (RLS).</li>
                <li>Quay lại đây và thử Đồng bộ lại.</li>
              </ol>
            </div>
          </div>
          <DialogFooter className="p-6 bg-secondary border-t border-border/50">
            <Button 
              onClick={() => setShowSqlDialog(false)}
              className="bg-primary hover:opacity-90 text-primary-foreground rounded-xl px-8 font-black uppercase tracking-widest text-[10px]"
            >
              Tôi đã hiểu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
