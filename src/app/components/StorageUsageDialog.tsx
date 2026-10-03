import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, HardDrive, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  formatStorageBytes,
  formatStorageReport,
  getStorageTotals,
  measurePayrollStorage,
  type PayrollStorageReport,
} from "../lib/utils/storage-usage";

export default function StorageUsageDialog({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<PayrollStorageReport | null>(null);
  const [progress, setProgress] = useState("Chuẩn bị đo dung lượng…");
  const [isMeasuring, setIsMeasuring] = useState(true);
  const [showText, setShowText] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const runMeasurement = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const result = await measurePayrollStorage({ signal: current.signal, onProgress: (label) => { if (!current.signal.aborted) setProgress(label); } });
      if (!current.signal.aborted) setReport(result);
    } catch (error) {
      if (!current.signal.aborted) toast.error(error instanceof Error ? error.message : "Không thể đo dung lượng. Hãy thử lại.");
    } finally {
      if (!current.signal.aborted) setIsMeasuring(false);
    }
  }, []);

  useEffect(() => {
    // Paint the dialog first, then start reading the browser's external store.
    const timer = setTimeout(() => void runMeasurement(), 0);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [runMeasurement]);

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatStorageReport(report));
      toast.success("Đã sao chép báo cáo dung lượng.");
    } catch {
      setShowText(true);
      toast.info("Hãy chọn và sao chép báo cáo bên dưới.");
    }
  };

  const totals = report?.fields ? getStorageTotals(report.fields) : null;
  const topFields = report?.fields ? [...report.fields].sort((a, b) => b.jsonBytes + b.fileBytes - a.jsonBytes - a.fileBytes).slice(0, 8) : [];
  const currentRows: Array<{ label: string; bytes: number | null }> = [
    { label: "Dữ liệu đang dùng (JSON)", bytes: totals?.working ?? null },
    { label: "Bản gốc để khôi phục bảng (JSON)", bytes: totals?.originals ?? null },
    { label: "Tệp trong dữ liệu hiện tại", bytes: totals?.files ?? null },
    { label: "Bản dữ liệu cũ / mục lưu khác (JSON)", bytes: totals?.other ?? null },
  ];
  const usagePercent = report?.browser.usage !== null && report?.browser.usage !== undefined && report.browser.quota
    ? Math.min(100, report.browser.usage / report.browser.quota * 100) : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto gap-4 border-border bg-background p-5 text-foreground shadow-2xl"
        onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold normal-case not-italic tracking-tight">
            <HardDrive className="h-5 w-5 text-primary" />
            Kiểm tra dung lượng
          </DialogTitle>
          <DialogDescription className="text-sm font-normal normal-case text-muted-foreground">
            Đo dữ liệu đã lưu trên trình duyệt và máy đang mở Payroll Hub.
          </DialogDescription>
        </DialogHeader>

        {isMeasuring ? (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span>{progress}</span>
          </div>
        ) : null}

        {report ? (
          <>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">Tổng website theo trình duyệt</span>
                <strong className="whitespace-nowrap text-xl font-semibold tabular-nums">{formatStorageBytes(report.browser.usage)}</strong>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>IndexedDB: {formatStorageBytes(report.browser.indexedDB)}</span>
                <span>Hạn mức trên máy: {formatStorageBytes(report.browser.quota)}</span>
              </div>
              {usagePercent !== null ? (
                <div className="mt-3">
                  <div role="progressbar" aria-label="Dung lượng website đã dùng" aria-valuenow={usagePercent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${usagePercent}%` }} />
                  </div>
                  <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{usagePercent.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}% hạn mức trên máy</p>
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">Tổng này có thể gồm bản sao lưu, tệp và bộ nhớ đệm. Đây là hạn mức trình duyệt, không phải dung lượng đồng bộ trên cloud.</p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Dữ liệu hiện tại — dung lượng logic ước tính</h3>
              <dl className="divide-y divide-border rounded-lg border border-border px-3 text-sm">
                {currentRows.map(({ label, bytes }) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2">
                    <dt>{label}</dt><dd className="whitespace-nowrap font-medium tabular-nums">{formatStorageBytes(bytes)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">Đếm toàn bộ dữ liệu JSON theo UTF-8 và kích thước tệp đang lưu. Các số này khác dung lượng ổ đĩa của IndexedDB; chưa gồm nội dung bản sao lưu.</p>
            </div>

            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Bản sao lưu</h3>
                <span className="tabular-nums">{report.snapshots ? `${report.snapshots.count} bản · ${report.snapshots.pinnedCount} đã ghim` : "Chưa đo được"}</span>
              </div>
              {report.snapshots ? <p className="mt-1 text-muted-foreground">Ước tính cũ từ lịch sử: <span className="font-medium tabular-nums text-foreground">{formatStorageBytes(report.snapshots.metadataEstimateBytes)}</span>{report.snapshots.missingEstimates ? ` · ${report.snapshots.missingEstimates} bản thiếu ước tính` : ""}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">Chỉ đọc thống kê bản sao để tránh tải nhiều GB vào bộ nhớ. Ước tính lịch sử chưa tính đầy đủ tệp trong các bản sao.</p>
            </div>

            {topFields.length ? (
              <details className="rounded-lg border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Các mục lớn nhất</summary>
                <table className="mt-2 w-full text-xs" style={{ fontFamily: "var(--font-table, var(--font-main))" }}>
                  <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-medium">Mục</th><th className="py-1 text-right font-medium">JSON + tệp</th><th className="py-1 text-right font-medium">Dòng/mục</th></tr></thead>
                  <tbody>{topFields.map((field, index) => <tr key={index} className="border-b border-border/50 last:border-0"><td className="py-1.5 pr-2">{field.label}</td><td className="whitespace-nowrap text-right tabular-nums">{formatStorageBytes(field.jsonBytes + field.fileBytes)}</td><td className="pl-3 text-right tabular-nums">{field.rows?.toLocaleString("vi-VN") ?? "—"}</td></tr>)}</tbody>
                </table>
              </details>
            ) : null}
            {report.notices.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{report.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul> : null}
            {showText ? <textarea readOnly aria-label="Báo cáo dung lượng để sao chép" className="h-48 w-full rounded-lg border border-border bg-muted/20 p-3 text-xs" value={formatStorageReport(report)} onFocus={(event) => event.currentTarget.select()} /> : null}
          </>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={() => { setIsMeasuring(true); setShowText(false); void runMeasurement(); }} disabled={isMeasuring} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted active:scale-[0.98] disabled:opacity-50"><RotateCcw className="h-4 w-4" />Đo lại</button>
          <button type="button" onClick={() => void copyReport()} disabled={!report || isMeasuring} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50"><Copy className="h-4 w-4" />Sao chép báo cáo</button>
        </div>
        <p className="text-xs text-muted-foreground">Báo cáo sao chép chỉ chứa dung lượng và số lượng, không chứa nội dung bảng lương. Thao tác này không sửa hoặc xóa dữ liệu.</p>
      </DialogContent>
    </Dialog>
  );
}
