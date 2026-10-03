import { useTableCellEditor } from "../hooks/useTableCellEditor";
import { OPERATION_KEY_SHORTCUTS } from "../constants/operation-shortcuts";
import { registerTableExport, downloadTableExcel } from "../lib/utils/table-excel";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, @typescript-eslint/no-unused-vars, react-hooks/incompatible-library */
import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Filter,
  Search,
  Download,
  CheckSquare, CheckCircle2,
  Square,
  Copy,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Table2,
  Wrench,
  Eraser,
  Type,
  Trash2,
  RefreshCw,
  Maximize2,
  X,
  Calendar,
  Play,
  Minus,
  FileText,
  Eye,
  EyeOff,
  Settings2,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "sonner";
import {
  parseMoneyToNumber,
  formatNumber,
  formatIdNumber,
  isChargeAmountColumn,
  isNonSummableTextColumn,
  isDateColumn,
  normalizeDateFilterValue,
  parseAnyDate,
} from "../lib/utils/data-utils";
import { formatVNRobust } from "../lib/utils/format-utils";
import { ColumnFormatDialog } from "./ColumnFormatDialog";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { SaveStatusCard } from "./shared/SaveStatusCard";
import { CustomSortDialog } from "./CustomSortDialog";
import { normalizeSortRules, type SortRule } from "./sort-utils";

const AUTO_FIT_SAMPLE_LIMIT = 320;
const COLUMN_FILTER_SCAN_CHUNK_SIZE = 2_000;
const COLUMN_FILTER_RENDER_LIMIT = 250;
const COLUMN_FILTER_SORT_LIMIT = 5_000;
const EMPTY_HIDDEN_COLUMNS: string[] = [];

function useRowEventHandlers(handlers: {
  startEditing: (...args: any[]) => void;
  handleCellMouseDown: (...args: any[]) => void;
  handleCellMouseEnter: (...args: any[]) => void;
  handleContextMenu: (...args: any[]) => void;
  handleEditorKeyDown: (...args: any[]) => void;
}) {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  return useMemo(() => ({
    startEditing: (...args: any[]) => latest.current.startEditing(...args),
    handleCellMouseDown: (...args: any[]) => latest.current.handleCellMouseDown(...args),
    handleCellMouseEnter: (...args: any[]) => latest.current.handleCellMouseEnter(...args),
    handleContextMenu: (...args: any[]) => latest.current.handleContextMenu(...args),
    handleEditorKeyDown: (...args: any[]) => latest.current.handleEditorKeyDown(...args),
  }), []);
}

export function isBuColumnKeyOrLabel(key?: string, label?: string): boolean {
  const k = String(key || "").trim().toLowerCase();
  const l = String(label || "").trim().toLowerCase();
  if (k === "bu" || k === "business" || k === "business_unit" || k === "bus" || k === "buses") return true;
  if (l === "bu" || l === "business" || l === "business unit" || l === "bus" || l === "buses") return true;
  if (/^bu\b/i.test(l) || /\bbu$/i.test(l)) return true;
  if (k === "chi_nhanh" || l.includes("chi nhánh")) return true;
  return false;
}

export function isAhpBuValue(val: unknown): boolean {
  if (val == null) return false;
  const str = String(val).trim().toUpperCase();
  return (
    str === "AHP" ||
    str === "AHN_HP" ||
    str.startsWith("AHP-") ||
    str.startsWith("AHP_") ||
    str.includes("HAI PHONG") ||
    str.includes("HAIPHONG")
  );
}

function getAutoFitSample<T>(rows: T[]): T[] {
  if (rows.length <= AUTO_FIT_SAMPLE_LIMIT) return rows;

  const sampled: T[] = [];
  const lastIndex = rows.length - 1;
  for (let index = 0; index < AUTO_FIT_SAMPLE_LIMIT; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (AUTO_FIT_SAMPLE_LIMIT - 1));
    sampled.push(rows[sourceIndex]);
  }
  return sampled;
}

export interface Column {
  key: string;
  label: string;
  group?: string;
  type?: "text" | "number" | "date" | "currency" | "money" | "label";
  sortable?: boolean;
  filterable?: boolean;
  hidden?: boolean;
  width?: number | string;
  groupHeaderClassName?: string;
  headerClassName?: string;
  headerSpanClassName?: string;
  cellClassName?: string;
  footerClassName?: string;
  render?: (value: any, row: any) => React.ReactNode;
  align?: "left" | "center" | "right";
  readOnly?: boolean;
  showGrandTotal?: boolean;
}


const isOperationColumn = (column?: Column): boolean => {
  if (!column) return false;
  const normalized = `${column.key} ${column.label}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "d")
    .toUpperCase();
  return normalized.includes("NGHIEP VU");
};

const isIdColumnKey = (k: string): boolean => {
  if (!k) return false;
  const lower = String(k).trim().toLowerCase();
  if (lower === "id" || lower === "_id" || lower === "uuid" || lower === "rowid" || lower === "recordid") return false;
  return (
    lower === "document id" ||
    lower === "id issuance date" ||
    lower === "id issuance" ||
    lower === "id number" ||
    lower === "id_number" ||
    lower === "employeeid" ||
    lower.includes("employeeid") ||
    lower === "employee_id" ||
    lower.includes("employee_id") ||
    lower === "employee id" ||
    lower.includes("employee id") ||
    lower === "ma_nv" ||
    lower === "manv" ||
    lower === "fullname" ||
    lower.includes("fullname") ||
    lower === "full_name" ||
    lower.includes("full_name") ||
    lower === "full name" ||
    lower.includes("full name") ||
    lower === "name" ||
    lower === "họ tên" ||
    lower === "họ và tên" ||
    lower === "tên nhân viên" ||
    lower === "place of issue" ||
    lower.includes("document id") ||
    lower.includes("id issuance") ||
    lower.includes("id number") ||
    lower.includes("place of issue") ||
    lower.includes("national id") ||
    lower.includes("citizen id") ||
    lower.includes("cmnd") ||
    lower.includes("cccd") ||
    lower.includes("mã id") ||
    lower.startsWith("id_") ||
    lower.startsWith("id ") ||
    lower.endsWith("_id") ||
    lower.endsWith(" id")
  );
};

const isInternalHelperCol = (k: string): boolean => {
  if (!k) return false;
  const upper = String(k).trim().toUpperCase();
  if (upper === "L07") return false;
  if (upper === "ID" || upper === "_ID" || upper === "UUID" || upper === "_ROWID" || upper === "_RECORDID" || upper === "ROWID" || upper === "RECORDID") return true;
  return k.startsWith("_");
};

const isNoCol = (k: string): boolean => {
  if (!k) return false;
  const upper = String(k).trim().toUpperCase();
  return (
    upper === "NO." ||
    upper === "NO" ||
    upper === "STT" ||
    upper === "SỐ THỨ TỰ" ||
    upper === "PAYMENT SERIAL NUMBER"
  );
};

const isProtectedNumericColumn = (key: string): boolean => {
  if (
    isIdColumnKey(key) ||
    isNoCol(key) ||
    isNonSummableTextColumn(key)
  ) {
    return true;
  }
  const upper = String(key || "").trim().toUpperCase();
  return (
    upper.includes("ACCOUNT") ||
    upper.includes("STK") ||
    upper.includes("TAX") ||
    upper.includes("PHONE") ||
    upper.includes("MOBILE") ||
    upper.includes("CODE") ||
    upper.includes("MÃ ") ||
    upper.startsWith("MÃ") ||
    upper.includes("CENTER") ||
    upper.includes("L07")
  );
};

const roundToTwoDecimals = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const formatClipboardNumber = (value: number): string =>
  String(roundToTwoDecimals(value));

const looksLikeNumericValue = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint") return true;
  const text = String(value ?? "").trim();
  if (!text || !/\d/.test(text)) return false;
  return /^\(?[+-]?\s*(?:(?:VND|VNĐ|Đ|DONG|₫)\s*)?\d[\d\s.,]*(?:\s*(?:VND|VNĐ|Đ|DONG|₫))?\)?$/i.test(
    text,
  );
};

const GITHUB_LABELS: Record<string, { color: string; textColor: string }> = {
  bug: { color: "#d73a4a", textColor: "#ffffff" },
  documentation: { color: "#0075ca", textColor: "#ffffff" },
  duplicate: { color: "#cfd3d7", textColor: "#1f2328" },
  enhancement: { color: "#a2eeef", textColor: "#1f2328" },
  "good first issue": { color: "#7057ff", textColor: "#ffffff" },
  "help wanted": { color: "#008672", textColor: "#ffffff" },
  invalid: { color: "#e4e669", textColor: "#1f2328" },
  question: { color: "#d876e3", textColor: "#ffffff" },
  wontfix: { color: "#ffffff", textColor: "#1f2328" },
};

export interface BulkAction {
  label: string;
  icon?: React.ReactNode;
  onClick: (selectedRows: any[]) => void;
  variant?: "default" | "destructive";
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  title?: string;
  onExport?: () => void;
  showFilters?: boolean;
  selectable?: boolean;
  showRowNumber?: boolean;
  onSelectionChange?: (selectedRows: any[]) => void;
  onCellChange?: (row: any, colKey: string, value: any) => void;
  onDeleteRow?: (row: any, rowIndex: number) => void;
  onDeleteRows?: (rows: any[]) => void;
  onAddRow?: (idx?: number) => void;
  onDeleteSelection?: (range: {
    startR: number;
    endR: number;
    startC: number;
    endC: number;
  }) => void;
  bulkActions?: BulkAction[];
  isEditable?: boolean;
  externalSearchTerm?: string;
  onExternalSearchChange?: (value: string) => void;
  onRowClick?: (row: any) => void;
  storageKey?: string;
  hideSearch?: boolean;
  hideToolbar?: boolean;
  showFooter?: boolean;
  showPagination?: boolean;
  headerClassName?: string;
  footerClassName?: string;
  totalCalculationOverride?: (row: any, colKey: string) => number | null;
  className?: string;
  striped?: boolean;
  resizableColumns?: boolean;
  rowHeight?: number;
  style?: React.CSSProperties;
  onFilteredDataChange?: (data: any[]) => void;
  onColumnFiltersChange?: (hasFilters: boolean) => void;
  autoHideZeroSumColumns?: boolean;
  stickyHeader?: boolean;
  borderless?: boolean;
  stickyFirstColumn?: boolean;
  scrollContainerStyle?: React.CSSProperties;
  tableStyle?: React.CSSProperties;
  ignoreSavedHiddenColumns?: boolean;
  ignoreSavedPagination?: boolean;
  onResetFilters?: () => void;
  hideColumnVisibilityToggle?: boolean;
  defaultItemsPerPage?: number | typeof Infinity;
  /** When true, suppresses the built-in BU quick filter bar above the table header. */
  hideBuFilter?: boolean;
  alwaysHiddenColumns?: string[];
  /** Optional compact action rendered beside the table save status. */
  footerActionContent?: React.ReactNode;
  /** Replaces the generic saved-time badge in the table footer. */
  footerStatusContent?: React.ReactNode;
  /** When true, hides the SAVED status card in the table footer. */
  hideSaveStatus?: boolean;
}

const ColumnFilter = ({
  column,
  allData,
  filterState,
  onFilterChange,
  onSort,
  sortConfig,
  searchTerm,
  activeIndividualOverlap,
  onClearIndividualOverlap,
}: any) => {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [uniqueValues, setUniqueValues] = useState<any[]>([]);
  const [isLoadingValues, setIsLoadingValues] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const isCurrentDateColumn = isDateColumn(
    column.key,
    column.label,
    column.type,
  );
  const getFilterValue = useCallback(
    (value: any, key = column.key) => {
      const shouldNormalizeDate =
        key === column.key
          ? isCurrentDateColumn
          : isDateColumn(key, key);
      if (shouldNormalizeDate) {
        return normalizeDateFilterValue(value) || "undefined";
      }
      return value == null || value === "" ? "undefined" : String(value);
    },
    [column.key, isCurrentDateColumn],
  );

  // Ignore this column's own selection so checking a value does not trigger a
  // full rescan of a high-cardinality Timesheet column.
  const otherFilterSignature = useMemo(
    () =>
      JSON.stringify(
        Object.entries(filterState)
          .filter(
            ([key, allowedValues]) =>
              key !== column.key && allowedValues instanceof Set,
          )
          .map(([key, allowedValues]) => [
            key,
            Array.from(allowedValues as Set<any>, (value) => String(value)).sort(),
          ])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
      ),
    [filterState, column.key],
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rowIndex = 0;
    const values = new Set<any>();
    const lowerSearch = String(searchTerm || "").trim().toLowerCase();
    const trimmedZeroSearch = lowerSearch.replace(/^0+/, "");
    const otherFilters = Object.entries(filterState).filter(
      ([key, allowedValues]) =>
        key !== column.key && allowedValues instanceof Set,
    ) as Array<[string, Set<any>]>;

    const rowMatchesGlobalSearch = (row: any) => {
      if (!lowerSearch) return true;
      return Object.values(row).some((value) => {
        if (value == null || value === "") return false;
        const normalizedValue = String(value).toLowerCase();
        if (normalizedValue.includes(lowerSearch)) return true;
        if (trimmedZeroSearch && normalizedValue.includes(trimmedZeroSearch)) {
          return true;
        }
        if (!/^[+\d.eE\s]+$/.test(normalizedValue)) return false;
        const formattedId = formatIdNumber(value).toLowerCase();
        return (
          formattedId.includes(lowerSearch) ||
          Boolean(trimmedZeroSearch && formattedId.includes(trimmedZeroSearch))
        );
      });
    };

    const processChunk = () => {
      if (cancelled) return;
      const chunkEnd = Math.min(
        rowIndex + COLUMN_FILTER_SCAN_CHUNK_SIZE,
        allData.length,
      );

      for (; rowIndex < chunkEnd; rowIndex += 1) {
        const row = allData[rowIndex];
        if (!rowMatchesGlobalSearch(row)) continue;
        const matchesOtherFilters = otherFilters.every(
          ([key, allowedValues]) =>
            allowedValues.has(getFilterValue(row[key], key)),
        );
        if (!matchesOtherFilters) continue;
        values.add(getFilterValue(row[column.key]));
      }

      if (rowIndex < allData.length) {
        timer = setTimeout(processChunk, 0);
        return;
      }

      const currentSelection = filterState[column.key];
      if (currentSelection instanceof Set) {
        currentSelection.forEach((value) => values.add(value));
      }

      const nextValues = Array.from(values);
      // Sorting a few values is useful; locale-sorting tens of thousands is a
      // needless main-thread spike because the popover renders a bounded list.
      if (nextValues.length <= COLUMN_FILTER_SORT_LIMIT) {
        nextValues.sort((left: any, right: any) => {
          if (left === "undefined") return -1;
          if (right === "undefined") return 1;
          return String(left).localeCompare(String(right), undefined, {
            numeric: true,
          });
        });
      }

      if (!cancelled) {
        setUniqueValues(nextValues);
        setIsLoadingValues(false);
      }
    };

    timer = setTimeout(() => {
      if (cancelled) return;
      setUniqueValues([]);
      setIsLoadingValues(true);
      processChunk();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    allData,
    column.key,
    getFilterValue,
    isOpen,
    otherFilterSignature,
    searchTerm,
  ]);

  const { filteredValues, hasMoreFilteredValues } = useMemo(() => {
    const normalizedSearch = String(deferredSearch || "").trim().toLowerCase();
    const visibleValues: any[] = [];
    const seen = new Set<any>();
    const currentSelection = filterState[column.key];

    const appendIfVisible = (value: any) => {
      if (seen.has(value)) return false;
      const displayValue = value === "undefined" ? "(Trống)" : String(value);
      if (
        normalizedSearch &&
        !displayValue.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      seen.add(value);
      visibleValues.push(value);
      return visibleValues.length > COLUMN_FILTER_RENDER_LIMIT;
    };

    // Keep active selections visible even when their source position is beyond
    // the first 250 values.
    if (currentSelection instanceof Set) {
      for (const value of currentSelection) {
        if (appendIfVisible(value)) break;
      }
    }
    if (visibleValues.length <= COLUMN_FILTER_RENDER_LIMIT) {
      for (const value of uniqueValues) {
        if (appendIfVisible(value)) break;
      }
    }

    return {
      filteredValues: visibleValues.slice(0, COLUMN_FILTER_RENDER_LIMIT),
      hasMoreFilteredValues:
        visibleValues.length > COLUMN_FILTER_RENDER_LIMIT ||
        (!normalizedSearch && uniqueValues.length > COLUMN_FILTER_RENDER_LIMIT),
    };
  }, [uniqueValues, deferredSearch, filterState, column.key]);

  const currentFilters = filterState[column.key];
  const isAllSelected = !currentFilters;
  const isFiltered = currentFilters instanceof Set;
  const currentSortIndex = Array.isArray(sortConfig)
    ? sortConfig.findIndex((rule: SortRule) => rule.key === column.key)
    : -1;
  const currentSort = currentSortIndex >= 0 ? sortConfig[currentSortIndex] : undefined;

  const handleToggleValue = (val: any, checked: boolean) => {
    let next: Set<any>;
    if (isAllSelected) {
      next = new Set(uniqueValues);
      next.delete(val);
    } else {
      next = new Set(currentFilters);
      if (checked) next.add(val);
      else next.delete(val);
    }

    if (next.size === uniqueValues.length) {
      onFilterChange(column.key, undefined);
    } else {
      onFilterChange(column.key, next);
    }
  };

  const handleSelectOnly = (val: any, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onFilterChange(column.key, new Set([val]));
  };

  const handleToggleAll = (checked: boolean) => {
    if (checked) {
      onFilterChange(column.key, undefined);
    } else {
      onFilterChange(column.key, new Set());
    }
  };

  return (
    <Popover
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setUniqueValues([]);
          setIsLoadingValues(true);
        } else {
          setSearch("");
          setUniqueValues([]);
          setIsLoadingValues(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={`flex items-center justify-center p-0.5 rounded transition-all shrink-0 ${
            isFiltered
              ? "bg-amber-500 text-white font-extrabold ring-2 ring-amber-300 shadow-sm scale-110"
              : "text-foreground/30 opacity-50 hover:opacity-100 hover:text-accent hover:bg-muted/60"
          }`}
          onClick={(e) => {
            e.stopPropagation();
          }}
          title={`Bộ lọc ${column.label || column.key}`}
        >
          <Filter className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 rounded-xl bg-popover dark:bg-[var(--card)] opacity-100 z-[99999] shadow-2xl border-2 border-primary/20 filter-popover-content"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => {
          const originalEvent = e.detail?.originalEvent;
          if (originalEvent) {
            const path = originalEvent.composedPath ? originalEvent.composedPath() : [];
            const clickedInside = path.some((el: any) => 
              el && el.classList && el.classList.contains("filter-popover-content")
            );
            if (clickedInside) {
              e.preventDefault();
            }
          }
        }}
      >
        <div className="flex items-center justify-between p-2 border-b bg-muted/30">
          <span className="text-xs font-black uppercase text-foreground truncate max-w-[130px]">
            Lọc: {column.label || column.key}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeIndividualOverlap && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearIndividualOverlap?.();
                }}
                className="text-[10px] font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-100/80 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 transition-all cursor-pointer shadow-2xs whitespace-nowrap active:scale-95"
                title="Thoát lọc trùng lịch của cá nhân này (giữ nguyên bộ lọc cột)"
              >
                Thoát trùng lịch cá nhân
              </button>
            )}
            {isFiltered && (
              <button
                onClick={() => onFilterChange(column.key, undefined)}
                className="text-[10px] font-bold text-amber-600 hover:underline bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 cursor-pointer"
              >
                Xóa lọc
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col p-1.5 border-b bg-muted/10">
          <button
            className={`flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left font-bold transition-colors ${currentSort?.direction === "asc" ? "bg-accent/10 text-accent font-extrabold" : "text-foreground"}`}
            onClick={() => onSort(column.key, "asc")}
          >
            <span className="flex items-center gap-2">
              <ChevronUp className="w-3.5 h-3.5" /> Sắp xếp A-Z (Tăng dần)
            </span>
            {currentSort?.direction === "asc" && (
              <span className="text-[10px] font-bold text-accent">Ưu tiên {currentSortIndex + 1}</span>
            )}
          </button>
          <button
            className={`flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left font-bold transition-colors ${currentSort?.direction === "desc" ? "bg-accent/10 text-accent font-extrabold" : "text-foreground"}`}
            onClick={() => onSort(column.key, "desc")}
          >
            <span className="flex items-center gap-2">
              <ChevronDown className="w-3.5 h-3.5" /> Sắp xếp Z-A (Giảm dần)
            </span>
            {currentSort?.direction === "desc" && (
              <span className="text-[10px] font-bold text-accent">Ưu tiên {currentSortIndex + 1}</span>
            )}
          </button>
          {currentSort && (
            <button
              className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded text-left font-bold text-rose-600 dark:text-rose-400 transition-colors mt-0.5"
              onClick={() => onSort(column.key, null)}
            >
              <X className="w-3.5 h-3.5 text-rose-500 stroke-[2.5]" /> Xóa sắp xếp cột này
            </button>
          )}
        </div>
        <div className="p-2">
          <Input
            id={`filter-search-${column.key}`}
            name={`filter-search-${column.key}`}
            placeholder="Tìm giá trị..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs mb-2 outline-none border-primary/20 rounded-full px-3"
          />
          <div className="flex flex-col gap-1 max-h-48 overflow-auto custom-scrollbar">
            <div className="flex items-center justify-between px-2 hover:bg-muted/50 rounded py-1 cursor-pointer">
              <div className="flex items-center gap-2 flex-1">
                <Checkbox
                  id={`all-${column.key}`}
                  name={`all-${column.key}`}
                  checked={isAllSelected}
                  onCheckedChange={(c) => handleToggleAll(!!c)}
                />
                <label
                  htmlFor={`all-${column.key}`}
                  className="text-xs font-bold leading-none cursor-pointer flex-1"
                >
                  (Chọn tất cả)
                </label>
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {isLoadingValues
                  ? "(đang tải…)"
                  : `(${isAllSelected ? uniqueValues.length : (currentFilters ? currentFilters.size : uniqueValues.length)}/${uniqueValues.length})`}
              </span>
            </div>
            {isLoadingValues && (
              <div className="flex items-center justify-center gap-2 p-3 text-xs font-medium text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Đang tải giá trị lọc…
              </div>
            )}
            {!isLoadingValues && filteredValues.map((val, i) => (
              <div
                key={`${column.key}-${String(val)}-${i}`}
                className="flex items-center justify-between px-2 hover:bg-muted/50 rounded py-1 cursor-pointer group"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Checkbox
                    id={`val-${column.key}-${i}`}
                    name={`val-${column.key}-${i}`}
                    checked={isAllSelected || currentFilters.has(val)}
                    onCheckedChange={(c) => handleToggleValue(val, !!c)}
                  />
                  <label
                    htmlFor={`val-${column.key}-${i}`}
                    className="text-xs truncate leading-none cursor-pointer flex-1"
                    title={String(val)}
                  >
                    {String(val) === "undefined" ? "(Trống)" : String(val)}
                  </label>
                </div>
                <button
                  onClick={(e) => handleSelectOnly(val, e)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-primary hover:underline font-bold px-1 shrink-0"
                  title="Chỉ chọn giá trị này"
                >
                  Chỉ chọn
                </button>
              </div>
            ))}
            {!isLoadingValues && hasMoreFilteredValues && (
              <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[10px] font-medium leading-snug text-amber-800">
                Chỉ hiển thị {COLUMN_FILTER_RENDER_LIMIT} giá trị để giữ bảng mượt. Nhập từ khóa để thu hẹp kết quả.
              </div>
            )}
            {!isLoadingValues && filteredValues.length === 0 && (
              <div className="text-xs text-center text-muted-foreground p-2">
                Không tìm thấy
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const getBorderClass = (headerClass?: string) => {
  if (!headerClass) return "border-slate-300";
  const parts = headerClass.split(/\s+/);
  const borderClass = parts.find(p => p.startsWith("border-") && !["border-b", "border-r", "border-t", "border-l", "border-none", "border-separate", "border-collapse", "border-0", "border-1", "border-2", "border-4", "border-8"].includes(p));
  return borderClass || "border-slate-300";
};

const DataRow = React.memo(
  ({
    row,
    rIdx,
    selectable,
    showRowNumber,
    selectedRowIds,
    activeCell,
    selectionRange,
    editingCell,
    editValue,
    visibleColumns,
    columnWidths,
    isEditable,
    onCellChange,
    toggleRow,
    startEditing,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleContextMenu,
    handleEditorKeyDown,
    setEditValue,
    commitEdit,
    cancelEdit,
    formatValue,
    getAlignment,
    inputRef,
    rowHeight,
    setRowHeight,
    striped: _striped,
    onRowClick,
    borderClass,
    stickyFirstColumn,
  }: any) => {
    const rowId = row.id || rIdx;
    const isSelected = selectedRowIds.has(rowId);

    // Row resize handle
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        setRowHeight((h: number) => Math.max(30, h + e.movementY));
      };
      const handleMouseUp = () => setIsResizing(false);
      if (isResizing) {
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      }
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }, [isResizing, setRowHeight]);
    const isRowActive = activeCell?.r === rIdx;
    const isRowInRange =
      selectionRange &&
      rIdx >= Math.min(selectionRange.startR, selectionRange.endR) &&
      rIdx <= Math.max(selectionRange.startR, selectionRange.endR);

    return (
      <tr
        onClick={() => onRowClick?.(row)}
        data-overlap-group={row.overlap_group || undefined}
        className={`group ${selectable || onRowClick ? "cursor-pointer" : "cursor-default"} ${row._dimmed ? "data-table-row--dimmed" : ""} ${row._matchingDeduction ? "data-table-row--matching-deduction" : ""} ${row._needsSheetSourceNote ? "data-table-row--needs-source-note" : ""} ${row._isSubtotal ? "data-table-subtotal-row bg-[var(--table-footer-bg,#E9D9DF)] font-black text-primary border-t-2 border-primary/25" : row._isTotalRow ? "bg-primary/[0.06] font-black border-t-2 border-primary/20" : String(row.overlap_check || "").startsWith("Trùng lịch") ? "bg-rose-100/70 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100" : String(row.overlap_check || "").startsWith("Trùng dòng") ? "bg-amber-100/70 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" : isSelected ? "bg-primary/[0.05]" : isRowInRange ? "bg-primary/[0.015]" : "bg-[var(--card,#fff)]"} relative`}
        style={{ height: rowHeight ? `${rowHeight}px` : undefined }}
      >
        {selectable && (
          <td
            onClick={() => toggleRow(rowId)}
            className={`text-accent whitespace-nowrap border-b border-r ${borderClass || "border-[#e7dbdc]"} ${isSelected ? "bg-accent/10" : ""} ${stickyFirstColumn ? "sticky-col-selectable" : ""}`}
            style={{
              padding: "var(--table-padding, 0.4rem 0.6rem)",
              boxShadow: isRowActive ? "inset 3px 0 0 var(--primary, #0284c7)" : undefined,
              ...(stickyFirstColumn ? { left: 0 } : {})
            }}
          >
            <div className="flex items-center justify-center">
              {isSelected ? (
                <div className="w-5 h-5 bg-accent rounded-md flex items-center justify-center border border-accent shadow-sm transition-transform active:scale-95">
                  <CheckSquare className="w-3.5 h-3.5 text-white" />
                </div>
              ) : (
                <div className="w-5 h-5 border-2 border-accent/20 bg-white rounded-md hover:border-accent/50 transition-all" />
              )}
            </div>
          </td>
        )}

        {showRowNumber && (
          <td
            className={`border-b border-r ${borderClass || "border-[#e7dbdc]"} select-none ${stickyFirstColumn ? "sticky-col-row-number" : ""}`}
            style={{
              padding: "var(--table-padding, 0.4rem 0.6rem)",
              textAlign: "center",
              width: "50px",
              minWidth: "50px",
              ...(stickyFirstColumn ? { left: selectable ? 40 : 0 } : {})
            }}
          >
            <div className="font-bold text-foreground/60 text-xs">{row._isSubtotal ? "Σ" : rIdx + 1}</div>
          </td>
        )}
        {visibleColumns.map((col: any, cIdx: number) => {
          const isActive = activeCell?.r === rIdx && activeCell?.c === cIdx;
          const isEditing = editingCell?.r === rIdx && editingCell?.c === cIdx;
          const isColActive = activeCell?.c === cIdx;
          const isInRange =
            selectionRange &&
            rIdx >= Math.min(selectionRange.startR, selectionRange.endR) &&
            rIdx <= Math.max(selectionRange.startR, selectionRange.endR) &&
            cIdx >= Math.min(selectionRange.startC, selectionRange.endC) &&
            cIdx <= Math.max(selectionRange.startC, selectionRange.endC);

          const colWidth = columnWidths[col.key] || col.width || 150;
          const widthStyle = colWidth
            ? typeof colWidth === "number"
              ? `${colWidth}px`
              : colWidth
            : "150px";

          const customSpan = row._rowSpans?.[col.key];
          if (customSpan === 0) return null;

          return (
            <td
              key={col.key}
              rowSpan={customSpan || 1}
              data-r={rIdx}
              data-c={cIdx}
              onMouseDown={(e) => handleCellMouseDown(e, rIdx, cIdx)}
              onMouseEnter={(e) => handleCellMouseEnter(e, rIdx, cIdx)}
              onDoubleClick={() => {
                if (!isEditable || col.readOnly || row._isSubtotal || row._isTotalRow) return;
                startEditing(rIdx, cIdx);
              }}
              onContextMenu={(e) => handleContextMenu(e, rIdx, cIdx)}
              className={`${col.cellClassName?.includes("whitespace-pre-wrap") ? "" : "whitespace-nowrap"} select-none ${getAlignment(col)} relative 
              ${isInRange ? "bg-accent/20 z-10" : ""} 
              ${isActive ? "bg-accent/15 z-10 font-medium" : ""} 
              text-[1em] leading-[1.7] font-normal text-foreground border-b border-r ${borderClass || "border-[var(--grid-line-color,rgba(0,0,0,0.035))]"} ${col.cellClassName || ""}
              ${stickyFirstColumn && cIdx === 0 ? "sticky-col-first-data" : ""}
            `}
              style={{
                padding: "var(--table-padding, 0.4rem 0.6rem)",
                fontFamily: "var(--font-table, var(--font-main))",
                fontSize: "var(--font-size, 13px)",
                width: widthStyle,
                minWidth: widthStyle,
                boxShadow:
                  !selectable && isRowActive && cIdx === 0
                    ? "inset 3px 0 0 var(--primary, #0284c7)"
                    : undefined,
                ...(stickyFirstColumn && cIdx === 0 ? {
                  left: (selectable ? 40 : 0) + (showRowNumber ? 50 : 0)
                } : {})
              }}
            >
              {/* Range Borders */}
              {isInRange && selectionRange && (
                <>
                  {rIdx ===
                    Math.min(selectionRange.startR, selectionRange.endR) && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/30 z-20" />
                  )}
                  {rIdx ===
                    Math.max(selectionRange.startR, selectionRange.endR) && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/30 z-20" />
                  )}
                  {cIdx ===
                    Math.min(selectionRange.startC, selectionRange.endC) && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/30 z-20" />
                  )}
                  {cIdx ===
                    Math.max(selectionRange.startC, selectionRange.endC) && (
                    <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-primary/30 z-20" />
                  )}
                </>
              )}

              {isEditing ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 z-50 p-0 bg-white shadow-2xl ring-2 ring-primary/60 rounded-md overflow-hidden flex items-center"
                >
                  {col.type === "label" ? (
                    <select
                      id={`edit-${col.key}-${row.id}`}
                      name={`edit-${col.key}-${row.id}`}
                      aria-label="Chọn nhãn"
                      ref={inputRef as any}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => handleEditorKeyDown(e, rIdx, cIdx)}
                      className="w-full h-full px-4 py-2 bg-transparent border-none focus:ring-0 text-[0.7rem] font-bold text-foreground uppercase appearance-none cursor-pointer"
                      autoFocus
                    >
                      <option value="">-- NO LABEL --</option>
                      {Object.keys(GITHUB_LABELS).map((label) => (
                        <option key={label} value={label}>
                          {label.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`edit-${col.key}-${row.id}`}
                      name={`edit-${col.key}-${row.id}`}
                      aria-label="Nhập giá trị"
                      ref={inputRef as any}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => handleEditorKeyDown(e, rIdx, cIdx)}
                      className="w-full h-full px-4 py-2 bg-transparent border-none focus:ring-0 text-[0.8rem] font-medium text-foreground tracking-tight"
                      autoFocus
                    />
                  )}
                </motion.div>
              ) : (
                <div
                  className={`flex items-center group/cell ${getAlignment(col) === "text-right" ? "justify-end" : getAlignment(col) === "text-center" ? "justify-center" : "justify-start"}`}
                >
                  <span className={`relative z-0 ${col.cellClassName?.includes("whitespace-pre-wrap") ? "" : "truncate"}`}>
                    {col.render ? col.render(row[col.key], row) : formatValue(row[col.key], col.type, col.key)}
                  </span>
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  },
  (prev, next) => {
    if (prev.borderClass !== next.borderClass) return false;
    if (prev.row !== next.row || prev.isEditable !== next.isEditable) return false;
    if (prev.selectable !== next.selectable || prev.showRowNumber !== next.showRowNumber) return false;
    if (prev.onRowClick !== next.onRowClick || prev.onCellChange !== next.onCellChange) return false;
    if (prev.formatValue !== next.formatValue || prev.getAlignment !== next.getAlignment) return false;
    if (prev.rIdx !== next.rIdx) return false;
    
    // Compare selection status for this specific row instead of Set instance equality
    const prevRowId = prev.row.id ?? prev.rIdx;
    const nextRowId = next.row.id ?? next.rIdx;
    const wasSelected = prev.selectedRowIds.has(prevRowId);
    const isSelected = next.selectedRowIds.has(nextRowId);
    if (wasSelected !== isSelected) return false;

    const wasEditing = prev.editingCell?.r === prev.rIdx;
    const isEditing = next.editingCell?.r === next.rIdx;
    if (wasEditing || isEditing) {
      if (prev.editingCell?.c !== next.editingCell?.c || prev.editingCell?.r !== next.editingCell?.r) return false;
      if (prev.editValue !== next.editValue || prev.commitEdit !== next.commitEdit || prev.cancelEdit !== next.cancelEdit) return false;
    }

    if (prev.columnWidths !== next.columnWidths) return false;
    if (prev.visibleColumns !== next.visibleColumns) return false;
    if (prev.rowHeight !== next.rowHeight) return false;

    const wasRowActive = prev.activeCell?.r === prev.rIdx;
    const isRowActive = next.activeCell?.r === next.rIdx;
    if (wasRowActive || isRowActive) {
      if (prev.activeCell?.c !== next.activeCell?.c || prev.activeCell?.r !== next.activeCell?.r) return false;
    }
    
    const wasInRange = prev.selectionRange && prev.rIdx >= Math.min(prev.selectionRange.startR, prev.selectionRange.endR) && prev.rIdx <= Math.max(prev.selectionRange.startR, prev.selectionRange.endR);
    const isInRange = next.selectionRange && next.rIdx >= Math.min(next.selectionRange.startR, next.selectionRange.endR) && next.rIdx <= Math.max(next.selectionRange.startR, next.selectionRange.endR);
    
    if (wasInRange || isInRange) {
      if (
        prev.selectionRange?.startR !== next.selectionRange?.startR ||
        prev.selectionRange?.endR !== next.selectionRange?.endR ||
        prev.selectionRange?.startC !== next.selectionRange?.startC ||
        prev.selectionRange?.endC !== next.selectionRange?.endC
      ) {
        return false;
      }
    }

    return true;
  },
);

DataRow.displayName = "DataRow";

export interface DataTableRef {
  columns: Column[];
  hiddenColumns: Set<string>;
  toggleColumn: (key: string) => void;
  resetTableConfig: () => void;
  clearAllFilters: () => void;
  getCurrentPageData: () => any[];
  exportExcel: () => void;
}

export const DataTable = React.forwardRef<DataTableRef, DataTableProps>(
  (
    {
      columns,
      data,
      title,
      onExport,
      selectable = false,
      showRowNumber = false,
      onSelectionChange,
      onCellChange,
      onDeleteRow,
      onDeleteRows,
      onAddRow,
      onDeleteSelection,
      bulkActions,
      isEditable = true,
      externalSearchTerm,
      onExternalSearchChange,
      onRowClick,
      storageKey,
      hideSearch = false,
      hideToolbar = false,
      showFooter = true,
      showPagination = true,
      headerClassName,
      footerClassName,
      totalCalculationOverride,
      className,
      striped = false,
      resizableColumns = true,
      style: customStyle,
      onFilteredDataChange,
      onColumnFiltersChange,
      autoHideZeroSumColumns = true,
      stickyHeader = true,
      borderless = false,
      stickyFirstColumn: _requestedStickyFirstColumn = false,
      scrollContainerStyle,
      tableStyle,
      ignoreSavedHiddenColumns = false,
      ignoreSavedPagination = false,
      onResetFilters,
      hideColumnVisibilityToggle = false,
      defaultItemsPerPage,
      hideBuFilter = false,
      alwaysHiddenColumns = EMPTY_HIDDEN_COLUMNS,
      footerActionContent,
      footerStatusContent,
      hideSaveStatus = false,
    },
    ref,
  ) => {
    // Horizontal scrolling is authoritative: no data/select/row-number column
    // is pinned, even if an older saved component still requests it.
    const stickyFirstColumn = false;
    const [deleteConfirmState, setDeleteConfirmState] = useState<{
      isOpen: boolean;
      title: string;
      description: string;
      confirmText?: string;
      onConfirm: () => void;
    } | null>(null);
    const [operationStatus, setOperationStatus] = useState<string | null>(null);
    const statusTimeoutRef = useRef<NodeJS.Timeout>();

    const showStatus = React.useCallback((msg: string) => {
      setOperationStatus(msg);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => {
        setOperationStatus(null);
      }, 2000);
    }, []);

    const [sortConfig, setSortConfig] = useState<SortRule[]>([]);
    const [columnFilters, setColumnFilters] = useState<
      Record<string, Set<any> | undefined>
    >({});
    const [individualOverlap, setIndividualOverlap] = useState<{
      keys: string[];
      ma_nv: string;
      ngay: string;
      full_name?: string;
    } | null>(null);
    const [buFilterMode, setBuFilterMode] = useState<string>("ALL");

    useEffect(() => {
      const handleOverlapEvent = (e: any) => {
        if (e.detail?.ma_nv && e.detail?.ngay) {
          setIndividualOverlap({
            keys: ["ma_nv", "ngay"],
            ma_nv: String(e.detail.ma_nv),
            ngay: String(e.detail.ngay),
            full_name: e.detail.full_name || e.detail.ho_ten || "",
          });
          setCurrentPage(1);
        }
      };
      window.addEventListener("overlap-filter-requested", handleOverlapEvent);
      return () => window.removeEventListener("overlap-filter-requested", handleOverlapEvent);
    }, []);

    useEffect(() => {
      if (individualOverlap) {
        if (!columnFilters["ma_nv"] && !columnFilters["ngay"]) {
          setIndividualOverlap(null);
        }
      }
    }, [columnFilters, individualOverlap]);

    const handleClearIndividualOverlap = useCallback(() => {
      const keysToRemove = individualOverlap?.keys || ["ma_nv", "ngay"];
      setIndividualOverlap(null);
      setColumnFilters((prev) => {
        const next = { ...prev };
        keysToRemove.forEach((k) => delete next[k]);
        return next;
      });
      showStatus("Đã thoát lọc trùng lịch cá nhân, giữ nguyên bộ lọc cột");
    }, [individualOverlap, showStatus]);

    // Detect if this table has a BU or Business column
    const buColumn = useMemo(() => {
      return columns.find((c) => isBuColumnKeyOrLabel(c.key, c.label));
    }, [columns]);

    React.useEffect(() => {
      if (onColumnFiltersChange) {
        const hasActiveFilters = Object.values(columnFilters).some(
          (value) => value instanceof Set,
        ) || buFilterMode !== "ALL";
        onColumnFiltersChange(hasActiveFilters);
      }
    }, [columnFilters, buFilterMode, onColumnFiltersChange]);

    const [internalSearchTerm, setInternalSearchTerm] = useState("");

    const searchTerm =
      externalSearchTerm !== undefined
        ? externalSearchTerm
        : internalSearchTerm;

    const borderClass = borderless ? "border-transparent" : getBorderClass(headerClassName);
    const getBorderColorHex = (headerClass?: string) => {
      if (borderless) return "transparent";
      if (!headerClass) return "var(--grid-line-color, var(--border, #E2E8F0))";
      if (headerClass.includes("border-accent")) return "color-mix(in srgb, var(--accent) 20%, transparent)";
      if (headerClass.includes("border-indigo")) return "rgba(99, 102, 241, 0.2)";
      if (headerClass.includes("border-pink")) return "rgba(244, 63, 94, 0.2)";
      return "var(--grid-line-color, var(--border, #E2E8F0))";
    };
    const borderColorHex = getBorderColorHex(headerClassName);
    const setSearchTerm = onExternalSearchChange || setInternalSearchTerm;
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

    const [inputColumnFilters, setInputColumnFilters] = useState<Record<string, string>>({});
    const [debouncedColumnFilters, setDebouncedColumnFilters] = useState<Record<string, string>>({});

    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedColumnFilters(inputColumnFilters);
      }, 350);
      return () => clearTimeout(handler);
    }, [inputColumnFilters]);

    const [resizingCol, setResizingCol] = useState<{
      key: string;
      startX: number;
      startWidth: number;
      currentX: number;
    } | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const latestResizeXRef = useRef(0);

    const [resizingLineLeft, setResizingLineLeft] = useState<number | null>(
      null,
    );

    useLayoutEffect(() => {
      let raf: number;
      if (resizingCol && scrollContainerRef.current) {
        raf = requestAnimationFrame(() => {
          const el = scrollContainerRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            setResizingLineLeft(
              resizingCol.currentX - rect.left + el.scrollLeft,
            );
          }
        });
      } else {
        setResizingLineLeft(null);
      }
      return () => cancelAnimationFrame(raf);
    }, [resizingCol?.currentX, resizingCol]);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedSearchTerm(searchTerm);
      }, 300);
      return () => clearTimeout(timer);
    }, [searchTerm]);

    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
      const hidden = new Set<string>();
      if (storageKey) {
        try {
          const savedHidden = localStorage.getItem(`dt_hidden_${storageKey}`);
          if (savedHidden) {
            const hidden = new Set<string>(JSON.parse(savedHidden));
            columns.forEach((col) => { if (col.hidden) hidden.add(col.key); });
            return hidden;
          }
        } catch (e) {
          console.error(e);
        }
      }
      columns.forEach((col: any) => {
        if (col.hidden) {
          hidden.add(col.key);
        }
      });
      return hidden;
    });
    // Auto-hidden columns are intentionally kept separate from the user's
    // persisted visibility choices. This lets a zero-total column disappear by
    // default without deleting it from the column menu or keeping it hidden
    // after its data becomes non-zero.
    const [autoHiddenColumns, setAutoHiddenColumns] = useState<Set<string>>(
      () => new Set(),
    );
    const [shownAutoHiddenColumns, setShownAutoHiddenColumns] = useState<Set<string>>(
      () => new Set(),
    );
    const [rowDensity, setRowDensity] = useState<
      "compact" | "normal" | "relaxed"
    >("normal");
    const [columnFormats, setColumnFormats] = useState<
      Record<string, { alignment?: "left" | "center" | "right" }>
    >({});
    const [formatModal, setFormatModal] = useState<{
      isOpen: boolean;
      colKey: string;
    } | null>(null);
    const [customSortOpen, setCustomSortOpen] = useState(false);
    const [selectedRowIds, setSelectedRowIds] = useState<Set<string | number>>(
      new Set(),
    );
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      r: number;
      c: number;
    } | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState<number | typeof Infinity>(defaultItemsPerPage ?? 50);

    // Grid selection & editing
    const [activeCell, setActiveCell] = useState<{
      r: number;
      c: number;
    } | null>(null);
    const activeCellSourceRef = useRef<"mouse" | "keyboard">("keyboard");
    const anchorCellRef = useRef<{ r: number; c: number } | null>(null);
    const lastActiveCellRef = useRef<{ r: number; c: number } | null>(null);
    const setActiveCellWithSource = useCallback((cell: { r: number; c: number } | null, source: "mouse" | "keyboard") => {
      activeCellSourceRef.current = source;
      setActiveCell(cell);
      if (cell && itemsPerPage !== Infinity) {
        const ipp = Number(itemsPerPage);
        const targetPage = Math.floor(cell.r / ipp) + 1;
        setCurrentPage((prev) => {
          if (prev !== targetPage) return targetPage;
          return prev;
        });
      }
    }, [itemsPerPage]);
    const [selectionRange, setSelectionRange] = useState<{
      startR: number;
      endR: number;
      startC: number;
      endC: number;
    } | null>(null);
    const { editingCell, editValue, beginEdit, setEditValue, commitEdit, cancelEdit } =
      useTableCellEditor<any, { r: number; c: number }>(onCellChange);
    const [isSelecting, setIsSelecting] = useState(false);
    
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
      {},
    );
    const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

    const formatValue = useCallback((value: any, type?: string, colKey?: string) => {
      const configuredType = (colKey && columnTypes[colKey]) || type || "text";
      const effectiveType =
        colKey && isNonSummableTextColumn(colKey)
          ? "text"
          : colKey && isChargeAmountColumn(colKey)
            ? "currency"
            : configuredType;

      if (colKey) {
        const kUp = String(colKey).toUpperCase().trim();
        if (
          kUp === "NO." ||
          kUp === "NO" ||
          kUp === "STT" ||
          kUp === "SỐ THỨ TỰ" ||
          kUp === "ORDER"
        ) {
          if (value === undefined || value === null || value === "") return "";
          const num = parseMoneyToNumber(value);
          return isNaN(num) ? String(value) : formatVNRobust(num, 0);
        }

        if (
          kUp === "ID NUMBER" ||
          kUp === "ID_NUMBER" ||
          kUp === "DOCUMENT ID" ||
          kUp === "DOCUMENT_ID" ||
          kUp === "DOCID" ||
          kUp === "DOC_ID" ||
          kUp === "CCCD" ||
          kUp === "CMND" ||
          kUp === "SỐ CCCD INSTRUCTOR" ||
          kUp.includes("ID NUMBER") ||
          kUp.includes("DOCUMENT ID") ||
          kUp.includes("SỐ CCCD")
        ) {
          return formatIdNumber(value);
        }

        if (
          kUp === "CHARGETOCENTERMKT" ||
          kUp === "CHARGE_TO_CENTER_MKT" ||
          kUp === "CHARGE TO CENTER MKT" ||
          kUp.includes("CHARGE TO CENTER") ||
          kUp.includes("CHARGETOCENTER") ||
          kUp === "L07" ||
          kUp === "CENTER"
        ) {
          return value === undefined || value === null ? "" : String(value);
        }

        if (
          kUp === "DURATION" ||
          kUp === "TK_DURATION" ||
          kUp === "WORKINGHOURS" ||
          kUp === "DURATIONHOURS" ||
          kUp === "CHECK_DURATION" ||
          kUp.includes("DURATION") ||
          kUp.includes("HOURS") ||
          kUp.includes("SỐ GIỜ") ||
          kUp === "GIỜ LÀM"
        ) {
          if (value === undefined || value === null || value === "") return "";
          const num = parseMoneyToNumber(value);
          if (isNaN(num)) return String(value);
          return formatVNRobust(num, 2);
        }
      }

      // ── Guard: Date objects cannot be rendered as React children ────────────
      if (value instanceof Date) {
        if (isNaN(value.getTime())) return ""; // Invalid Date
        if (
          effectiveType === "currency" ||
          effectiveType === "money" ||
          effectiveType === "number"
        ) {
          return "";
        }
        if (effectiveType === "date") {
          return value.toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
        return value.toLocaleDateString("vi-VN");
      }

      if (effectiveType === "currency" || effectiveType === "money") {
        const num = parseMoneyToNumber(value);
        return formatVNRobust(num, 0);
      }
      if (effectiveType === "number") {
        const num = parseMoneyToNumber(value);
        if (Number.isInteger(num)) {
          return formatVNRobust(num, 0);
        }
        return formatVNRobust(num, 2);
      }
      if (effectiveType === "date") {
        return formatNumber(value, "date");
      }
      if (effectiveType === "label") {
        const label = String(value || "").toLowerCase();
        const config = GITHUB_LABELS[label];
        if (config) {
          return (
            <span
              className="px-2 py-0.5 rounded-full text-[0.55rem] font-black uppercase tracking-wider shadow-sm border border-black/5"
              style={{ backgroundColor: config.color, color: config.textColor }}
            >
              {label}
            </span>
          );
        }
      }
      if (React.isValidElement(value)) {
        return value;
      }
      // Guard: prevent any remaining plain objects from crashing React render
      if (value !== null && typeof value === "object") {
        return String(value);
      }
      return value == null ? "" : String(value);
    }, [columnTypes]);

    const getAlignment = useCallback((col: Column) => {
      const type = col.type;
      const key = col.key;
      if (col.align) {
        return `text-${col.align}`;
      }
      if (key && columnFormats[key]?.alignment) {
        return `text-${columnFormats[key].alignment}`;
      }
      const k = key?.toLowerCase() || "";
      if (k.includes("salaryscale")) {
        return "text-center";
      }
      if (k === "no" || k === "stt" || k === "id") {
        return "text-center";
      }
      // Specific columns căn trái as requested
      if (k.includes("l07") || k.includes("ae") || k.includes("business")) {
        return "text-left";
      }

      switch (type) {
        case "number":
        case "currency":
        case "money":
          return "text-right";
        case "text":
        default:
          return "text-left";
      }
    }, [columnFormats]);

    // Use standard effect or simple initial state setup instead to avoid rendering cycle
    // Note: since this is just parsing localStorage it can be done once initially instead
    // of in an effect. We will just use an effect and accept that it will trigger a re-render.
    // However, to fix the lint error, we need to disable the exhaustive-deps or just let it happen in useEffect rather than useLayoutEffect
    useEffect(() => {
      if (!storageKey) return;
      // ... rest is same
      const initStates = {
        hiddenColumns: (() => {
          const s = new Set<string>();
          columns.forEach((c: any) => {
            if (c.hidden) s.add(c.key);
          });
          return s;
        })(),
        columnWidths: {} as Record<string, number>,
        columnTypes: {} as Record<string, string>,
        columnFormats: {} as Record<
          string,
          { alignment?: "left" | "center" | "right" }
        >,
        sortConfig: [] as SortRule[],
        rowDensity: "normal" as "compact" | "normal" | "relaxed",
        itemsPerPage: (defaultItemsPerPage ?? 50) as number | typeof Infinity,
      };

      let hasUpdates = false;

      // Hidden columns
      try {
        const savedHidden = localStorage.getItem(`dt_hidden_${storageKey}`);
        if (savedHidden && !ignoreSavedHiddenColumns) {
          initStates.hiddenColumns = new Set(JSON.parse(savedHidden));
          columns.forEach((col) => { if (col.hidden) initStates.hiddenColumns.add(col.key); });
        } else {
          columns.forEach((c: any) => {
            if (c.hidden) {
              initStates.hiddenColumns.add(c.key);
            }
          });
        }
        hasUpdates = true;
      } catch (e) {
        console.error(e);
      }

      // Row density
      try {
        const savedDensity = localStorage.getItem(`dt_density_${storageKey}`);
        if (savedDensity) {
          initStates.rowDensity = savedDensity as
            | "compact"
            | "normal"
            | "relaxed";
          hasUpdates = true;
        }
      } catch (e) {
        console.error(e);
      }

      // Column widths
      try {
        const savedWidths = localStorage.getItem(`dt_widths_${storageKey}`);
        if (savedWidths) {
          initStates.columnWidths = JSON.parse(savedWidths);
          hasUpdates = true;
        }
      } catch (e) {
        console.error(e);
      }

      // Column types
      try {
        const savedTypes = localStorage.getItem(`dt_types_${storageKey}`);
        if (savedTypes) {
          initStates.columnTypes = JSON.parse(savedTypes);
          hasUpdates = true;
        }
      } catch (e) {
        console.error(e);
      }

      // Column formats
      try {
        const savedFormats = localStorage.getItem(`dt_formats_${storageKey}`);
        if (savedFormats) {
          initStates.columnFormats = JSON.parse(savedFormats);
          hasUpdates = true;
        }
      } catch (e) {
        console.error(e);
      }

      // Sort config
      try {
        const savedSort = localStorage.getItem(`dt_sort_${storageKey}`);
        if (savedSort) {
          initStates.sortConfig = normalizeSortRules(JSON.parse(savedSort));
          hasUpdates = true;
        }
      } catch (e) {
        console.error(e);
      }

      // Items per page
      if (!ignoreSavedPagination) {
        try {
          const savedItemsPerPage = localStorage.getItem(`dt_ipp_${storageKey}`);
          if (savedItemsPerPage) {
            const parsed = JSON.parse(savedItemsPerPage);
            if (parsed === "all") {
              initStates.itemsPerPage = Infinity;
            } else if (
              typeof parsed === "number" &&
              !isNaN(parsed) &&
              parsed > 0
            ) {
              initStates.itemsPerPage = parsed;
            }
            hasUpdates = true;
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (hasUpdates) {
        setHiddenColumns(initStates.hiddenColumns);
        setColumnWidths(initStates.columnWidths);
        setColumnTypes(initStates.columnTypes);
        setColumnFormats(initStates.columnFormats);
        setSortConfig(initStates.sortConfig);
        setItemsPerPage(initStates.itemsPerPage);
        setRowDensity(initStates.rowDensity);
      }
    }, [storageKey]);



    // Save hidden columns
    useEffect(() => {
      if (storageKey)
        localStorage.setItem(
          `dt_hidden_${storageKey}`,
          JSON.stringify(Array.from(hiddenColumns)),
        );
    }, [hiddenColumns, storageKey]);

    // Save row density
    useEffect(() => {
      if (storageKey)
        localStorage.setItem(`dt_density_${storageKey}`, rowDensity);
    }, [rowDensity, storageKey]);

    // Save column formats
    useEffect(() => {
      if (storageKey)
        localStorage.setItem(
          `dt_formats_${storageKey}`,
          JSON.stringify(columnFormats),
        );
    }, [columnFormats, storageKey]);

    // Save sort config
    useEffect(() => {
      if (storageKey)
        localStorage.setItem(
          `dt_sort_${storageKey}`,
          JSON.stringify(sortConfig),
        );
    }, [sortConfig, storageKey]);

    // Save items per page
    useEffect(() => {
      if (storageKey)
        localStorage.setItem(
          `dt_ipp_${storageKey}`,
          itemsPerPage === Infinity ? '"all"' : JSON.stringify(itemsPerPage),
        );
    }, [itemsPerPage, storageKey]);

    // Save column widths
    const saveColumnWidths = (widths: Record<string, number>) => {
      if (storageKey)
        localStorage.setItem(`dt_widths_${storageKey}`, JSON.stringify(widths));
    };

    const effectiveHiddenColumns = useMemo(() => {
      const next = new Set(hiddenColumns);
      alwaysHiddenColumns.forEach((key) => next.add(key));
      autoHiddenColumns.forEach((key) => {
        if (!shownAutoHiddenColumns.has(key)) next.add(key);
      });
      return next;
    }, [hiddenColumns, autoHiddenColumns, shownAutoHiddenColumns, alwaysHiddenColumns]);

    const noColKey = useMemo(() => {
      const found = columns.find((c: any) => isNoCol(c.key) || isNoCol(c.label));
      return found ? found.key : "__ROW_NUMBER__";
    }, [columns]);

    const isRowNumberVisible = useMemo(() => {
      return !!showRowNumber && !effectiveHiddenColumns.has(noColKey) && !effectiveHiddenColumns.has("__ROW_NUMBER__");
    }, [showRowNumber, effectiveHiddenColumns, noColKey]);

    const visibleColumns = useMemo(
      () =>
        columns.filter(
          (col) =>
            !isInternalHelperCol(col.key) &&
            !isInternalHelperCol(col.label) &&
            !effectiveHiddenColumns.has(col.key) &&
            !(showRowNumber && (isNoCol(col.key) || isNoCol(col.label)))
        ),
      [columns, effectiveHiddenColumns, showRowNumber],
    );

    const allDropdownColumns = useMemo(() => {
      const base = columns.filter(
        (col) => !isInternalHelperCol(col.key) && !isInternalHelperCol(col.label)
      );
      if (showRowNumber && !base.some((c) => isNoCol(c.key) || isNoCol(c.label))) {
        return [{ key: "__ROW_NUMBER__", label: "No." }, ...base];
      }
      return base;
    }, [columns, showRowNumber]);

    const groupColorMap = useMemo(() => {
      const map = new Map<string, string>();
      const colors = [
        "bg-[#F0F5FA] text-[#1E2C35]", // Breeze Blue
        "bg-[#FDF7EA] text-[#574116]", // Butter Yellow
        "bg-[#FAF2F3] text-[#4A2630]", // Blush Pink
        "bg-[#FBF1EF] text-[#59261D]", // Coral Clay
        "bg-[#F0FAF8] text-[#1D4039]", // Mint Fountain
        "bg-[#F4F6FC] text-[#283144]", // Lavender Dream
        "bg-[#FAF7F7] text-[#3D2A2A]", // Espresso Neutral
      ];
      let colorIdx = 0;
      columns.forEach((c) => {
        if (c.group && !map.has(c.group)) {
          if (c.groupHeaderClassName) {
            map.set(c.group, c.groupHeaderClassName);
            return;
          }
          const groupLower = c.group.toLowerCase();
          if (groupLower.includes("academic")) {
            map.set(c.group, "academic-group");
          } else if (groupLower.includes("admin")) {
            map.set(c.group, "admin-group");
          } else {
            map.set(c.group, colors[colorIdx % colors.length]);
            colorIdx++;
          }
        }
      });
      return map;
    }, [columns]);

    const containsSubtotalRows = useMemo(
      () => data.some((row) => row._subtotalGroup != null),
      [data],
    );

    const filteredAndSortedData = useMemo(() => {
      // Keep the original array until a filter or sort actually needs a new
      // result. This avoids an immediate full-array copy for large Raw Data.
      let result = data;

      // Apply search
      if (debouncedSearchTerm) {
        const lowerSearch = String(debouncedSearchTerm).trim().toLowerCase();
        const trimmedZeroSearch = lowerSearch.replace(/^0+/, "");
        result = result.filter((row) => {
          if (row._isNew === true) return true;
          for (const key in row) {
            if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
            const val = row[key];
            if (val == null || val === "") continue;
            const str = String(val).toLowerCase();
            if (str.includes(lowerSearch)) return true;
            if (trimmedZeroSearch && str.includes(trimmedZeroSearch)) return true;

            const formattedId = formatIdNumber(val).toLowerCase();
            if (formattedId && formattedId.includes(lowerSearch)) return true;
            if (trimmedZeroSearch && formattedId && formattedId.includes(trimmedZeroSearch)) return true;
          }
          return false;
        });
      }

      // Apply filters
      Object.entries(columnFilters).forEach(([key, allowedValues]) => {
        if (allowedValues instanceof Set) {
          const column = columns.find((item) => item.key === key);
          result = result.filter((row) => {
            if (row._isNew === true) return true;
            const rawVal = row[key];
            const normalizedFilterValue = isDateColumn(
              key,
              column?.label,
              columnTypes[key] || column?.type,
            )
              ? normalizeDateFilterValue(rawVal) || "undefined"
              : rawVal;
            if (rawVal == null || rawVal === "") {
              return allowedValues.has("undefined") || allowedValues.has("") || allowedValues.has(null);
            }
            if (allowedValues.has(normalizedFilterValue)) return true;
            const strVal = String(normalizedFilterValue);
            if (allowedValues.has(strVal)) return true;

            for (const allowed of allowedValues) {
              const allowedStr = String(allowed).trim().toLowerCase();
              const targetStr = strVal.trim().toLowerCase();
              if (allowedStr === targetStr) return true;

              if (key === "ngay" || key === "date") {
                const norm1 = allowedStr.replace(/[/]/g, "-");
                const norm2 = targetStr.replace(/[/]/g, "-");
                if (norm1 === norm2 || norm1.includes(norm2) || norm2.includes(norm1)) return true;
              }

              if (key === "ma_nv" || key === "taId") {
                const norm1 = allowedStr.replace(/^0+/, "");
                const norm2 = targetStr.replace(/^0+/, "");
                if (norm1 && norm1 === norm2) return true;
              }
            }
            return false;
          });
        }
      });

      // Apply column text filters
      Object.entries(debouncedColumnFilters).forEach(([key, val]) => {
        if (val) {
          const lowerVal = val.toLowerCase();
          result = result.filter((row) => {
            if (row._isNew === true) return true;
            const cellVal = row[key];
            return cellVal != null && String(cellVal).toLowerCase().includes(lowerVal);
          });
        }
      });

      // Apply BU quick filter
      if (buColumn && buFilterMode !== "ALL") {
        result = result.filter((row) => {
          if (row._isNew === true || row._isTotalRow) return true;
          const rawVal = row[buColumn.key] ?? row._subtotalGroup;
          if (rawVal == null) return false;
          if (buFilterMode === "EXCLUDE_AHP") {
            return !isAhpBuValue(rawVal);
          }
          const strVal = String(rawVal).trim().toUpperCase();
          return strVal === buFilterMode;
        });
      }

      // Apply Excel-style multi-level sorting. Earlier rules always have
      // higher priority; empty values stay at the bottom at every level.
      if (sortConfig.length > 0 || containsSubtotalRows) {
        if (result === data) result = [...result];
        result.sort((a, b) => {
          if (Boolean(a._matchingDeduction) !== Boolean(b._matchingDeduction)) return a._matchingDeduction ? -1 : 1;
          const aNeedsSourceNote = Boolean(a._needsSheetSourceNote);
          const bNeedsSourceNote = Boolean(b._needsSheetSourceNote);
          if (aNeedsSourceNote !== bNeedsSourceNote) {
            return aNeedsSourceNote ? -1 : 1;
          }

          // Roster Center subtotal rows remain attached to their BU while the
          // rows inside each BU still follow all selected sort levels.
          if (a._subtotalGroup != null && b._subtotalGroup != null) {
            const groupDirection = sortConfig.find((rule) => rule.key === "business")?.direction || "asc";
            const groupCompare = String(a._subtotalGroup).localeCompare(
              String(b._subtotalGroup),
              "vi",
              { numeric: true, sensitivity: "base" },
            );
            if (groupCompare !== 0) return groupDirection === "asc" ? groupCompare : -groupCompare;
            if (!!a._isSubtotal !== !!b._isSubtotal) return a._isSubtotal ? 1 : -1;
          }

          for (const rule of sortConfig) {
            const col = columns.find((column) => column.key === rule.key);
            const type = columnTypes[rule.key] || col?.type || "text";
            const aVal = a[rule.key];
            const bVal = b[rule.key];
            const isANull = aVal === null || aVal === undefined || aVal === "";
            const isBNull = bVal === null || bVal === undefined || bVal === "";

            if (isANull && isBNull) continue;
            if (isANull) return 1;
            if (isBNull) return -1;

            let comparison = 0;
            if (type === "number" || type === "currency" || type === "money") {
              comparison = (parseMoneyToNumber(aVal) || 0) - (parseMoneyToNumber(bVal) || 0);
            } else if (type === "date" || isDateColumn(rule.key, col?.label, type)) {
              const aDate = parseAnyDate(aVal);
              const bDate = parseAnyDate(bVal);
              if (aDate && bDate) comparison = aDate.getTime() - bDate.getTime();
            }

            if (comparison === 0) {
              comparison = String(aVal).localeCompare(String(bVal), "vi", {
                numeric: true,
                sensitivity: "base",
              });
            }
            if (comparison !== 0) return rule.direction === "asc" ? comparison : -comparison;
          }
          return 0;
        });
      }

      return result;
    }, [data, sortConfig, columnFilters, debouncedSearchTerm, debouncedColumnFilters, containsSubtotalRows, buColumn, buFilterMode]);

    const activeFilters = useMemo(() => {
      const filters = Object.entries(columnFilters)
        .filter(([_, value]) => value instanceof Set)
        .map(([key]) => {
          const col = columns.find((c) => c.key === key);
          return {
            key,
            label: col ? col.label : key,
          };
        });
      if (buColumn && buFilterMode !== "ALL") {
        filters.push({
          key: buColumn.key,
          label: buFilterMode === "EXCLUDE_AHP" ? "BU: Trừ AHP" : `BU: ${buFilterMode}`,
        });
      }
      return filters;
    }, [columnFilters, columns, buColumn, buFilterMode]);

    const hasActiveFilters = activeFilters.length > 0;

    // Keyboard shortcuts are handled in the main listener below

    const totalPages =
      itemsPerPage === Infinity
        ? 1
        : Math.ceil(filteredAndSortedData.length / Number(itemsPerPage));

    useEffect(() => {
      if (totalPages > 0 && currentPage > totalPages) {
        setCurrentPage(1);
      }
    }, [totalPages, currentPage]);

    const paginatedData = useMemo(() => {
      if (itemsPerPage === Infinity) return filteredAndSortedData;
      const ipp = Number(itemsPerPage);
      const start = (currentPage - 1) * ipp;
      return filteredAndSortedData.slice(start, start + ipp);
    }, [filteredAndSortedData, currentPage, itemsPerPage]);

    const knownDraftIds = useRef<Set<unknown> | null>(null);
    if (knownDraftIds.current === null) knownDraftIds.current = new Set(onAddRow ? data.filter(row => row._isNew).map(row => row.id) : []);
    useEffect(() => {
      if (!onAddRow) return;
      const newIndex = filteredAndSortedData.findIndex(row => row._isNew && row.id && !knownDraftIds.current!.has(row.id));
      knownDraftIds.current = new Set(data.filter(row => row._isNew).map(row => row.id));
      if (newIndex >= 0) {
        setCurrentPage(itemsPerPage === Infinity ? 1 : Math.floor(newIndex / Number(itemsPerPage)) + 1);
        setActiveCell({ r: newIndex, c: 0 });
      }
    }, [data, filteredAndSortedData, itemsPerPage, onAddRow]);

    // ── Custom Virtual Scrolling (no library needed) ──────────────────────────
    const densityHeights = useMemo(() => ({
      compact: 32,
      normal: 52,
      relaxed: 64,
    }), []);

    const [rowHeight, setRowHeight] = useState(52); // px

    useEffect(() => {
      const targetHeight = densityHeights[rowDensity] || 52;
      setRowHeight(targetHeight);
    }, [rowDensity, densityHeights]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [vsContainerWidth, setVsContainerWidth] = useState(1000);

    // Defer heavy table re-render — user interactions stay responsive during data updates
    const deferredPaginatedData = useDeferredValue(paginatedData);

    const footerTotals = useMemo(() => {
      const totals: Record<string, number | null> = {};
      if (!showFooter) return totals;

      const colIsNumericList = columns.map((col) => {
        const effectiveType = columnTypes[col.key] || col.type;
        if (col.showGrandTotal === false) return false;
        if (isProtectedNumericColumn(col.key)) return false;
        if (isNonSummableTextColumn(col.key)) return false;
        let colIsNumeric =
          isChargeAmountColumn(col.key) ||
          effectiveType === "number" ||
          effectiveType === "currency" ||
          effectiveType === "money" ||
          col.showGrandTotal;

        if (
          !colIsNumeric &&
          effectiveType !== "label" &&
          effectiveType !== "date" &&
          filteredAndSortedData.length > 0 &&
          col.key !== "STT" &&
          col.key !== "stt"
        ) {
          let numericCount = 0;
          let totalValCount = 0;
          const sampleSize = Math.min(20, filteredAndSortedData.length);
          for (let i = 0; i < sampleSize; i++) {
            const r = filteredAndSortedData[i];
            if (r) {
              const rawVal = r[col.key];
              if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
                totalValCount++;
                if (looksLikeNumericValue(rawVal)) {
                  numericCount++;
                }
              }
            }
          }
          if (totalValCount > 0 && numericCount / totalValCount > 0.7) {
            colIsNumeric = true;
          }
        }
        return colIsNumeric;
      });

      columns.forEach((col, cIdx) => {
        const colIsNumeric = colIsNumericList[cIdx];
        if (colIsNumeric) {
          totals[col.key] = filteredAndSortedData.reduce((sum, row) => {
            if (row?._isTotalRow || row?._isSubtotal) return sum;
            if (totalCalculationOverride) {
              const override = totalCalculationOverride(row, col.key);
              if (typeof override === "number" && Number.isFinite(override)) {
                return sum + override;
              }
            }
            const val = parseMoneyToNumber(row[col.key]);
            return Number.isFinite(val) ? sum + val : sum;
          }, 0);
        } else {
          totals[col.key] = null;
        }
      });
      return totals;
    }, [filteredAndSortedData, columns, columnTypes, showFooter, totalCalculationOverride]);

    useEffect(() => {
      const next = new Set<string>();
      if (
        autoHideZeroSumColumns &&
        showFooter &&
        filteredAndSortedData.length > 0
      ) {
        columns.forEach((col) => {
          const total = footerTotals[col.key];
          if (typeof total === "number" && Math.abs(total) < 1e-9) {
            next.add(col.key);
          }
        });
      }

      setAutoHiddenColumns((prev) => {
        if (
          prev.size === next.size &&
          Array.from(prev).every((key) => next.has(key))
        ) {
          return prev;
        }
        return next;
      });
    }, [
      autoHideZeroSumColumns,
      showFooter,
      filteredAndSortedData.length,
      columns,
      footerTotals,
    ]);

    const columnTotals = useMemo(() => {
      const totals: Record<string, number> = {};
      const summableColumns = columns.filter((col) => {
        const type = columnTypes[col.key] || col.type || "text";
        return type === "number" || type === "currency" || type === "money";
      });

      if (summableColumns.length === 0) return totals;

      for (const row of deferredPaginatedData) {
        for (const col of summableColumns) {
          const val = row[col.key];
          if (val) {
             totals[col.key] = (totals[col.key] || 0) + (parseMoneyToNumber(val) || 0);
          }
        }
      }
      return totals;
    }, [deferredPaginatedData, columns, columnTypes]);

    // Track container width via ResizeObserver
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      if (typeof ResizeObserver === "undefined") return;

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setVsContainerWidth((prev) => Math.abs(prev - entry.contentRect.width) > 2 ? Math.round(entry.contentRect.width) : prev);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // Reset scroll to top when data changes (search/sort)
    useEffect(() => {
      scrollContainerRef.current?.scrollTo({ top: 0 });
      
    }, [debouncedSearchTerm, sortConfig]);

    const rowVirtualizer = useVirtualizer({
      count: paginatedData.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: useCallback(() => rowHeight, [rowHeight]),
      overscan: 30,
      getItemKey: useCallback((index: number) => paginatedData[index]?.id || index, [paginatedData]),
    });
    
    const virtualItems = rowVirtualizer.getVirtualItems();
    const vsTopPad = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const vsBottomPad = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;
    const vsStartIndex = virtualItems.length > 0 ? virtualItems[0].index : 0;
    const vsEndIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : 0;

    // Notify filtered data change (using ref to prevent re-render loop if parent passes inline callback)
    const onFilteredDataChangeRef = useRef(onFilteredDataChange);
    useEffect(() => {
      onFilteredDataChangeRef.current = onFilteredDataChange;
    });

    useEffect(() => {
      if (onFilteredDataChangeRef.current) {
        onFilteredDataChangeRef.current(filteredAndSortedData);
      }
    }, [filteredAndSortedData]);

    // Notify selection change (using ref to prevent re-render loop if parent passes inline callback)
    const onSelectionChangeRef = useRef(onSelectionChange);
    useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    });

    useEffect(() => {
      if (onSelectionChangeRef.current) {
        const selectedRows = filteredAndSortedData.filter((row, idx) =>
          selectedRowIds.has(row.id || idx),
        );
        onSelectionChangeRef.current(selectedRows);
      }
    }, [selectedRowIds, filteredAndSortedData]);

    // Scroll active cell into view
    useEffect(() => {
      if (activeCell && scrollContainerRef.current) {
        // Find if row is in paginatedData
        const startIdx = itemsPerPage === Infinity ? 0 : (currentPage - 1) * itemsPerPage;
        const endIdx = itemsPerPage === Infinity ? filteredAndSortedData.length - 1 : startIdx + itemsPerPage - 1;
        
        // Track whether activeCell itself changed, or if the update is just from pagination/re-renders
        const activeCellChanged = !lastActiveCellRef.current || 
          lastActiveCellRef.current.r !== activeCell.r || 
          lastActiveCellRef.current.c !== activeCell.c;
        lastActiveCellRef.current = activeCell;

        if (itemsPerPage !== Infinity) {
          if (activeCell.r < startIdx || activeCell.r > endIdx) {
            if (activeCellChanged) {
              const newPage = Math.floor(activeCell.r / itemsPerPage) + 1;
              setCurrentPage(Math.max(1, Math.min(totalPages, newPage)));
              return;
            } else {
              return;
            }
          }
        }
        
        if (activeCell.r >= startIdx && activeCell.r <= endIdx && activeCellSourceRef.current === "keyboard") {
          const container = scrollContainerRef.current;
          if (container) {
            const paginatedIndex = activeCell.r - startIdx;
            // First trigger virtualizer scroll to index
            rowVirtualizer.scrollToIndex(paginatedIndex, { align: "auto" });

            // Next frame: measure actual position relative to sticky header & footer
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const currentContainer = scrollContainerRef.current;
                if (!currentContainer) return;

                const td = currentContainer.querySelector(`td[data-r="${activeCell.r}"][data-c="${activeCell.c}"]`) as HTMLElement;
                if (td) {
                  const containerRect = currentContainer.getBoundingClientRect();
                  const tdRect = td.getBoundingClientRect();

                  const headerHeight = currentContainer.querySelector("thead")?.offsetHeight || 32;
                  const tfootEl = currentContainer.querySelector("tfoot");
                  const footerHeight = (showFooter && tfootEl) ? tfootEl.offsetHeight : 0;
                  const stickyFooterEl = currentContainer.querySelector(".sticky.bottom-0") as HTMLElement;
                  const extraFooter = (stickyFooterEl && stickyFooterEl !== tfootEl) ? stickyFooterEl.offsetHeight : 0;

                  const visibleTop = containerRect.top + headerHeight;
                  const visibleBottom = containerRect.bottom - Math.max(footerHeight, extraFooter, 0);

                  // Vertical adjustment if cell is obscured by sticky footer or header
                  if (tdRect.bottom > visibleBottom - 4) {
                    currentContainer.scrollTop += (tdRect.bottom - visibleBottom) + 8;
                  } else if (tdRect.top < visibleTop + 4) {
                    currentContainer.scrollTop -= (visibleTop - tdRect.top) + 8;
                  }

                  // Horizontal adjustment considering left sticky columns
                  let leftStickyWidth = 0;
                  if (selectable) leftStickyWidth += 40;
                  if (isRowNumberVisible) leftStickyWidth += 50;

                  if (tdRect.right > containerRect.right - 12) {
                    currentContainer.scrollLeft += (tdRect.right - (containerRect.right - 12));
                  } else if (tdRect.left < containerRect.left + leftStickyWidth + 12) {
                    currentContainer.scrollLeft -= ((containerRect.left + leftStickyWidth + 12) - tdRect.left);
                  }
                }
              });
            });
          }
        }
      }
    }, [activeCell, currentPage, itemsPerPage, filteredAndSortedData.length, rowHeight, showFooter]);

    useEffect(() => {
      if (!resizingCol) return;

      const { key, startX, startWidth } = resizingCol;
      const handleMouseMove = (e: MouseEvent) => {
        latestResizeXRef.current = e.clientX;
        if (resizeFrameRef.current !== null) return;

        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          const currentX = latestResizeXRef.current;
          setResizingCol((previous) =>
            previous ? { ...previous, currentX } : null,
          );
        });
      };

      const handleMouseUp = (event: MouseEvent) => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }

        const finalX = latestResizeXRef.current || event.clientX;
        const finalWidth = Math.max(50, startWidth + finalX - startX);
        setColumnWidths((previous) => {
          const next = { ...previous, [key]: finalWidth };
          saveColumnWidths(next);
          return next;
        });
        setResizingCol(null);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
      };
    }, [resizingCol?.key, resizingCol?.startX, resizingCol?.startWidth]);

    const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.target as HTMLElement).closest("th");
      if (!th) return;

      latestResizeXRef.current = e.clientX;

      setResizingCol({
        key: colKey,
        startX: e.clientX,
        startWidth: th.offsetWidth,
        currentX: e.clientX,
      });

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };

    const autoFitAllColumns = useCallback(() => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;

      const nextWidths = { ...columnWidths };
      const sampledRows = getAutoFitSample(filteredAndSortedData);

      visibleColumns.forEach((col) => {
        context.font = "700 0.8125rem Inter, sans-serif"; // Matches table cell font
        let maxWidth = context.measureText(col.label || "").width + 80;

        context.font = "500 0.8125rem Inter, sans-serif";
        sampledRows.forEach((row) => {
          const val = row[col.key];
          const formatted = val !== undefined && val !== null ? formatValue(val, col.type, col.key) : "";
          const stringVal = (typeof formatted === "string" || typeof formatted === "number") ? String(formatted) : String(val ?? "");
          const w = context.measureText(stringVal).width + 60;
          if (w > maxWidth) maxWidth = w;
        });

        const colDefaultWidth = col.width ? (typeof col.width === "number" ? col.width : parseInt(String(col.width)) || 150) : 150;
        const finalWidth = Math.min(600, Math.max(colDefaultWidth, maxWidth));
        nextWidths[col.key] = finalWidth;
      });

      setColumnWidths(nextWidths);
      saveColumnWidths(nextWidths);
      showStatus("Đã tự động căn chỉnh kích thước cho tất cả cột!");
    }, [columnWidths, visibleColumns, filteredAndSortedData, formatValue]);

    const handleResizeDoubleClick = (colKey: string) => {
      let isAllSelected = selectedRowIds.size > 0 && selectedRowIds.size === filteredAndSortedData.length;
      if (!isAllSelected && selectionRange) {
        const { startR, endR, startC, endC } = selectionRange;
        const minR = Math.min(startR, endR);
        const maxR = Math.max(startR, endR);
        const minC = Math.min(startC, endC);
        const maxC = Math.max(startC, endC);

        if (minR === 0 && maxR === filteredAndSortedData.length - 1 && minC === 0 && maxC === visibleColumns.length - 1) {
          isAllSelected = true;
        }
      }

      if (isAllSelected) {
        autoFitAllColumns();
        return;
      }

      // Measure text tool
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = "700 0.8125rem Inter, sans-serif"; // Matches table cell font

      // Measure header
      const col = columns.find((c) => c.key === colKey);
      let maxWidth = context.measureText(col?.label || "").width + 80; // Padding + Filter icon

      context.font = "500 0.8125rem Inter, sans-serif"; // Matches row cell font
      const sampledRows = getAutoFitSample(filteredAndSortedData);
      sampledRows.forEach((row) => {
        const value = row[colKey];
        const formatted = value !== undefined && value !== null
          ? formatValue(value, col?.type, colKey)
          : "";
        const v = typeof formatted === "string" || typeof formatted === "number"
          ? String(formatted)
          : String(value ?? "");
        const w = context.measureText(v).width + 60; // Cell padding
        if (w > maxWidth) maxWidth = w;
      });

      const finalWidth = Math.min(600, Math.max(80, maxWidth));
      setColumnWidths((prev) => {
        const next = { ...prev, [colKey]: finalWidth };
        saveColumnWidths(next);
        return next;
      });
      showStatus(`Đã tự động căn chỉnh cột ${col?.label}`);
    };

    const tableRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
      const handleGlobalMouseUp = () => {
        setIsSelecting(false);
      };
      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }, []);

    const handleSort = (key: string, direction?: "asc" | "desc" | null) => {
      setSortConfig((prev) => {
        const currentIndex = prev.findIndex((rule) => rule.key === key);
        if (direction === null) {
          showStatus("Đã xóa sắp xếp cột");
          return prev.filter((rule) => rule.key !== key);
        }
        if (direction) {
          if (currentIndex < 0) return [...prev, { key, direction }];
          return prev.map((rule, index) =>
            index === currentIndex ? { ...rule, direction } : rule,
          );
        }
        if (currentIndex < 0) return [...prev, { key, direction: "asc" }];
        if (prev[currentIndex].direction === "asc") {
          return prev.map((rule, index) =>
            index === currentIndex ? { ...rule, direction: "desc" } : rule,
          );
        }
        showStatus("Đã xóa sắp xếp cột");
        return prev.filter((_, index) => index !== currentIndex);
      });
    };

    const handleSetBuFilterMode = useCallback((mode: string) => {
      setBuFilterMode(mode);
      if (!buColumn) return;

      if (mode === "ALL") {
        setColumnFilters((prev) => {
          const next = { ...prev };
          delete next[buColumn.key];
          return next;
        });
      } else if (mode === "EXCLUDE_AHP") {
        const allowed = new Set<any>();
        data.forEach((row: any) => {
          const val = row[buColumn.key] ?? row._subtotalGroup;
          if (val != null && String(val).trim()) {
            const cleanStr = String(val).trim();
            if (!isAhpBuValue(cleanStr)) {
              allowed.add(cleanStr);
              allowed.add(String(val));
            }
          }
        });
        setColumnFilters((prev) => ({ ...prev, [buColumn.key]: allowed }));
      } else {
        const allowed = new Set<any>();
        data.forEach((row: any) => {
          const val = row[buColumn.key] ?? row._subtotalGroup;
          if (val != null && String(val).trim().toUpperCase() === mode) {
            allowed.add(String(val).trim());
            allowed.add(String(val));
          }
        });
        if (allowed.size === 0) {
          allowed.add(mode);
        }
        setColumnFilters((prev) => ({ ...prev, [buColumn.key]: allowed }));
      }
    }, [buColumn, data]);

    const handleFilterChange = useCallback((key: string, values: Set<any> | undefined) => {
      setColumnFilters((prev) => ({ ...prev, [key]: values }));

      if (buColumn && key === buColumn.key) {
        if (!values || values.size === 0) {
          setBuFilterMode("ALL");
        } else {
          let hasAhp = false;
          let nonAhpCount = 0;
          const nonAhpVals = new Set<string>();

          values.forEach((v) => {
            if (isAhpBuValue(v)) {
              hasAhp = true;
            } else {
              nonAhpCount += 1;
              nonAhpVals.add(String(v).trim().toUpperCase());
            }
          });

          if (!hasAhp && nonAhpCount > 0) {
            if (nonAhpVals.size === 1) {
              setBuFilterMode(Array.from(nonAhpVals)[0]);
            } else {
              setBuFilterMode("EXCLUDE_AHP");
            }
          } else if (hasAhp && nonAhpCount > 0) {
            setBuFilterMode("ALL");
          } else {
            setBuFilterMode("CUSTOM");
          }
        }
      }
    }, [buColumn]);

    const clearAllFilters = () => {
      setIndividualOverlap(null);
      setColumnFilters({});
      setBuFilterMode("ALL");
      setInternalSearchTerm("");
      if (onExternalSearchChange) onExternalSearchChange("");
      showStatus("Đã xóa tất cả bộ lọc");
    };

    const resetTableConfig = () => {
      setBuFilterMode("ALL");
      if (storageKey) {
        localStorage.removeItem(`dt_hidden_${storageKey}`);
        localStorage.removeItem(`dt_widths_${storageKey}`);
        localStorage.removeItem(`dt_sort_${storageKey}`);
        localStorage.removeItem(`dt_ipp_${storageKey}`);
        const defaultHidden = new Set<string>();
        columns.forEach((c: any) => {
          if (c?.hidden) {
            defaultHidden.add(c.key);
          }
        });
        setHiddenColumns(defaultHidden);
        setShownAutoHiddenColumns(new Set());
        setColumnWidths({});
        setSortConfig([]);
        setItemsPerPage(50);
        setCurrentPage(1);
        showStatus("Đã khôi phục cấu hình bảng mặc định");
      }
    };

    const toggleColumn = (key: string) => {
      const isCurrentlyHidden = effectiveHiddenColumns.has(key);

      if (isCurrentlyHidden) {
        setHiddenColumns((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        if (autoHiddenColumns.has(key)) {
          setShownAutoHiddenColumns((prev) => new Set(prev).add(key));
        }
        return;
      }

      if (autoHiddenColumns.has(key)) {
        setShownAutoHiddenColumns((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        return;
      }

      setHiddenColumns((prev) => new Set(prev).add(key));
    };

    const updateAlignment = (
      colKey: string,
      alignment: "left" | "center" | "right",
    ) => {
      setColumnFormats((prev) => ({
        ...prev,
        [colKey]: { ...prev[colKey], alignment },
      }));
    };

    const updateColumnType = (key: string, type: string) => {
      setColumnTypes((prev) => {
        const next = { ...prev, [key]: type };
        if (storageKey)
          localStorage.setItem(`dt_types_${storageKey}`, JSON.stringify(next));
        return next;
      });
      showStatus(`Đã đổi định dạng cột sang ${type}`);
    };

    useEffect(() => {
      if (!storageKey) return;
      return registerTableExport(storageKey, () => ({
        schema: { columns: [
          ...(showRowNumber && !columns.some(c => isNoCol(c.key)) ? [{ key: "No.", label: "No.", type: "number" }] : []),
          ...columns.filter(c => !isInternalHelperCol(c.key) && !isInternalHelperCol(c.label)).map(({ key, label, type, hidden }) => ({ key, label, type, hidden })),
        ], hiddenColumns: [...effectiveHiddenColumns, ...(effectiveHiddenColumns.has("__ROW_NUMBER__") ? ["No."] : [])] },
        rows: filteredAndSortedData,
      }));
    }, [storageKey, columns, effectiveHiddenColumns, filteredAndSortedData, showRowNumber]);

    React.useImperativeHandle(ref, () => ({
      exportExcel: () => { if (storageKey) downloadTableExcel(storageKey); },
      columns,
      hiddenColumns: effectiveHiddenColumns,
      toggleColumn,
      resetTableConfig,
      clearAllFilters,
      removeColumnFilters: (keys: string[]) => {
        setColumnFilters((prev) => {
          const next = { ...prev };
          keys.forEach((k) => delete next[k]);
          return next;
        });
      },
      setIndividualOverlapFilter: (meta: { ma_nv: string; ngay: string; full_name?: string }) => {
        setIndividualOverlap({
          keys: ["ma_nv", "ngay"],
          ma_nv: String(meta.ma_nv),
          ngay: String(meta.ngay),
          full_name: meta.full_name,
        });
        setColumnFilters((prev) => ({
          ...prev,
          ma_nv: new Set([String(meta.ma_nv)]),
          ngay: new Set([meta.ngay]),
        }));
        setCurrentPage(1);
      },
      clearIndividualOverlapFilter: () => {
        handleClearIndividualOverlap();
      },
      setColumnFilter: (key: string, values: Set<any>) => {
        setColumnFilters((prev) => ({
          ...prev,
          [key]: values,
        }));
      },
      setMultipleColumnFilters: (filters: Record<string, Set<any>>) => {
        setColumnFilters((prev) => ({
          ...prev,
          ...filters,
        }));
      },
      autoFitAllColumns,
      getCurrentPageData: () => paginatedData,
      getActiveCell: () => activeCell,
      getFilteredAndSortedData: () => filteredAndSortedData,
    }));


    const toggleAll = () => {
      setSelectedRowIds((prev) => {
        if (prev.size === filteredAndSortedData.length) {
          return new Set();
        } else {
          return new Set(
            filteredAndSortedData.map((row, idx) => row.id || idx),
          );
        }
      });
    };

    const toggleRow = useCallback((id: string | number) => {
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }, []);

    const startEditing = useCallback(
      (r: number, c: number, clear: boolean = false) => {
        if (!isEditable || !onCellChange) return;
        const col = visibleColumns[c];
        if (!col || col.readOnly) return;
        const row = filteredAndSortedData[r];
        if (!row || row._isSubtotal || row._isTotalRow) return;
        beginEdit({ r, c }, row, col.key, clear ? "" : row[col.key]);

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            if (!clear) {
              if (
                inputRef.current instanceof HTMLInputElement ||
                inputRef.current instanceof HTMLTextAreaElement
              ) {
                inputRef.current.select();
              }
            }
          }
        }, 0);
      },
      [isEditable, onCellChange, visibleColumns, filteredAndSortedData, beginEdit],
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent, r: number, c: number) => {
        e.preventDefault();
        if (r !== -1) {
          // If there's a selection range and the right-click is inside it, don't change the active cell
          let isInsideRange = false;
          if (selectionRange) {
            const minR = Math.min(selectionRange.startR, selectionRange.endR);
            const maxR = Math.max(selectionRange.startR, selectionRange.endR);
            const minC = Math.min(selectionRange.startC, selectionRange.endC);
            const maxC = Math.max(selectionRange.startC, selectionRange.endC);
            if (r >= minR && r <= maxR && c >= minC && c <= maxC) {
              isInsideRange = true;
            }
          }
          if (!isInsideRange) {
            setActiveCellWithSource({ r, c }, "mouse");
            setSelectionRange(null); // Clear range if right click outside
          }
        }
        setContextMenu({ x: e.clientX, y: e.clientY, r, c });
      },
      [selectionRange],
    );

    const closeContextMenu = () => setContextMenu(null);

    useEffect(() => {
      const handleGlobalClick = () => closeContextMenu();
      window.addEventListener("click", handleGlobalClick);
      return () => window.removeEventListener("click", handleGlobalClick);
    }, []);

    const handleHeaderMouseDown = (e: React.MouseEvent, cIdx: number) => {
      if (e.button !== 0) return;
      if (filteredAndSortedData.length === 0) return;
      setIsSelecting(true);
      setActiveCellWithSource({ r: 0, c: cIdx }, "mouse");
      setSelectionRange({
        startR: 0,
        endR: filteredAndSortedData.length - 1,
        startC: cIdx,
        endC: cIdx,
      });
    };

    const handleHeaderMouseEnter = (e: React.MouseEvent, cIdx: number) => {
      if (
        e.buttons === 1 &&
        selectionRange &&
        selectionRange.startR === 0 &&
        selectionRange.endR === filteredAndSortedData.length - 1
      ) {
        setSelectionRange((prev) => (prev ? { ...prev, endC: cIdx } : null));
      }
    };

    const isNumericColumnForClipboard = (col: Column): boolean => {
      if (isProtectedNumericColumn(col.key)) return false;
      const effectiveType = columnTypes[col.key] || col.type;
      return (
        effectiveType === "number" ||
        effectiveType === "currency" ||
        effectiveType === "money" ||
        col.showGrandTotal === true
      );
    };

    const getClipboardCellValue = (row: any, col: Column): string => {
      if (!row || !col) return "";
      const value = row[col.key];
      if (value === null || value === undefined || value === "") return "";
      const effectiveType = columnTypes[col.key] || col.type;
      if (value instanceof Date) {
        if (
          isNumericColumnForClipboard(col) ||
          isChargeAmountColumn(col.key)
        ) {
          return "";
        }
        return isNaN(value.getTime())
          ? ""
          : value.toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
      }

      const canInferNumericValue =
        !isProtectedNumericColumn(col.key) &&
        effectiveType !== "date" &&
        effectiveType !== "label" &&
        looksLikeNumericValue(value);

      if (
        isNumericColumnForClipboard(col) ||
        canInferNumericValue
      ) {
        if (!looksLikeNumericValue(value)) return "";
        return formatClipboardNumber(parseMoneyToNumber(value));
      }

      return String(value);
    };

    const normalizePastedCellValue = (
      clipboardValue: string,
      col: Column,
    ): string | number => {
      const trimmedValue = clipboardValue.trim();
      if (!trimmedValue) return trimmedValue;

      const effectiveType = columnTypes[col.key] || col.type;
      const canInferNumericValue =
        !isProtectedNumericColumn(col.key) &&
        effectiveType !== "date" &&
        effectiveType !== "label" &&
        looksLikeNumericValue(trimmedValue);

      if (!isNumericColumnForClipboard(col) && !canInferNumericValue) {
        return trimmedValue;
      }
      if (!looksLikeNumericValue(trimmedValue)) return trimmedValue;
      return roundToTwoDecimals(parseMoneyToNumber(trimmedValue));
    };

    const copyColumn = (cIdx: number) => {
      const col = visibleColumns[cIdx];
      const values = filteredAndSortedData.map((row) =>
        getClipboardCellValue(row, col),
      );
      try {
        navigator.clipboard.writeText(values.join("\n"));
      } catch (err) {
        console.error("Failed to copy!", err);
        toast.error(
          "Không thể sao chép vào clipboard. Vui lòng kiểm tra quyền truy cập.",
        );
      }
    };

    const copySelection = () => {
      if (selectionRange) {
        const { startR, endR, startC, endC } = selectionRange;
        const minR = Math.min(startR, endR);
        const maxR = Math.max(startR, endR);
        const minC = Math.min(startC, endC);
        const maxC = Math.max(startC, endC);

        try {
          if (minR === maxR && minC === maxC) {
            const row = filteredAndSortedData[minR];
            const col = visibleColumns[minC];
            const valStr = getClipboardCellValue(row, col);
            navigator.clipboard.writeText(valStr);
          } else {
            const rows = [];
            for (let i = minR; i <= maxR; i++) {
              const rowVals = [];
              for (let j = minC; j <= maxC; j++) {
                const col = visibleColumns[j];
                rowVals.push(getClipboardCellValue(filteredAndSortedData[i], col));
              }
              rows.push(rowVals.join("\t"));
            }
            navigator.clipboard.writeText(rows.join("\n"));
          }
        } catch (err) {
          console.error("Failed to copy!", err);
          toast.error(
            "Không thể sao chép vào clipboard. Vui lòng kiểm tra quyền truy cập.",
          );
        }
      } else if (activeCell) {
        try {
          const row = filteredAndSortedData[activeCell.r];
          const col = visibleColumns[activeCell.c];
          const valStr = getClipboardCellValue(row, col);
          navigator.clipboard.writeText(valStr);
        } catch (err) {
          console.error("Failed to copy!", err);
          toast.error(
            "Không thể sao chép vào clipboard. Vui lòng kiểm tra quyền truy cập.",
          );
        }
      }
    };

    const handleCellMouseDown = useCallback(
      (e: React.MouseEvent, r: number, c: number) => {
        if (e.button !== 0) return;
        setIsSelecting(true);
        
        // Focus the scroll container to make sure arrow keys and paste events function correctly
        if (scrollContainerRef.current) {
          scrollContainerRef.current.focus({ preventScroll: true });
        }

        if (e.shiftKey && activeCell) {
          const anchorR = anchorCellRef.current ? anchorCellRef.current.r : (selectionRange ? selectionRange.startR : activeCell.r);
          const anchorC = anchorCellRef.current ? anchorCellRef.current.c : (selectionRange ? selectionRange.startC : activeCell.c);
          setSelectionRange({
            startR: anchorR,
            endR: r,
            startC: anchorC,
            endC: c,
          });
          setActiveCellWithSource({ r, c }, "mouse");
        } else {
          anchorCellRef.current = { r, c };
          setActiveCellWithSource({ r, c }, "mouse");
          setSelectionRange({ startR: r, endR: r, startC: c, endC: c });
        }
      },
      [activeCell, selectionRange, scrollContainerRef],
    );

    const handleCellMouseEnter = useCallback(
      (e: React.MouseEvent, r: number, c: number) => {
        if (e.buttons === 1 && selectionRange) {
          setSelectionRange((prev) => {
            if (!prev) return null;
            if (prev.endR === r && prev.endC === c) return prev;
            return { ...prev, endR: r, endC: c };
          });
          setActiveCellWithSource({ r, c }, "mouse");
        }
      },
      [selectionRange],
    );

    const handleEditorKeyDown = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
      if (e.key === "Enter" && !e.altKey) {
        e.preventDefault();
        // The window shortcut must not reopen the editor after this commit.
        e.stopPropagation();
        commitEdit();
        setActiveCellWithSource({ r: Math.min(r + 1, filteredAndSortedData.length - 1), c }, "keyboard");
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
      }
    }, [commitEdit, cancelEdit, filteredAndSortedData.length, setActiveCellWithSource]);

    const rowEventHandlers = useRowEventHandlers({
      startEditing, handleCellMouseDown, handleCellMouseEnter, handleContextMenu, handleEditorKeyDown,
    });

    const handleTableMouseMove = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isSelecting || e.buttons !== 1) return;

        const el = scrollContainerRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const headerHeight = el.querySelector("thead")?.offsetHeight || 42;
        const footerHeight = (showFooter ? el.querySelector("tfoot")?.offsetHeight : 0) || 0;
        const stickyFooterEl = el.querySelector(".sticky.bottom-0") as HTMLElement;
        const extraFooter = stickyFooterEl ? stickyFooterEl.offsetHeight : 0;
        const bottomSafety = Math.max(footerHeight, extraFooter, 36) + 16;
        const topSafety = headerHeight + 8;

        const maxStep = 32;
        let deltaY = 0;

        if (e.clientY > rect.bottom - bottomSafety) {
          deltaY = Math.max(10, Math.ceil(((e.clientY - (rect.bottom - bottomSafety)) / 30) * maxStep));
        } else if (e.clientY < rect.top + topSafety) {
          deltaY = -Math.max(10, Math.ceil((((rect.top + topSafety) - e.clientY) / 30) * maxStep));
        }

        let deltaX = 0;
        const rightEdge = rect.right - 30;
        const leftEdge = rect.left + 30;
        if (e.clientX > rightEdge) {
          deltaX = Math.max(10, Math.ceil(((e.clientX - rightEdge) / 30) * maxStep));
        } else if (e.clientX < leftEdge) {
          deltaX = -Math.max(10, Math.ceil(((leftEdge - e.clientX) / 30) * maxStep));
        }

        if (deltaX !== 0) el.scrollLeft += deltaX;
        if (deltaY !== 0) el.scrollTop += deltaY;
      },
      [isSelecting, showFooter],
    );

    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (editingCell) {
          if (e.key === "Enter" && !e.altKey) {
            e.preventDefault();
            const { r, c } = editingCell;
            commitEdit();
            const nextR = Math.min(r + 1, filteredAndSortedData.length - 1);
            setActiveCellWithSource({ r: nextR, c }, "keyboard");
          } else if (e.key === "Tab") {
            e.preventDefault();
            const { r, c } = editingCell;
            commitEdit();
            let nextR = r,
              nextC = c;
            if (e.shiftKey) {
              if (c > 0) nextC = c - 1;
              else if (r > 0) {
                nextR = r - 1;
                nextC = visibleColumns.length - 1;
              }
            } else {
              if (c < visibleColumns.length - 1) nextC = c + 1;
              else if (r < filteredAndSortedData.length - 1) {
                nextR = r + 1;
                nextC = 0;
              }
            }
            setActiveCellWithSource({ r: nextR, c: nextC }, "keyboard");
            if (nextR !== r || nextC !== c)
              setTimeout(() => startEditing(nextR, nextC), 10);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEdit();
          }
          return;
        }

        if (
          !tableRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body
        )
          return;
        if (!activeCell) return;
        const { r, c } = activeCell;

        const operationValue =
          !e.ctrlKey && !e.metaKey && !e.altKey
            ? OPERATION_KEY_SHORTCUTS[e.key.toUpperCase()]
            : undefined;
        if (
          operationValue &&
          isOperationColumn(visibleColumns[c]) &&
          onCellChange
        ) {
          const row = filteredAndSortedData[r];
          if (row) {
            e.preventDefault();
            onCellChange(row, visibleColumns[c].key, operationValue);
            showStatus(`Đã chuyển nghiệp vụ sang ${operationValue}`);
          }
          return;
        }

        const anchorR = anchorCellRef.current ? anchorCellRef.current.r : (selectionRange ? selectionRange.startR : r);
        const anchorC = anchorCellRef.current ? anchorCellRef.current.c : (selectionRange ? selectionRange.startC : c);

        if (e.key === "ArrowDown") {
          e.preventDefault();
          const nextR = (e.ctrlKey || e.metaKey)
            ? filteredAndSortedData.length - 1
            : Math.min(r + 1, filteredAndSortedData.length - 1);
          setActiveCellWithSource({ r: nextR, c }, "keyboard");
          if (e.shiftKey) {
            setSelectionRange({
              startR: anchorR,
              startC: anchorC,
              endR: nextR,
              endC: c,
            });
          } else {
            anchorCellRef.current = { r: nextR, c };
            setSelectionRange({ startR: nextR, endR: nextR, startC: c, endC: c });
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const nextR = (e.ctrlKey || e.metaKey) ? 0 : Math.max(r - 1, 0);
          setActiveCellWithSource({ r: nextR, c }, "keyboard");
          if (e.shiftKey) {
            setSelectionRange({
              startR: anchorR,
              startC: anchorC,
              endR: nextR,
              endC: c,
            });
          } else {
            anchorCellRef.current = { r: nextR, c };
            setSelectionRange({ startR: nextR, endR: nextR, startC: c, endC: c });
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const nextC = (e.ctrlKey || e.metaKey)
            ? visibleColumns.length - 1
            : Math.min(c + 1, visibleColumns.length - 1);
          setActiveCellWithSource({ r, c: nextC }, "keyboard");
          if (e.shiftKey) {
            setSelectionRange({
              startR: anchorR,
              startC: anchorC,
              endR: r,
              endC: nextC,
            });
          } else {
            anchorCellRef.current = { r, c: nextC };
            setSelectionRange({ startR: r, endR: r, startC: nextC, endC: nextC });
          }
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          const nextC = (e.ctrlKey || e.metaKey) ? 0 : Math.max(c - 1, 0);
          setActiveCellWithSource({ r, c: nextC }, "keyboard");
          if (e.shiftKey) {
            setSelectionRange({
              startR: anchorR,
              startC: anchorC,
              endR: r,
              endC: nextC,
            });
          } else {
            anchorCellRef.current = { r, c: nextC };
            setSelectionRange({ startR: r, endR: r, startC: nextC, endC: nextC });
          }
        } else if (e.key === "Tab") {
          e.preventDefault();
          const nextC = e.shiftKey
            ? Math.max(c - 1, 0)
            : Math.min(c + 1, visibleColumns.length - 1);
          anchorCellRef.current = { r, c: nextC };
          setActiveCellWithSource({ r, c: nextC }, "keyboard");
          setSelectionRange({ startR: r, endR: r, startC: nextC, endC: nextC });
        } else if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          startEditing(r, c);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if (onCellChange) {
            if (selectionRange) {
              const { startR, endR, startC, endC } = selectionRange;
              const minR = Math.min(startR, endR),
                maxR = Math.max(startR, endR);
              const minC = Math.min(startC, endC),
                maxC = Math.max(startC, endC);
              for (let i = minR; i <= maxR; i++) {
                for (let j = minC; j <= maxC; j++) {
                  const row = filteredAndSortedData[i];
                  if (row && visibleColumns[j]) {
                    onCellChange(row, visibleColumns[j].key, "");
                  }
                }
              }
              showStatus(
                `Đã xóa dữ liệu trong ${(maxR - minR + 1) * (maxC - minC + 1)} ô`,
              );
            } else {
              const row = filteredAndSortedData[r];
              if (row && visibleColumns[c]) {
                onCellChange(row, visibleColumns[c].key, "");
              }
            }
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
          e.preventDefault();
          if (onCellChange) {
            if (selectionRange) {
              const minR = Math.min(selectionRange.startR, selectionRange.endR);
              const maxR = Math.max(selectionRange.startR, selectionRange.endR);
              const minC = Math.min(selectionRange.startC, selectionRange.endC);
              const maxC = Math.max(selectionRange.startC, selectionRange.endC);
              if (maxR > minR) {
                for (let j = minC; j <= maxC; j++) {
                  const colKey = visibleColumns[j]?.key;
                  if (!colKey) continue;
                  const topRow = filteredAndSortedData[minR];
                  const topVal = topRow ? topRow[colKey] : "";
                  for (let i = minR + 1; i <= maxR; i++) {
                    const targetRow = filteredAndSortedData[i];
                    if (targetRow) onCellChange(targetRow, colKey, topVal);
                  }
                }
                showStatus("Đã sao chép dòng đầu xuống vùng chọn (Ctrl+D)");
              } else if (minR > 0) {
                for (let j = minC; j <= maxC; j++) {
                  const colKey = visibleColumns[j]?.key;
                  if (!colKey) continue;
                  const prevRow = filteredAndSortedData[minR - 1];
                  const prevVal = prevRow ? prevRow[colKey] : "";
                  const targetRow = filteredAndSortedData[minR];
                  if (targetRow) onCellChange(targetRow, colKey, prevVal);
                }
                showStatus("Đã sao chép dòng trên xuống (Ctrl+D)");
              }
            } else if (r > 0) {
              const colKey = visibleColumns[c]?.key;
              if (colKey) {
                const prevRow = filteredAndSortedData[r - 1];
                const prevVal = prevRow ? prevRow[colKey] : "";
                const targetRow = filteredAndSortedData[r];
                if (targetRow) onCellChange(targetRow, colKey, prevVal);
                showStatus("Đã sao chép ô trên xuống (Ctrl+D)");
              }
            }
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          if (selectable) {
            toggleAll();
          } else {
            setSelectionRange({
              startR: 0,
              endR: filteredAndSortedData.length - 1,
              startC: 0,
              endC: visibleColumns.length - 1,
            });
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
          e.preventDefault();
          copySelection();
        }
      };

      const handlePaste = (e: ClipboardEvent) => {
        if (editingCell) return;
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA"
        ) {
          return;
        }
        if (
          !tableRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body
        ) {
          return;
        }
        if (!activeCell || !onCellChange) return;

        const text = e.clipboardData?.getData("text") || "";
        if (!text) return;
        e.preventDefault();

        const { r, c } = activeCell;
        const rows = text.split(/\r?\n/);
        if (rows.length > 1 && rows[rows.length - 1].trim() === "") {
          rows.pop();
        }

        const parsedGrid = rows.map((rowText) => rowText.split("\t"));
        const clipRows = parsedGrid.length;
        const clipCols = parsedGrid[0]?.length || 1;

        if (selectionRange) {
          const minR = Math.min(selectionRange.startR, selectionRange.endR);
          const maxR = Math.max(selectionRange.startR, selectionRange.endR);
          const minC = Math.min(selectionRange.startC, selectionRange.endC);
          const maxC = Math.max(selectionRange.startC, selectionRange.endC);
          const rangeRows = maxR - minR + 1;
          const rangeCols = maxC - minC + 1;

          if (rangeRows > 1 || rangeCols > 1) {
            for (let i = minR; i <= maxR; i++) {
              const rIdxInClip = (i - minR) % clipRows;
              for (let j = minC; j <= maxC; j++) {
                const cIdxInClip = (j - minC) % clipCols;
                const clipboardCellValue =
                  parsedGrid[rIdxInClip] &&
                  parsedGrid[rIdxInClip][cIdxInClip] !== undefined
                    ? parsedGrid[rIdxInClip][cIdxInClip].trim()
                    : "";
                const targetRow = filteredAndSortedData[i];
                if (targetRow && visibleColumns[j]) {
                  const targetColumn = visibleColumns[j];
                  onCellChange(
                    targetRow,
                    targetColumn.key,
                    normalizePastedCellValue(
                      clipboardCellValue,
                      targetColumn,
                    ),
                  );
                }
              }
            }
            showStatus(`Đã dán dữ liệu vào vùng chọn (${rangeRows}x${rangeCols} ô)`);
            return;
          }
        }

        parsedGrid.forEach((rowCells, rOffset) => {
          rowCells.forEach((cellText, cOffset) => {
            const targetR = r + rOffset;
            const targetC = c + cOffset;
            if (
              targetR < filteredAndSortedData.length &&
              targetC < visibleColumns.length
            ) {
              const targetRow = filteredAndSortedData[targetR];
              const targetColumn = visibleColumns[targetC];
              onCellChange(
                targetRow,
                targetColumn.key,
                normalizePastedCellValue(cellText, targetColumn),
              );
            }
          });
        });
        showStatus("Đã dán dữ liệu");
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("paste", handlePaste);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("paste", handlePaste);
      };
    }, [
      filteredAndSortedData,
      activeCell,
      editingCell,
      editValue,
      visibleColumns,
      isEditable,
      onCellChange,
      selectionRange,
    ]);

    const totalTableWidth =
      (selectable ? 40 : 0) +
      (isRowNumberVisible ? 50 : 0) +
      visibleColumns.reduce((sum, col) => {
        const w = columnWidths[col.key] || col.width || 150;
        return sum + (typeof w === "number" ? w : parseInt(String(w)) || 150);
      }, 0);

    const densityStyles = {
      compact: {
        padding: "1.5px 4px",
        fontSize: "0.65rem",
        headerFontSize: "0.65rem",
      },
      normal: {
        padding: "3.5px 7px",
        fontSize: "0.7rem",
        headerFontSize: "0.7rem",
      },
      relaxed: {
        padding: "6px 12px",
        fontSize: "0.75rem",
        headerFontSize: "0.75rem",
      },
    };

    const renderHeaderCell = (col: Column, cIdx: number, rowSpan: number = 1, isSecondRow: boolean = false) => {
      const isColActive =
        activeCell?.c === cIdx ||
        (selectionRange &&
          cIdx >= Math.min(selectionRange.startC, selectionRange.endC) &&
          cIdx <= Math.max(selectionRange.startC, selectionRange.endC));
      const colWidth = columnWidths[col.key] || col.width || 150;
      const widthStyle = colWidth
        ? typeof colWidth === "number"
          ? `${colWidth}px`
          : colWidth
        : "150px";
      
      const isColFiltered = columnFilters[col.key] instanceof Set;
      const isNoHeader = isNoCol(col.key) || isNoCol(col.label);
      const filteredHeaderClass = isColFiltered
        ? "bg-[#FEF3C7] dark:bg-amber-950/40 border-amber-300 text-amber-900 font-extrabold"
        : (col.group ? groupColorMap.get(col.group) : (headerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]"));

      const filteredHeaderBgColor = isColFiltered
        ? "#FEF3C7"
        : (col.group ? undefined : "var(--table-column-header-bg, #F4ECD8)");

      // Since the parent thead is sticky, individual cells only need horizontal sticky positioning
      const stickyClass = [
        stickyFirstColumn && cIdx === 0 ? "sticky-col-first-data sticky-header-col" : ""
      ].filter(Boolean).join(" ");

      const colAlign = getAlignment(col);
      const activeSortIndex = sortConfig.findIndex((rule) => rule.key === col.key);
      const activeSort = activeSortIndex >= 0 ? sortConfig[activeSortIndex] : undefined;
      // Table column headers are centered by default as requested
      const headerFlexJustify = "justify-center";
      const headerTextAlign = "text-center";

      return (
        <th
          key={col.key}
          rowSpan={rowSpan}
          onMouseDown={(e) => handleHeaderMouseDown(e, cIdx)}
          onMouseEnter={(e) => handleHeaderMouseEnter(e, cIdx)}
          onContextMenu={(e) => handleContextMenu(e, -1, cIdx)}
          className={`relative ${stickyClass} ${col.group ? "has-group" : ""} whitespace-normal align-middle cursor-pointer select-none group border-r ${borderClass} text-center ${filteredHeaderClass} ${col.headerClassName || ""} border-b border-[var(--table-border-color,#e7dbdc)] text-[var(--header-font-size,0.65rem)] font-bold ${isNoHeader ? "normal-case" : "uppercase"} text-[var(--table-column-header-text-color,#1e293b)]`}
          style={{
            padding: "var(--table-padding, 0.25rem 0.4rem)",
            paddingTop: "5px",
            paddingBottom: "4px",
            backgroundColor: filteredHeaderBgColor,
            color: "var(--table-column-header-text-color, var(--table-column-header-text, #1e293b))",
            width: widthStyle,
            minWidth: widthStyle,
            maxWidth: widthStyle,
            overflow: "visible",
            textTransform: isNoHeader ? "none" : undefined,
            ...(stickyFirstColumn && cIdx === 0 ? {
              left: (selectable ? 40 : 0) + (showRowNumber ? 50 : 0)
            } : {})
          }}
        >
          <div className={`flex items-center gap-1.5 ${headerFlexJustify} min-h-full px-1 min-w-0 w-full overflow-visible text-inherit`}>
            <span
              className={`transition-colors flex-1 min-w-0 flex flex-wrap items-center ${headerFlexJustify} gap-1 text-inherit ${col.sortable !== false ? "hover:text-accent active:scale-[0.98] cursor-pointer" : ""} ${col.headerSpanClassName || ""}`}
              onClick={(e) => {
                if (col.sortable !== false) {
                  e.stopPropagation();
                  handleSort(col.key);
                }
              }}
              title={col.sortable !== false ? "Nhấp để thêm cấp sort (Tăng dần → Giảm dần → Hủy); cột bấm trước được ưu tiên trước" : undefined}
            >
              <span className={`whitespace-normal break-words leading-normal pt-0.5 ${headerTextAlign} max-w-full min-w-0 block font-bold text-inherit`}>
                {/^NO\.$/i.test(col.label) ? "No." : col.label}
              </span>
              {col.sortable !== false && activeSort && (
                <div className="inline-flex items-center gap-0.5 ml-0.5 shrink-0">
                  <span className="text-accent flex items-center justify-center font-bold">
                    {activeSort.direction === "asc" ? (
                      <ChevronUp className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                    )}
                  </span>
                  <span className="grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-1 text-[8px] font-black leading-none text-white">
                    {activeSortIndex + 1}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleSort(col.key, null);
                    }}
                    className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-900/40 text-muted-foreground hover:text-rose-600 transition-colors cursor-pointer"
                    title="Xóa sắp xếp cột này"
                    aria-label="Xóa sắp xếp cột này"
                  >
                    <X className="w-3 h-3 stroke-[2.5]" />
                  </button>
                </div>
              )}
            </span>
            {(col.key === "No." || col.key === "no" || col.key === "STT" || col.label?.toUpperCase() === "NO." || col.label?.toUpperCase() === "STT") && (
              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); autoFitAllColumns(); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-accent/10 rounded text-accent cursor-pointer ml-0.5 shrink-0"
                title="Tự động căn chỉnh tất cả cột"
                aria-label="Tự động căn chỉnh tất cả cột"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            )}
            {col.filterable !== false && (
              <ColumnFilter
                column={col}
                allData={data}
                filterState={columnFilters}
                onFilterChange={handleFilterChange}
                onSort={handleSort}
                sortConfig={sortConfig}
                searchTerm={debouncedSearchTerm}
                activeIndividualOverlap={individualOverlap}
                onClearIndividualOverlap={handleClearIndividualOverlap}
              />
            )}
          </div>
          {resizableColumns && (
            <div
              onMouseDown={(e) => handleResizeStart(e, col.key)}
              onDoubleClick={() => handleResizeDoubleClick(col.key)}
              className={`absolute -right-[8px] top-0 bottom-0 w-[16px] cursor-col-resize group/resizer z-[70] flex justify-center`}
              style={
                cIdx === 15 
                  ? { width: 0, height: 0, opacity: 0, pointerEvents: "none" } 
                  : cIdx === 5 
                    ? { width: "11.9933px" } 
                    : {}
              }
            >
              <div
                className={`w-[1px] h-full transition-colors bg-transparent group-hover/resizer:bg-accent/40 ${resizingCol?.key === col.key ? "bg-accent" : ""}`}
              />
            </div>
          )}
        </th>
      );
    };

    return (
      <>
        <div
          id="table-card"
          ref={tableRef}
          className={`table-container data-table-wrapper flex flex-col flex-1 min-h-0 w-full max-w-full outline-none overflow-hidden relative ${className || ""} ${hasActiveFilters ? "bg-amber-50/[0.005]" : ""}`}
          style={
            {
              borderColor: hasActiveFilters ? "#fbbf24" : "var(--border, #E7DBDC)",
              borderWidth: "0px",
              borderStyle: "none",
              borderRadius: "0px",
              backgroundColor: "var(--card, #ffffff)",
              "--table-padding": densityStyles[rowDensity].padding,
              "--font-size": densityStyles[rowDensity].fontSize,
              "--header-font-size": densityStyles[rowDensity].headerFontSize,
              "--table-border-color": borderColorHex,
              ...customStyle,
            } as any
          }
        >
          {/* Selection Action Bar */}
          {selectedRowIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 bg-rose-50/90 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 shrink-0 text-rose-900 dark:text-rose-100 shadow-xs relative z-[130]">
              <div className="flex items-center gap-2 text-xs font-bold">
                <CheckSquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Đã chọn <strong className="tabular-nums text-rose-700 dark:text-rose-300 text-sm">{selectedRowIds.size}</strong> dòng</span>
              </div>
              <div className="flex items-center gap-2">
                {bulkActions?.map((action, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const selectedRows = filteredAndSortedData.filter((row, idx) =>
                        selectedRowIds.has(row.id || idx)
                      );
                      action.onClick(selectedRows);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs ${
                      action.variant === "destructive"
                        ? "bg-rose-600 hover:bg-rose-700 text-white"
                        : "bg-white hover:bg-slate-100 text-[var(--table-column-header-text-color,#1e293b)] border border-slate-300"
                    }`}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}
                {(onDeleteRows || onDeleteRow) && (
                  <button
                    type="button"
                    onClick={() => {
                      const selectedRows = filteredAndSortedData.filter((row, idx) =>
                        selectedRowIds.has(row.id || idx)
                      );
                      if (selectedRows.length === 0) return;
                      setDeleteConfirmState({
                        isOpen: true,
                        title: `Xác nhận xóa ${selectedRows.length} dòng đã chọn?`,
                        description: `Bạn có chắc chắn muốn xóa ${selectedRows.length} dòng dữ liệu này khỏi bảng? Dữ liệu và các số liệu liên quan sẽ được cập nhật lại.`,
                        confirmText: `XÓA ${selectedRows.length} DÒNG`,
                        onConfirm: () => {
                          if (onDeleteRows) {
                            onDeleteRows(selectedRows);
                          } else if (onDeleteRow) {
                            selectedRows.forEach((row, idx) => onDeleteRow(row, idx));
                          }
                          setSelectedRowIds(new Set());
                          setDeleteConfirmState(null);
                        },
                      });
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa {selectedRowIds.size} dòng đã chọn</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRowIds(new Set())}
                  className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 dark:text-rose-400 underline ml-2 cursor-pointer"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
          )}

          {/* BU Filter Bar */}
          {buColumn && !hideBuFilter && (
            <div
              className="bu-filter-bar flex items-center justify-between gap-2 px-3 border-b flex-none overflow-x-auto select-none z-10 h-9 min-h-9 max-h-9"
              style={{
                backgroundColor: "var(--table-sub-header-bg, #EDE4DB)",
                borderColor: borderColorHex,
                height: "36px",
                minHeight: "36px",
                maxHeight: "36px",
                flex: "0 0 36px"
              }}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground mr-1">
                  <Filter className="w-3 h-3 text-primary" />
                  <span>Lọc BU:</span>
                </span>

                {/* Nút Tất cả */}
                <button
                  type="button"
                  onClick={() => handleSetBuFilterMode("ALL")}
                  className={`px-2.5 py-0.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                    buFilterMode === "ALL"
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
                    handleSetBuFilterMode(buFilterMode === "EXCLUDE_AHP" ? "ALL" : "EXCLUDE_AHP")
                  }
                  className={`px-2.5 py-0.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1 whitespace-nowrap ${
                    buFilterMode === "EXCLUDE_AHP"
                      ? "bg-amber-600 text-white shadow-2xs ring-1 ring-amber-600 font-black"
                      : "bg-amber-50/80 hover:bg-amber-100/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60"
                  }`}
                  title="Lọc toàn bộ bảng trừ BU AHP (Hải Phòng)"
                >
                  <span>Trừ AHP</span>
                  {buFilterMode === "EXCLUDE_AHP" && (
                    <span className="text-[8.5px] font-black bg-white/25 px-1 rounded">Đang lọc</span>
                  )}
                </button>
              </div>

              {/* Counter & quick reset */}
              <div className="flex items-center gap-2 text-[10.5px] font-medium text-muted-foreground ml-auto shrink-0 whitespace-nowrap">
                <span className="tabular-nums">
                  {buFilterMode !== "ALL" ? (
                    <span>
                      Đang lọc BU: <strong className="text-primary font-bold">{filteredAndSortedData.length}</strong> / {data.length} dòng
                    </span>
                  ) : (
                    <span>{filteredAndSortedData.length} dòng</span>
                  )}
                </span>
                {buFilterMode !== "ALL" && (
                  <button
                    type="button"
                    onClick={() => handleSetBuFilterMode("ALL")}
                    className="text-[10px] text-rose-600 hover:text-rose-700 font-bold hover:underline cursor-pointer flex items-center gap-0.5 ml-1"
                    title="Bỏ lọc BU (Hiện tất cả)"
                  >
                    <X className="w-3 h-3" />
                    Bỏ lọc
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active Individual Overlap Banner */}
          {individualOverlap && (
            <div
              className="individual-overlap-banner flex items-center justify-between gap-3 px-3.5 py-2 border-b select-none z-15 shrink-0 text-xs transition-all animate-in fade-in slide-in-from-top-1 duration-200"
              style={{
                backgroundColor: "var(--table-overlap-banner-bg, rgba(255, 241, 242, 0.96))",
                borderColor: "var(--table-overlap-banner-border, #fecdd3)",
              }}
            >
              <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold min-w-0">
                <span className="flex h-2 w-2 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                </span>
                <span className="text-[11px] uppercase tracking-wider text-rose-800 dark:text-rose-300 font-black shrink-0">
                  Đang lọc trùng lịch cá nhân:
                </span>
                <span className="font-extrabold text-[11px] bg-rose-100 dark:bg-rose-900/60 text-rose-900 dark:text-rose-100 px-2 py-0.5 rounded-md border border-rose-300/80 dark:border-rose-800 shadow-2xs truncate">
                  {individualOverlap.full_name ? `${individualOverlap.full_name} (${individualOverlap.ma_nv})` : individualOverlap.ma_nv} • Ngày {individualOverlap.ngay}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleClearIndividualOverlap}
                  className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold shadow-2xs transition-all cursor-pointer active:scale-95"
                  title="Thoát khỏi trùng lịch của cá nhân này nhưng vẫn giữ nguyên chế độ lọc cột"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Thoát trùng lịch cá nhân</span>
                </button>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 dark:bg-card dark:hover:bg-muted text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-bold border border-slate-300 dark:border-slate-700 cursor-pointer shadow-2xs transition-all active:scale-95"
                  title="Xóa tất cả bộ lọc"
                >
                  <span>Xóa lọc</span>
                </button>
              </div>
            </div>
          )}

          {/* Table Scroll Container — virtual scrolling host */}
          <div
            ref={scrollContainerRef}
            tabIndex={0}
            className="table-body-region relative mb-0 min-h-0 w-full max-w-full flex-1 overflow-x-auto overflow-y-auto bg-transparent opacity-100 outline-none custom-scrollbar"
            onFocus={() => !activeCell && setActiveCellWithSource({ r: 0, c: 0 }, "keyboard")}
            onMouseMove={handleTableMouseMove}
            style={{ 
              overscrollBehavior: "contain",
              marginBottom: "0px", 
              overflowAnchor: "none",
              borderRadius: '0px',
              borderStyle: 'none',
              borderWidth: "0.4px",
              paddingLeft: "0px",
              paddingRight: "0px",
              paddingTop: "0px",
              paddingBottom: "0px",
              ...scrollContainerStyle,
            }}
          >
            {resizingLineLeft !== null && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-accent z-[100] pointer-events-none"
                style={{
                  left: resizingLineLeft,
                }}
              />
            )}

            <table
              className={`border-separate border-spacing-0 table-fixed bg-white ${isSelecting ? "select-none" : ""}`}
              style={{
                width: "100%",
                minWidth: totalTableWidth,
                minHeight: paginatedData.length === 0 ? 400 : 0,
                borderWidth: '0px',
                ...tableStyle,
              }}
            >
              <colgroup>
                {selectable && <col style={{ width: 40 }} />}
                {isRowNumberVisible && <col style={{ width: 50 }} />}
                {visibleColumns.map((col) => {
                  const colWidth = columnWidths[col.key] || col.width || 150;
                  const widthStyle = colWidth
                    ? typeof colWidth === "number"
                      ? `${colWidth}px`
                      : colWidth
                    : "150px";
                  return (
                    <col key={`col-${col.key}`} style={{ width: widthStyle }} />
                  );
                })}
              </colgroup>
              <thead className={stickyHeader ? "sticky top-0 z-[120] bg-[var(--table-column-header-bg,#F4ECD8)]" : ""}>
                {/* Grouped Headers Row if any column has a group defined */}
                {columns.some(c => c.group) && (
                  <tr className="bg-[var(--table-column-header-bg,#F4ECD8)]">
                    {selectable && (
                      <th
                        rowSpan={2}
                        className={`${stickyFirstColumn ? "sticky-col-selectable sticky-header-col" : ""} w-10 border-r ${borderClass} text-center ${headerClassName ? headerClassName : "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` border-b border-[var(--table-border-color,#e7dbdc)] text-[var(--header-font-size,0.65rem)] font-bold uppercase text-[var(--table-column-header-text-color,#1e293b)] whitespace-normal align-middle`}
                        style={{ 
                          padding: "var(--table-padding, 0.25rem 0.4rem)", 
                          paddingTop: "5px", 
                          paddingBottom: "4px", 
                          backgroundColor: "var(--table-column-header-bg, #F4ECD8)",
                          ...(stickyFirstColumn ? { left: 0 } : {})
                        }}
                      >
                        <div className="flex items-center justify-center gap-1 group/no">
                          <button
                            onClick={toggleAll}
                            className="flex items-center justify-center hover:text-accent transition-colors"
                          >
                            {selectedRowIds.size > 0 &&
                            selectedRowIds.size === filteredAndSortedData.length ? (
                              <div className="w-5 h-5 bg-accent rounded-md flex items-center justify-center border border-accent shadow-sm transition-transform active:scale-95">
                                <CheckSquare className="w-3.5 h-3.5 text-white" />
                              </div>
                            ) : selectedRowIds.size > 0 ? (
                              <div className="w-5 h-5 bg-accent/10 rounded-md flex items-center justify-center border border-accent/40 shadow-sm transition-transform active:scale-95">
                                <Minus className="w-3 h-3 text-accent" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 border-2 border-accent/20 bg-white rounded-md hover:border-accent/50 transition-colors" />
                            )}
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); autoFitAllColumns(); }}
                            className="opacity-0 group-hover/no:opacity-100 transition-opacity p-0.5 hover:bg-accent/10 rounded text-accent ml-1"
                            title="Tự động căn chỉnh tất cả cột"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                    )}
                    {isRowNumberVisible && (
                      <th
                        rowSpan={2}
                        className={`${stickyFirstColumn ? "sticky-col-row-number" : ""} sticky-header-col w-[50px] border-r ${borderClass} text-center ${headerClassName ? headerClassName : "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` border-b border-[var(--table-border-color,#e7dbdc)] text-[var(--header-font-size,0.65rem)] font-bold text-[var(--table-column-header-text-color,#1e293b)] whitespace-normal align-middle`}
                        style={{ 
                          padding: "var(--table-padding, 0.25rem 0.4rem)", 
                          paddingTop: "5px", 
                          paddingBottom: "4px", 
                        backgroundColor: "var(--table-column-header-bg, #F4ECD8)",
                        textTransform: "none",
                          ...(stickyFirstColumn ? { left: selectable ? 40 : 0 } : {})
                        }}
                      >
                        <div className="flex items-center justify-center gap-1 group/no">
                          <span>No.</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); autoFitAllColumns(); }}
                            className="opacity-0 group-hover/no:opacity-100 transition-opacity p-0.5 hover:bg-accent/10 rounded text-accent"
                            title="Tự động căn chỉnh tất cả cột"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                    )}
                    {(() => {
                      const groupings: { group: string | undefined, count: number, startIdx: number }[] = [];
                      visibleColumns.forEach((col, idx) => {
                        const last = groupings[groupings.length - 1];
                        if (last && col.group && last.group === col.group) {
                          last.count++;
                        } else {
                          groupings.push({ group: col.group, count: 1, startIdx: idx });
                        }
                      });

                      return groupings.map((g, idx) => {
                        if (g.group) {
                          const groupBg = groupColorMap.get(g.group) || headerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]";
                          return (
                            <th 
                              key={idx} 
                              colSpan={g.count}
                              className={`has-group ${groupBg} border-r ${borderClass} py-2 leading-normal text-[var(--header-font-size,0.65rem)] font-bold uppercase text-center border-b border-[var(--table-border-color,#e7dbdc)] whitespace-normal align-middle text-[var(--table-column-header-text-color,#1e293b)]`}
                              style={{ color: "var(--table-column-header-text-color, var(--table-column-header-text, #1e293b))" }}
                            >
                              {g.group}
                            </th>
                          );
                        } else {
                          // Individual column with no group - rendering rowSpan=2
                          return renderHeaderCell(visibleColumns[g.startIdx], g.startIdx, 2);
                        }
                      });
                    })()}
                  </tr>
                )}
                <tr className={headerClassName ? "" : "bg-[var(--table-column-header-bg,#F4ECD8)] text-[var(--table-column-header-text-color,#1e293b)]"}>
                  {selectable && !columns.some(c => c.group) && (
                    <th
                      className={`${stickyFirstColumn ? "sticky-col-selectable sticky-header-col" : ""} w-10 border-r ${borderClass} text-center ${headerClassName ? headerClassName : "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` border-b border-[var(--table-border-color,#e7dbdc)] text-[var(--header-font-size,0.65rem)] font-bold uppercase text-[var(--table-column-header-text-color,#1e293b)] whitespace-normal align-middle`}
                      style={{ 
                        padding: "var(--table-padding, 0.25rem 0.4rem)", 
                        paddingTop: "5px", 
                        paddingBottom: "4px", 
                        backgroundColor: "var(--table-column-header-bg, #F4ECD8)",
                        ...(stickyFirstColumn ? { left: 0 } : {})
                      }}
                    >
                        <div className="flex items-center justify-center gap-1 group/no">
                          <button
                            onClick={toggleAll}
                            className="flex items-center justify-center hover:text-accent transition-colors"
                          >
                            {selectedRowIds.size > 0 &&
                            selectedRowIds.size === filteredAndSortedData.length ? (
                              <div className="w-5 h-5 bg-accent rounded-md flex items-center justify-center border border-accent shadow-sm transition-transform active:scale-95">
                                <CheckSquare className="w-3.5 h-3.5 text-white" />
                              </div>
                            ) : selectedRowIds.size > 0 ? (
                              <div className="w-5 h-5 bg-accent/10 rounded-md flex items-center justify-center border border-accent/40 shadow-sm transition-transform active:scale-95">
                                <Minus className="w-3 h-3 text-accent" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 border-2 border-accent/20 bg-white rounded-md hover:border-accent/50 transition-colors" />
                            )}
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); autoFitAllColumns(); }}
                            className="opacity-0 group-hover/no:opacity-100 transition-opacity p-0.5 hover:bg-accent/10 rounded text-accent ml-1"
                            title="Tự động căn chỉnh tất cả cột"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                        </div>
                    </th>
                  )}
                  {isRowNumberVisible && !columns.some(c => c.group) && (
                    <th
                      className={`${stickyFirstColumn ? "sticky-col-row-number sticky-header-col" : ""} w-[50px] border-r ${borderClass} text-center ${headerClassName ? headerClassName : "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` border-b border-[var(--table-border-color,#e7dbdc)] text-[var(--header-font-size,0.65rem)] font-bold text-[var(--table-column-header-text-color,#1e293b)] whitespace-normal align-middle`}
                      style={{ 
                        padding: "var(--table-padding, 0.25rem 0.4rem)", 
                        paddingTop: "5px", 
                        paddingBottom: "4px", 
                          backgroundColor: "var(--table-column-header-bg, #F4ECD8)",
                          textTransform: "none",
                        ...(stickyFirstColumn ? { left: selectable ? 40 : 0 } : {})
                      }}
                    >
                      <div className="flex items-center justify-center gap-1 group/no">
                        <span>No.</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); autoFitAllColumns(); }}
                          className="opacity-0 group-hover/no:opacity-100 transition-opacity p-0.5 hover:bg-accent/10 rounded text-accent"
                          title="Tự động căn chỉnh tất cả cột"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                      </div>
                    </th>
                  )}
                  {visibleColumns.map((col, cIdx) => {
                    // Skip rendering if it was already rendered via rowSpan=2 in the group row (only if grouping is present)
                    if (columns.some(c => c.group) && !col.group) return null;
                    
                    return renderHeaderCell(col, cIdx, 1, columns.some(c => c.group));
                  })}
                </tr>
              </thead>
              <tbody className="border-primary/5">
                {/* Top spacer */}
                {vsTopPad > 0 && (
                  <tr style={{ height: `${vsTopPad}px` }} aria-hidden="true">
                    <td
                      colSpan={visibleColumns.length + (selectable ? 1 : 0) + (isRowNumberVisible ? 1 : 0)}
                      style={{ height: `${vsTopPad}px`, padding: 0, border: "none" }}
                    />
                  </tr>
                )}

                {filteredAndSortedData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length + (selectable ? 1 : 0) + (isRowNumberVisible ? 1 : 0)}
                      className="p-0 border-none relative h-[400px]"
                    >
                      <div
                        className="sticky left-0 flex flex-col items-center justify-center gap-6"
                        style={{ width: vsContainerWidth, height: 400 }}
                      >
                        <div className="w-24 h-24 bg-primary/5 rounded-[32px] flex items-center justify-center border-2 border-dashed border-primary/20">
                          <Search className="w-10 h-10 text-primary/20" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <p
                            className="text-lg font-black uppercase tracking-[0.2em] text-primary/80"
                            style={{ fontFamily: "Verdana" }}
                          >
                            {searchTerm
                              ? "Không tìm thấy kết quả"
                              : "Dữ liệu trống"}
                          </p>
                          <p className="text-foreground/40 font-bold text-[0.625rem] uppercase tracking-[0.3em] max-w-[300px] leading-relaxed text-center">
                            {searchTerm ? (
                              <>
                                Không khớp với từ khóa{" "}
                                <span className="text-primary">
                                  "{searchTerm}"
                                </span>
                              </>
                            ) : (
                              "Vui lòng tải file hoặc phân phối dữ liệu từ bảng Data"
                            )}
                          </p>
                        </div>
                        { (searchTerm || Object.values(columnFilters).some(v => !!v)) && (
                          <button
                            onClick={clearAllFilters}
                            className="px-6 py-2.5 rounded-xl border-2 border-primary text-primary font-black text-[0.625rem] uppercase tracking-widest hover:bg-primary hover:text-white transition-all active:scale-95"
                          >
                            Xóa tất cả bộ lọc
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  virtualItems.map((vi) => {
                    const row = paginatedData[vi.index];
                    return (
                    <DataRow
                      key={row.id ?? vi.index}
                      row={row}
                      rIdx={itemsPerPage === Infinity ? vi.index : (currentPage - 1) * itemsPerPage + vi.index}
                      selectable={selectable}
                      showRowNumber={isRowNumberVisible}
                      selectedRowIds={selectedRowIds}
                      activeCell={activeCell}
                      selectionRange={selectionRange}
                      editingCell={editingCell}
                      editValue={editValue}
                      visibleColumns={visibleColumns}
                      columnWidths={columnWidths}
                      isEditable={isEditable}
                      onCellChange={onCellChange}
                      toggleRow={toggleRow}
                      startEditing={rowEventHandlers.startEditing}
                      handleCellMouseDown={rowEventHandlers.handleCellMouseDown}
                      handleCellMouseEnter={rowEventHandlers.handleCellMouseEnter}
                      handleContextMenu={rowEventHandlers.handleContextMenu}
                      handleEditorKeyDown={rowEventHandlers.handleEditorKeyDown}
                      setEditValue={setEditValue}
                      commitEdit={commitEdit}
                      cancelEdit={cancelEdit}
                      formatValue={formatValue}
                      getAlignment={getAlignment}
                      inputRef={inputRef}
                      rowHeight={rowHeight}
                      setRowHeight={setRowHeight}
                      striped={striped}
                      onRowClick={onRowClick}
                      borderClass={borderClass}
                      stickyFirstColumn={stickyFirstColumn}
                    />
                  );
                  })
                )}

                {/* Bottom spacer */}
                {vsBottomPad > 0 && (
                  <tr style={{ height: `${vsBottomPad}px` }} aria-hidden="true">
                    <td
                      colSpan={visibleColumns.length + (selectable ? 1 : 0) + (isRowNumberVisible ? 1 : 0)}
                      style={{ height: `${vsBottomPad}px`, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
              </tbody>
              {showFooter && (
                <tfoot
                  className="sticky bottom-0 z-30"
                  style={{
                    willChange: "transform",
                    boxShadow: "0 -3px 12px rgba(0,0,0,0.08)",
                  }}
                >
                  <tr
                    className={`${footerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` ${(footerClassName || "").includes("text-") ? "" : "text-[var(--table-column-header-text-color,#1e293b)]"} font-bold total-row border-t-2 border-[var(--border,#d1d5db)]`}
                  >
                    {selectable && (
                      <td
                        className={`border-b border-t-2 border-r-0 border-l-0 border-[var(--border,#d1d5db)] ${footerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` ${(footerClassName || "").includes("text-") ? "" : "text-[var(--table-column-header-text-color,#1e293b)]"} font-bold ${stickyFirstColumn ? "sticky-col-selectable sticky-footer-col" : "sticky-footer-col"} total-row`}
                        style={{
                          position: "sticky",
                          bottom: 0,
                          zIndex: stickyFirstColumn ? 45 : 30,
                          width: "40px",
                          minWidth: "40px",
                          maxWidth: "40px",
                          ...(stickyFirstColumn ? { left: 0 } : {}),
                          backgroundColor: "var(--table-column-header-bg, #F4ECD8)"
                        }}
                      />
                    )}
                    {isRowNumberVisible && (
                      <td
                        className={`border-b border-t-2 border-r-0 border-l-0 border-[var(--border,#d1d5db)] ${footerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` ${(footerClassName || "").includes("text-") ? "" : "text-[var(--table-column-header-text-color,#1e293b)]"} font-bold ${stickyFirstColumn ? "sticky-col-row-number sticky-footer-col" : "sticky-footer-col"} total-row`}
                        style={{
                          position: "sticky",
                          bottom: 0,
                          zIndex: stickyFirstColumn ? 45 : 30,
                          width: "50px",
                          minWidth: "50px",
                          maxWidth: "50px",
                          ...(stickyFirstColumn ? { left: selectable ? 40 : 0 } : {}),
                          backgroundColor: "var(--table-column-header-bg, #F4ECD8)"
                        }}
                      />
                    )}
                    {(() => {
                      const colIsNumericList = visibleColumns.map((col) => {
                        const effectiveType = columnTypes[col.key] || col.type;
                        if (col.showGrandTotal === false) return false;
                        if (isProtectedNumericColumn(col.key)) return false;
                        if (isNonSummableTextColumn(col.key)) return false;
                        let colIsNumeric =
                          isChargeAmountColumn(col.key) ||
                          effectiveType === "number" ||
                          effectiveType === "currency" ||
                          effectiveType === "money";
                        
                        if (
                          !colIsNumeric &&
                          effectiveType !== "label" &&
                          effectiveType !== "date" &&
                          filteredAndSortedData.length > 0 &&
                          col.key !== "STT" &&
                          col.key !== "stt"
                        ) {
                          let numericCount = 0;
                          let totalValCount = 0;
                          const sampleSize = Math.min(20, filteredAndSortedData.length);
                          for (let i = 0; i < sampleSize; i++) {
                            const r = filteredAndSortedData[i];
                            if (r) {
                              const rawVal = r[col.key];
                              if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
                                totalValCount++;
                                if (looksLikeNumericValue(rawVal)) {
                                  numericCount++;
                                }
                              }
                            }
                          }
                          if (totalValCount > 0 && numericCount / totalValCount > 0.7) {
                            colIsNumeric = true;
                          }
                        }
                        return colIsNumeric;
                      });

                      // Find first column that is numeric AND has a grand total
                      const firstNumericColIdx = visibleColumns.findIndex((col, idx) => {
                        const colIsNumeric =
                          col.showGrandTotal !== false &&
                          !isProtectedNumericColumn(col.key) &&
                          !isNonSummableTextColumn(col.key) &&
                          (colIsNumericList[idx] || (col as any).showGrandTotal);
                        return colIsNumeric && footerTotals[col.key] != null;
                      });

                      // Span all non-numeric leading columns for the "TỔNG CỘNG" label so it is never cut off
                      const labelColSpan =
                        firstNumericColIdx > 0
                          ? firstNumericColIdx
                          : firstNumericColIdx === -1
                            ? visibleColumns.length
                            : 1;

                      // Combined width for the merged label columns
                      let mergedLabelWidth = 0;
                      for (let i = 0; i < labelColSpan; i++) {
                        const w = Number(columnWidths[visibleColumns[i].key] || visibleColumns[i].width || 100);
                        mergedLabelWidth += w;
                      }

                      return visibleColumns.map((col: any, cIdx: number) => {
                        // Skip rendering columns merged into the leading label cell
                        if (cIdx > 0 && cIdx < labelColSpan) {
                          return null;
                        }

                        const colIsNumeric =
                          col.showGrandTotal !== false &&
                          !isProtectedNumericColumn(col.key) &&
                          !isNonSummableTextColumn(col.key) &&
                          (colIsNumericList[cIdx] ||
                            (col as any).showGrandTotal);
                        const grandTotal = footerTotals[col.key];

                        const isFirstDataCol = cIdx === 0;
                        const isMergedLabel = isFirstDataCol && labelColSpan > 1;

                        const colWidth = isMergedLabel
                          ? mergedLabelWidth
                          : columnWidths[col.key] || col.width;

                        const widthStyle = colWidth
                          ? typeof colWidth === "number"
                            ? `${colWidth}px`
                            : colWidth
                          : undefined;

                        const countSuffix = ` (${filteredAndSortedData.length} dòng)`;
                        const fullLabel = `TỔNG CỘNG${countSuffix}`;
                        const labelText = mergedLabelWidth >= 160 || labelColSpan > 1
                          ? fullLabel
                          : "TỔNG CỘNG";

                        return (
                          <td
                            key={`footer-grand-${col.key}`}
                            colSpan={isMergedLabel ? labelColSpan : 1}
                            title={isFirstDataCol ? fullLabel : undefined}
                            className={`whitespace-nowrap font-extrabold border-b border-t-2 border-r-0 border-l-0 border-[var(--border,#d1d5db)] ${isFirstDataCol ? "text-left pl-3" : getAlignment(col)} uppercase text-[12.5px] md:text-[13px] ${footerClassName || "bg-[var(--table-column-header-bg,#F4ECD8)]"}` + ` ${(footerClassName || "").includes("text-") ? "" : "text-[var(--table-column-header-text-color,inherit)]"} ${col.footerClassName || ""} ${stickyFirstColumn && isFirstDataCol ? "sticky-col-first-data sticky-footer-col" : ""} total-row`}
                            style={{
                              padding: "var(--table-padding, 0.2rem 0.6rem)",
                              paddingTop: "5px",
                              paddingBottom: "5px",
                              fontFamily: "var(--font-table, var(--font-main))",
                              fontSize: "var(--font-size, 13px)",
                              width: widthStyle,
                              minWidth: widthStyle,
                              maxWidth: isMergedLabel ? undefined : widthStyle,
                              overflow: isMergedLabel ? "visible" : "hidden",
                              textOverflow: "ellipsis",
                              position: "sticky",
                              bottom: 0,
                              zIndex: (stickyFirstColumn && isFirstDataCol) ? 45 : 30,
                              backgroundColor: "var(--table-column-header-bg, #F4ECD8)",
                              ...((stickyFirstColumn && isFirstDataCol) ? {
                                left: (selectable ? 40 : 0) + (isRowNumberVisible ? 50 : 0),
                              } : {})
                            }}
                          >
                            {isFirstDataCol
                              ? (colIsNumeric && firstNumericColIdx === 0 && grandTotal != null
                                  ? `TỔNG: ${formatValue(grandTotal, col.type === "number" ? "number" : "currency")}`
                                  : labelText)
                              : (colIsNumeric && col.key !== "STT" && col.key !== "stt" && grandTotal != null
                                  ? formatValue(grandTotal, col.type === "number" ? "number" : "currency")
                                  : "")}
                          </td>
                        );
                      });
                    })()}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

            {/* Footer — Floating Card Style mimicking payment page */}
          {showPagination && (
          <div
            className="flex items-center justify-between shrink-0 z-40 relative table-footer-pagination border-t border-border"
            style={{
              height: "52px",
              borderWidth: "1px",
              borderStyle: "solid",
              borderRadius: "0px",
              borderColor: "var(--border, #E7DBDC)",
              backgroundColor: "var(--table-footer-bg, var(--table-header-bg, #FAF3E8))",
              marginTop: "0px",
              marginBottom: "0px",
              marginRight: "0px",
              marginLeft: "0px",
              boxShadow: "none",
              paddingRight: "12px",
              paddingLeft: "12px",
              paddingTop: "6px",
              paddingBottom: "6px"
            }}
          >
            <div className="flex items-center gap-3 px-3" style={{ paddingLeft: "12px" }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-slate-600 whitespace-nowrap ml-2">
                  Hiển thị:
                </span>
                <Select
                  value={itemsPerPage === Infinity ? "all" : String(itemsPerPage)}
                  onValueChange={(val) => {
                    setItemsPerPage(val === "all" ? Infinity : Number(val));
                    setCurrentPage(1);
                    scrollContainerRef.current?.scrollTo({ top: 0 });
                  }}
                >
                  <SelectTrigger className="rounded-full px-2.5 text-[12px] font-bold font-sans normal-case text-slate-700 border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs h-[22px] py-0" style={{ height: "22px", width: "96.9912px", fontSize: "12px", lineHeight: "16px" }}>
                    <SelectValue placeholder="Chọn..." className="font-sans normal-case text-[12px]" />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--popover)] border-[#e7dbdc] z-[99999] opacity-100 font-sans">
                    <SelectItem value="10" className="text-[12px] font-medium font-sans normal-case">10 dòng</SelectItem>
                    <SelectItem value="20" className="text-[12px] font-medium font-sans normal-case">20 dòng</SelectItem>
                    <SelectItem value="50" className="text-[12px] font-medium font-sans normal-case">50 dòng</SelectItem>
                    <SelectItem value="100" className="text-[12px] font-medium font-sans normal-case">100 dòng</SelectItem>
                    <SelectItem value="all" className="text-[12px] font-medium font-sans normal-case">Tất cả</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Column Visibility Toggle moved to footer - Icon button only */}
              {!hideColumnVisibilityToggle && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-all shadow-3xs cursor-pointer w-[26px] h-[26px] p-0 active:scale-95 shrink-0"
                    title={`Ẩn/Hiện Cột (${visibleColumns.length + (isRowNumberVisible ? 1 : 0)}/${allDropdownColumns.length})`}
                    aria-label="Ẩn/Hiện Cột"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-60 max-h-[350px] overflow-y-auto bg-popover dark:bg-[var(--card)] opacity-100 z-[99999] border-[#e7dbdc] shadow-2xl p-1 rounded-xl">
                  <DropdownMenuLabel className="text-[12px] font-bold text-foreground/70 uppercase px-2 py-1.5">
                    Cột hiển thị ({visibleColumns.length + (isRowNumberVisible ? 1 : 0)}/${allDropdownColumns.length})
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      const allVisible = allDropdownColumns.every((c) => !effectiveHiddenColumns.has(c.key));
                      if (allVisible) {
                        setHiddenColumns(new Set(allDropdownColumns.map((c) => c.key)));
                        setShownAutoHiddenColumns(new Set());
                      } else {
                        setHiddenColumns(new Set());
                        setShownAutoHiddenColumns(new Set(autoHiddenColumns));
                      }
                    }}
                    className="flex items-center justify-between text-[12px] font-bold cursor-pointer text-primary py-1.5 px-2 rounded-lg hover:bg-primary/5"
                  >
                    <span>{allDropdownColumns.every((c) => !effectiveHiddenColumns.has(c.key)) ? "Ẩn tất cả" : "Hiển thị tất cả"}</span>
                    {allDropdownColumns.every((c) => !effectiveHiddenColumns.has(c.key)) ? (
                      <Eye className="w-3.5 h-3.5 text-primary shrink-0" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {allDropdownColumns.map((col) => (
                    <DropdownMenuItem
                      key={col.key}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleColumn(col.key);
                      }}
                      className="flex items-center justify-between text-[12px] cursor-pointer py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="flex min-w-0 items-center gap-2 pr-2">
                        <span className="truncate font-medium text-[12px]">{col.label}</span>
                        {autoHiddenColumns.has(col.key) && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            Tổng = 0
                          </span>
                        )}
                      </span>
                      {!effectiveHiddenColumns.has(col.key) ? (
                        <Eye className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              )}

              {footerActionContent}

              {(() => {
                const shouldHide =
                  hideSaveStatus ||
                  storageKey === "analys_hold_lifecycle_v12" ||
                  storageKey?.includes("analys") ||
                  storageKey?.includes("timesheet") ||
                  storageKey?.includes("roster") ||
                  storageKey?.includes("center") ||
                  storageKey?.includes("employee") ||
                  (typeof window !== "undefined" &&
                    (window.location.pathname.includes("audit") ||
                      window.location.pathname.includes("centers") ||
                      window.location.pathname.includes("timesheet")));

                if (shouldHide && !footerStatusContent) {
                  return null;
                }

                return (
                  <div 
                    className="flex items-center gap-1.5 hidden md:flex border-l border-slate-100 pl-3"
                    style={{
                      marginRight: "0px",
                      marginBottom: "0px",
                      marginTop: "3px",
                      height: "36.9953px"
                    }}
                  >
                    {footerStatusContent || (
                      <SaveStatusCard
                        scope={storageKey === "bulk_payment" ? "transaction" : "default"}
                        className="!px-1.5 !py-0.5 !rounded-[10px] bg-slate-50 border border-[#e7dbdc]/80 shadow-none gap-1 ml-1"
                        style={{
                          paddingLeft: "0px",
                          paddingRight: "0px",
                          marginRight: "12px"
                        }}
                        textStyle={{
                          fontFamily: "inherit",
                          fontWeight: "600",
                          fontSize: "12px",
                          color: "#475569",
                        }}
                        iconStyle={{
                          width: "12px",
                          height: "12px",
                          color: "#475569",
                        }}
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Pagination Controls - Direct, high-fidelity tactile buttons */}
            <div className="flex items-center gap-1 px-3 border-l border-slate-200 pl-4 h-6">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage(1);
                  scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex items-center justify-center w-7 h-7 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-white disabled:cursor-not-allowed transition-all shadow-3xs active:scale-95 cursor-pointer select-none"
                title="Trang đầu"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage((p) => Math.max(1, p - 1));
                  scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex items-center justify-center w-7 h-7 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-white disabled:cursor-not-allowed transition-all shadow-3xs active:scale-95 cursor-pointer select-none"
                title="Trang trước"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              
              <span 
                className="px-3 font-display uppercase tracking-widest whitespace-nowrap text-center min-w-[90px] text-slate-700/80"
                style={{ fontWeight: "normal", fontSize: "12px", lineHeight: "16px" }}
              >
                TRANG {currentPage} / {totalPages || 1}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages || totalPages === 0}
                onClick={() => {
                  setCurrentPage((p) => Math.min(totalPages, p + 1));
                  scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex items-center justify-center w-7 h-7 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-white disabled:cursor-not-allowed transition-all shadow-3xs active:scale-95 cursor-pointer select-none"
                title="Trang sau"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages || totalPages === 0}
                onClick={() => {
                  setCurrentPage(totalPages);
                  scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex items-center justify-center w-7 h-7 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-white disabled:cursor-not-allowed transition-all shadow-3xs active:scale-95 cursor-pointer select-none"
                title="Trang cuối"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
            </div>
          )}

          {operationStatus && (
            <div className="absolute bottom-16 right-6 z-[120] bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg shadow border border-emerald-200 text-xs font-bold tracking-wide flex items-center gap-2 pointer-events-none animate-in slide-in-from-bottom-2 fade-in">
              <CheckCircle2 className="w-4 h-4" />
              {operationStatus}
            </div>
          )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] bg-white/90 backdrop-blur-md shadow-hard py-1 min-w-[180px] rounded border-2 border-primary overflow-hidden animate-in fade-in zoom-in slide-in-from-top-2 duration-150"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[0.5625rem] font-black uppercase tracking-widest text-primary/40 mb-1 border-b border-primary/10">
              Thao tác nhanh
            </div>

            {contextMenu.r !== -1 && (
              <>
                <button
                  onClick={() => {
                    const row = filteredAndSortedData[contextMenu.r];
                    const col = visibleColumns[contextMenu.c];
                    const valStr = getClipboardCellValue(row, col);
                    navigator.clipboard.writeText(valStr);
                    closeContextMenu();
                  }}
                  className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
                >
                  <Copy className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
                  <span>Sao chép giá trị ô</span>
                </button>

                <button
                  onClick={() => {
                    if (onCellChange) {
                      if (selectionRange) {
                        const minR = Math.min(selectionRange.startR, selectionRange.endR);
                        const maxR = Math.max(selectionRange.startR, selectionRange.endR);
                        const minC = Math.min(selectionRange.startC, selectionRange.endC);
                        const maxC = Math.max(selectionRange.startC, selectionRange.endC);
                        
                        for (let r = minR; r <= maxR; r++) {
                          for (let c = minC; c <= maxC; c++) {
                            const row = filteredAndSortedData[r];
                            onCellChange(row, visibleColumns[c].key, "");
                          }
                        }
                        showStatus("Đã xóa dữ liệu các ô được chọn");
                      } else {
                        const row = filteredAndSortedData[contextMenu.r];
                        onCellChange(row, visibleColumns[contextMenu.c].key, "");
                        showStatus("Đã xóa dữ liệu ô");
                      }
                    }
                    closeContextMenu();
                  }}
                  className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group text-destructive hover:text-destructive"
                >
                  <Eraser className="w-3.5 h-3.5 text-destructive/40 group-hover:text-destructive transition-colors" />
                  <span>{selectionRange && (Math.abs(selectionRange.endR - selectionRange.startR) > 0 || Math.abs(selectionRange.endC - selectionRange.startC) > 0) ? "Xóa giá trị vùng chọn" : "Xóa giá trị ô"}</span>
                </button>

                <button
                  onClick={() => {
                    if (onDeleteSelection && selectionRange && (Math.abs(selectionRange.endR - selectionRange.startR) > 0 || Math.abs(selectionRange.endC - selectionRange.startC) > 0)) {
                       const startR = Math.min(selectionRange.startR, selectionRange.endR);
                       const endR = Math.max(selectionRange.startR, selectionRange.endR);
                       const startC = Math.min(selectionRange.startC, selectionRange.endC);
                       const endC = Math.max(selectionRange.startC, selectionRange.endC);
                       const rowCount = endR - startR + 1;
                       setDeleteConfirmState({
                         isOpen: true,
                         title: `Xác nhận xóa vùng chọn (${rowCount} dòng)?`,
                         description: `Bạn có chắc chắn muốn xóa dữ liệu các dòng trong vùng chọn (${rowCount} dòng)? Thao tác này sẽ cập nhật lại số liệu bảng.`,
                         confirmText: `XÓA ${rowCount} DÒNG`,
                         onConfirm: () => {
                           onDeleteSelection({
                             startR,
                             endR,
                             startC,
                             endC,
                           });
                           setSelectionRange(null);
                           setDeleteConfirmState(null);
                         },
                       });
                    } else if (onDeleteRows && selectionRange && Math.abs(selectionRange.endR - selectionRange.startR) > 0) {
                        const minR = Math.min(selectionRange.startR, selectionRange.endR);
                        const maxR = Math.max(selectionRange.startR, selectionRange.endR);
                        const rowsToDelete: any[] = [];
                        for (let r = minR; r <= maxR; r++) {
                            rowsToDelete.push(filteredAndSortedData[r]);
                        }
                        setDeleteConfirmState({
                          isOpen: true,
                          title: `Xác nhận xóa ${rowsToDelete.length} dòng đã chọn?`,
                          description: `Bạn có chắc chắn muốn xóa ${rowsToDelete.length} dòng dữ liệu này khỏi bảng?`,
                          confirmText: `XÓA ${rowsToDelete.length} DÒNG`,
                          onConfirm: () => {
                            onDeleteRows(rowsToDelete);
                            setSelectionRange(null);
                            showStatus(`Đã xóa ${rowsToDelete.length} dòng`);
                            setDeleteConfirmState(null);
                          },
                        });
                    } else if (onDeleteRow) {
                      if (selectionRange && Math.abs(selectionRange.endR - selectionRange.startR) > 0) {
                         toast.error("Tính năng xóa nhiều dòng không khả dụng (thiếu onDeleteRows/onDeleteSelection)");
                      } else {
                         const row = filteredAndSortedData[contextMenu.r];
                         setDeleteConfirmState({
                           isOpen: true,
                           title: "Xác nhận xóa dòng này?",
                           description: "Bạn có chắc chắn muốn xóa dòng dữ liệu này khỏi bảng?",
                           confirmText: "XÓA DÒNG NÀY",
                           onConfirm: () => {
                             onDeleteRow(row, contextMenu.r);
                             setDeleteConfirmState(null);
                           },
                         });
                      }
                    } else {
                      toast.error("Tính năng xóa dòng không khả dụng cho bảng này");
                    }
                    closeContextMenu();
                  }}
                  className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive/40 group-hover:text-destructive transition-colors" />
                  <span>{selectionRange && Math.abs(selectionRange.endR - selectionRange.startR) > 0 ? "Xóa những dòng đang chọn" : "Xóa dòng này"}</span>
                </button>

                <button
                  onClick={() => {
                    const col = visibleColumns[contextMenu.c];
                    setFormatModal({ isOpen: true, colKey: col.key });
                    closeContextMenu();
                  }}
                  className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
                >
                  <Type className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
                  <span>Định dạng ô</span>
                </button>

                <button
                  onClick={() => {
                    if (onAddRow) {
                      const targetRow = filteredAndSortedData[contextMenu.r];
                      const actualIdx = targetRow ? data.indexOf(targetRow) : -1;
                      onAddRow(actualIdx >= 0 ? actualIdx : undefined);
                      closeContextMenu();
                    } else {
                      toast.error("Tính năng thêm dòng không khả dụng cho bảng này");
                      closeContextMenu();
                    }
                  }}
                  className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-accent/10 flex items-center gap-2.5 transition-colors group text-accent hover:text-accent/80"
                >
                  <FileText className="w-3.5 h-3.5 text-accent/60 group-hover:text-accent transition-colors" />
                  <span>Thêm dòng mới</span>
                </button>

                <DropdownMenuSeparator className="bg-primary/10 mx-1" />
              </>
            )}

            <button
                  onClick={() => {
                autoFitAllColumns();
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
            >
              <Maximize2 className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
              <span>Tự động căn chỉnh tất cả cột</span>
            </button>
            <button
                  onClick={() => {
                copyColumn(contextMenu.c);
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
            >
              <Copy className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
              <span>Sao chép cột</span>
            </button>
            <button
                  onClick={() => {
                copySelection();
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
            >
              <Table2 className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
              <span>Sao chép vùng chọn</span>
            </button>
            {selectionRange && (
              <button
                  onClick={() => {
                  if (onDeleteSelection) {
                    onDeleteSelection(selectionRange);
                  } else if (onCellChange) {
                    const { startR, endR, startC, endC } = selectionRange;
                    const minR = Math.min(startR, endR),
                      maxR = Math.max(startR, endR);
                    const minC = Math.min(startC, endC),
                      maxC = Math.max(startC, endC);
                    for (let i = minR; i <= maxR; i++) {
                      for (let j = minC; j <= maxC; j++) {
                        const row = filteredAndSortedData[i];
                        onCellChange(row, visibleColumns[j].key, "");
                      }
                    }
                    showStatus(
                      `Đã xóa dữ liệu trong ${(maxR - minR + 1) * (maxC - minC + 1)} ô`,
                    );
                  }
                  closeContextMenu();
                }}
                className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive/40 group-hover:text-destructive transition-colors" />
                <span>Xóa vùng chọn</span>
              </button>
            )}
            <DropdownMenuSeparator className="bg-primary/10 mx-1" />
            <button
                  onClick={() => {
                handleSort(visibleColumns[contextMenu.c].key, "asc");
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
            >
              <ChevronUp className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
              <span>Sắp xếp A-Z</span>
            </button>
            <button
              onClick={() => {
                handleSort(visibleColumns[contextMenu.c].key, "desc");
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-primary/5 flex items-center gap-2.5 transition-colors group"
            >
              <ChevronDown className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
              <span>Sắp xếp Z-A</span>
            </button>
            <button
              onClick={() => {
                setCustomSortOpen(true);
                closeContextMenu();
              }}
              className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-accent/10 flex items-center gap-2.5 transition-colors group text-accent"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-accent/60 group-hover:text-accent transition-colors" />
              <span>Sắp xếp tùy chỉnh (Excel)</span>
            </button>
            {sortConfig.length > 0 && (
              <button
                onClick={() => {
                  setSortConfig([]);
                  closeContextMenu();
                  showStatus("Đã xóa tất cả cấp sắp xếp");
                }}
                className="w-full px-3 py-2 text-left text-[0.625rem] font-black uppercase tracking-wider hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2.5 transition-colors group text-rose-600 hover:text-rose-700"
              >
                <X className="w-3.5 h-3.5 text-rose-500 stroke-[2.5]" />
                <span>Xóa tất cả sắp xếp</span>
              </button>
            )}
          </div>
        )}
        {customSortOpen && (
          <CustomSortDialog
            open={customSortOpen}
            columns={visibleColumns}
            value={sortConfig}
            onOpenChange={setCustomSortOpen}
            onApply={(rules) => {
              setSortConfig(rules);
              showStatus(rules.length > 0 ? `Đã áp dụng ${rules.length} cấp sắp xếp` : "Đã xóa tất cả cấp sắp xếp");
            }}
          />
        )}
        {/* Column Format Dialog */}
        {formatModal && (
          <ColumnFormatDialog
            key={formatModal.colKey}
            isOpen={formatModal.isOpen}
            onClose={() => setFormatModal(null)}
            colKey={formatModal.colKey}
            initialFormat={columnFormats[formatModal.colKey] || {}}
            onSave={(format: { alignment?: "left" | "center" | "right" }) => {
              setColumnFormats((prev) => ({
                ...prev,
                [formatModal.colKey]: format,
              }));
            }}
          />
        )}
        <ConfirmDialog
          isOpen={!!deleteConfirmState?.isOpen}
          onClose={() => setDeleteConfirmState(null)}
          onConfirm={() => {
            if (deleteConfirmState?.onConfirm) {
              deleteConfirmState.onConfirm();
            }
          }}
          title={deleteConfirmState?.title || "Xác nhận xóa dữ liệu?"}
          description={deleteConfirmState?.description || "Bạn có chắc chắn muốn thực hiện thao tác xóa này?"}
          confirmText={deleteConfirmState?.confirmText || "XÓA"}
          variant="destructive"
        />
      </>
    );
  },
);

DataTable.displayName = "DataTable";
