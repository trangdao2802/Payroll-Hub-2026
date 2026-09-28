import { Clock, RefreshCw, Settings } from "lucide-react";
import type { MissingTimesheetCenters } from "../../../hooks/useMissingTimesheetCenters";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

export function TimesheetCenterCount({ coverage }: { coverage: MissingTimesheetCenters }) {
  const description = coverage.centers.length
    ? `Thiếu ${coverage.centers.length}/${coverage.expectedCount} Center có File/Link: ${coverage.centers.join(", ")}`
    : "Không có Center cần đồng bộ; bỏ qua Center đã đồng bộ thành công hoặc chỉ có dữ liệu ngoài thời gian đang lọc";
  return (
    <div className="flex flex-col items-end" title={description} aria-label={description} role="status">
      <span className="text-[9px] font-bold text-foreground/60 uppercase tracking-tighter whitespace-nowrap">CENTER</span>
      <div className="bg-card px-2.5 py-0.5 rounded-md border border-border/60 shadow-2xs min-w-[34px] text-center">
        <span className={`text-xs font-black tabular-nums ${coverage.centers.length ? "text-destructive" : "text-foreground"}`}>
          {coverage.centers.length.toLocaleString("vi-VN")}
        </span>
      </div>
    </div>
  );
}

export function TimesheetCenterSettings({ coverage }: { coverage: MissingTimesheetCenters }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Cài đặt bảng Timesheet" title="Cài đặt bảng Timesheet"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary transition-colors hover:bg-muted active:scale-[0.98]">
          <Settings className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[99999] w-72 bg-card border-border">
        <DropdownMenuLabel>Center thiếu: {coverage.centers.length} / {coverage.expectedCount}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {coverage.centers.length > 0 && (
          <p className="max-h-28 overflow-y-auto px-2 py-1 text-xs leading-relaxed text-muted-foreground">
            {coverage.centers.join(", ")}
          </p>
        )}
        <DropdownMenuItem disabled={coverage.isRefreshing || coverage.centers.length === 0}
          onSelect={() => { void coverage.refreshMissing(); }} className="gap-2 cursor-pointer whitespace-nowrap">
          <RefreshCw className={`h-3.5 w-3.5 ${coverage.isRefreshing ? "animate-spin" : ""}`} />
          {coverage.isRefreshing ? "Refreshing Links TIMESHEET…" : "Refresh Links TIMESHEET"}
        </DropdownMenuItem>
        <div className="mx-2 mt-1 rounded-lg border border-border bg-muted/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Cập nhật gần nhất
            </span>
            <span className="normal-case tracking-normal text-foreground tabular-nums">
              {coverage.latestSyncAt || "Chưa ghi nhận"}
            </span>
          </div>
        </div>
        <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
          Chỉ đồng bộ khi bạn bấm nút. Bỏ qua L07 đã đồng bộ thành công nhưng không có trong bảng, hoặc chỉ có dữ liệu ngoài thời gian đang lọc.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
