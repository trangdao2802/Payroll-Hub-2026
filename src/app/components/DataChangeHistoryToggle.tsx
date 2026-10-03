/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import {
  History,
  Trash2,
  Search,
  X,
  Edit3,
  RotateCcw,
  ArchiveRestore,
  Plus,
  Layers,
  HardDrive,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  getDataChangeHistory,
  clearDataChangeHistory,
  getRelativeTime,
  type DataChangeRecord,
} from "../lib/utils/data-change-tracker";
import {
  getSnapshotsList,
  restoreSnapshot,
  saveSnapshot,
  type SnapshotMetadata,
} from "../lib/utils/snapshot-manager";
import { useAppData } from "../lib/contexts/AppDataContext";
import { SnapshotHistoryPanel } from "./snapshots/SnapshotHistoryPanel";
import { toast } from "sonner";

const StorageUsageDialog = lazy(() => import("./StorageUsageDialog"));

export function DataChangeHistoryToggle() {
  const { appData, updateAppData, undo, canUndo } = useAppData();

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"user_edits" | "snapshots">("user_edits");
  const [history, setHistory] = useState<DataChangeRecord[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isFullPanelOpen, setIsFullPanelOpen] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isStorageUsageOpen, setIsStorageUsageOpen] = useState(false);

  // Load user edits and snapshots
  const refreshData = useCallback(async () => {
    // Only get user edits on tables (strictly non-auto)
    const userEdits = getDataChangeHistory(true);
    setHistory(userEdits);

    try {
      const snapList = await getSnapshotsList();
      setSnapshots(snapList);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    refreshData();

    const handleChangesUpdated = () => {
      refreshData();
    };

    const handleSnapshotsUpdated = () => {
      refreshData();
    };

    window.addEventListener("payroll-data-changes-updated", handleChangesUpdated);
    window.addEventListener("payroll-snapshots-updated", handleSnapshotsUpdated);
    window.addEventListener("storage", handleChangesUpdated);

    const interval = setInterval(refreshData, 20000);

    return () => {
      window.removeEventListener("payroll-data-changes-updated", handleChangesUpdated);
      window.removeEventListener("payroll-snapshots-updated", handleSnapshotsUpdated);
      window.removeEventListener("storage", handleChangesUpdated);
      clearInterval(interval);
    };
  }, [refreshData]);

  // Handle clearing user edit logs
  const handleClearHistory = () => {
    clearDataChangeHistory();
    setHistory([]);
    setConfirmClear(false);
    toast.info("Đã làm sạch danh sách nhật ký chỉnh sửa.");
  };

  // Rollback to specific user edit version
  const handleRevertToEdit = async (item: DataChangeRecord) => {
    setRestoringId(item.id);
    try {
      if (item.snapshotId) {
        // Direct snapshot match
        const res = await restoreSnapshot(item.snapshotId, appData);
        if (res?.restoredData) {
          updateAppData(() => res.restoredData, true, true);
          toast.success(
            `Đã quay về phiên bản trước chỉnh sửa (${item.timeString} ngày ${item.dateString})!`,
          );
          setIsOpen(false);
          return;
        }
      }

      // If no snapshotId direct match, look up nearest snapshot in list <= item.timestamp
      const editTime = new Date(item.timestamp).getTime();
      const candidate = snapshots
        .filter((s) => s.createdAt <= editTime + 2000)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (candidate) {
        const res = await restoreSnapshot(candidate.id, appData);
        if (res?.restoredData) {
          updateAppData(() => res.restoredData, true, true);
          toast.success(
            `Đã quay về phiên bản lúc ${candidate.timeString} (${candidate.dateString})!`,
          );
          setIsOpen(false);
          return;
        }
      }

      // Fallback: Undo stack if available
      if (canUndo) {
        undo();
        toast.success(`Đã hoàn tác thay đổi gần nhất.`);
        setIsOpen(false);
        return;
      }

      toast.error("Không tìm thấy bản sao lưu tương ứng cho thời điểm chỉnh sửa này.");
    } catch (err) {
      console.error("Revert failed", err);
      toast.error("Không thể khôi phục về phiên bản này.");
    } finally {
      setRestoringId(null);
    }
  };

  // Direct snapshot restoration
  const handleRestoreSnapshot = async (snapshotId: string, title: string) => {
    setRestoringId(snapshotId);
    try {
      const res = await restoreSnapshot(snapshotId, appData);
      if (res?.restoredData) {
        updateAppData(() => res.restoredData, true, true);
        toast.success(`Đã khôi phục bản sao: ${title}!`);
        setIsOpen(false);
      }
    } catch (err) {
      console.error("Restore snapshot failed", err);
      toast.error("Khôi phục bản sao thất bại.");
    } finally {
      setRestoringId(null);
    }
  };

  // Create manual snapshot
  const handleCreateSnapshot = async () => {
    setIsCreatingSnapshot(true);
    try {
      const now = new Date();
      const meta = await saveSnapshot(appData, {
        trigger: "manual",
        title: `Bản sao lưu thủ công ${now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`,
        isPinned: true,
      });
      await refreshData();
      toast.success(`Đã tạo bản sao lưu mới (${meta.timeString})!`);
    } catch (err) {
      console.error("Failed to save manual snapshot", err);
      toast.error("Tạo bản sao lưu thất bại.");
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  // Filtered user edits (strictly manual table edits)
  const filteredUserEdits = useMemo(() => {
    return history.filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.summary.toLowerCase().includes(q) ||
        item.entity.toLowerCase().includes(q) ||
        (item.details && item.details.toLowerCase().includes(q)) ||
        item.timeString.includes(q) ||
        item.dateString.includes(q)
      );
    });
  }, [history, searchQuery]);

  // Filtered snapshots
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.note && item.note.toLowerCase().includes(q)) ||
        item.timeString.includes(q) ||
        item.dateString.includes(q)
      );
    });
  }, [snapshots, searchQuery]);

  const totalBadgeCount = history.length + snapshots.length;

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id="btn-nav-data-change-history"
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all outline-none active:scale-[0.98] cursor-pointer ${
              isOpen
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "border-border/80 bg-card hover:bg-muted/80 text-foreground shadow-2xs"
            }`}
            title="Lịch sử chỉnh sửa bảng & Khôi phục bản sao"
            aria-label="Lịch sử chỉnh sửa và khôi phục bản sao"
          >
            <History className={`w-4 h-4 ${isOpen ? "text-primary-foreground" : "text-foreground/80"}`} />
            {totalBadgeCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground tabular-nums shadow-xs">
                {history.length > 0 ? history.length : snapshots.length}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[480px] max-w-[95vw] p-0 border border-border shadow-2xl rounded-xl z-[9999] overflow-hidden bg-card text-card-foreground"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border/80 bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
                <History className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold tracking-tight text-foreground truncate">
                    Lịch sử & Khôi phục dữ liệu
                  </h3>
                  <span className="rounded-full bg-primary/10 px-2 py-0.2 text-[10px] font-semibold text-primary tabular-nums">
                    {activeTab === "user_edits" ? `${history.length} lần sửa` : `${snapshots.length} bản sao`}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  {activeTab === "user_edits"
                    ? "Chỉ hiển thị dữ liệu bạn đã chỉnh sửa trực tiếp tại bảng"
                    : "Khôi phục dữ liệu từ các bản sao lưu đã lưu trữ"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Segmented Switcher & Search Bar */}
          <div className="px-3 pt-2.5 pb-2 border-b border-border/60 bg-card space-y-2">
            {/* Tab switch between User Edits and Snapshots */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted/60 rounded-lg border border-border/60">
              <button
                type="button"
                id="btn-tab-user-edits"
                onClick={() => setActiveTab("user_edits")}
                className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "user_edits"
                    ? "bg-card text-foreground shadow-xs border border-border/60 font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Edit3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Chỉnh sửa tại bảng</span>
                {history.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.2 text-[9px] font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                    {history.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="btn-tab-restore-copy"
                onClick={() => setActiveTab("snapshots")}
                className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "snapshots"
                    ? "bg-card text-foreground shadow-xs border border-border/60 font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ArchiveRestore className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Khôi phục bản sao</span>
                {snapshots.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {snapshots.length}
                  </span>
                )}
              </button>
            </div>

            {/* Search & Actions bar */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 flex items-center">
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    activeTab === "user_edits"
                      ? "Tìm bảng, nội dung chỉnh sửa, giờ..."
                      : "Tìm tên bản sao, ngày lưu..."
                  }
                  className="w-full h-7 pl-8 pr-7 text-xs bg-muted/40 border border-border/70 rounded-lg focus:outline-none focus:border-primary/60 focus:bg-background transition-all placeholder:text-muted-foreground/60"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {activeTab === "user_edits" ? (
                confirmClear ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 text-[10px] font-bold transition-all shadow-xs active:scale-95"
                    >
                      Xóa
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="p-1 rounded-md border border-border bg-card hover:bg-muted text-muted-foreground text-[10px]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    disabled={history.length === 0}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
                    title="Xóa danh sách lịch sử chỉnh sửa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Xóa</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleCreateSnapshot}
                  disabled={isCreatingSnapshot}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-semibold transition-all shadow-xs active:scale-[0.98] shrink-0"
                  title="Tạo bản sao lưu ngay lập tức"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[10px] whitespace-nowrap">Tạo bản sao</span>
                </button>
              )}
            </div>
          </div>

          {/* Body Content */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/40 p-1">
            {activeTab === "user_edits" ? (
              /* User Edits Tab: ONLY user changes to tables */
              filteredUserEdits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 mb-2 border border-blue-200/60 dark:border-blue-800/60">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-foreground">
                    {searchQuery
                      ? "Không tìm thấy nội dung chỉnh sửa phù hợp"
                      : "Chưa có chỉnh sửa bảng nào"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[280px]">
                    {searchQuery
                      ? "Hãy thử tìm kiếm với từ khóa khác"
                      : "Khi bạn chỉnh sửa ô tại bảng Deductions, Gross Pay, Timesheet hay Master Roster, lịch sử sẽ xuất hiện tại đây kèm nút quay về."}
                  </p>
                </div>
              ) : (
                filteredUserEdits.map((item) => {
                  const relTime = getRelativeTime(item.timestamp);
                  const isRestoringThis = restoringId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg hover:bg-muted/40 transition-colors flex items-start gap-2.5 group"
                    >
                      {/* Icon */}
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-blue-200/60 bg-blue-500/10 text-blue-700 dark:border-blue-800/60 dark:text-blue-300">
                        <Edit3 className="w-3 h-3" />
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-bold text-foreground uppercase tracking-wider truncate max-w-[130px]">
                              {item.entity}
                            </span>
                            <span className="text-[9px] font-semibold px-1 py-0.2 rounded border border-blue-200/60 bg-blue-500/10 text-blue-700 dark:border-blue-800/60 dark:text-blue-300">
                              Chỉnh sửa
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                            <span className="font-medium text-foreground/80" title={item.timestamp}>
                              {relTime}
                            </span>
                            <span className="text-border">·</span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                              {item.timeString}
                            </span>
                          </div>
                        </div>

                        <div className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
                          {item.summary}
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <div className="text-[10px] text-muted-foreground/80 truncate max-w-[220px]">
                            {item.details || `Ngày: ${item.dateString}`}
                          </div>

                          {/* REVERT BUTTON for this specific user edit */}
                          <button
                            type="button"
                            onClick={() => handleRevertToEdit(item)}
                            disabled={isRestoringThis}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary hover:text-primary-foreground text-primary text-[10px] font-bold transition-all active:scale-[0.97] cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                            title="Quay về phiên bản trước khi thực hiện chỉnh sửa này"
                          >
                            <RotateCcw className={`w-3 h-3 ${isRestoringThis ? "animate-spin" : ""}`} />
                            <span>Quay về bản này</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              /* Snapshots Tab: Restore Copies */
              filteredSnapshots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 mb-2 border border-emerald-200/60 dark:border-emerald-800/60">
                    <ArchiveRestore className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-foreground">
                    {searchQuery ? "Không tìm thấy bản sao phù hợp" : "Chưa có bản sao lưu nào"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[280px]">
                    Nhấn vào nút "Tạo bản sao" phía trên để lưu trạng thái toàn bộ dữ liệu bảng tính.
                  </p>
                </div>
              ) : (
                filteredSnapshots.map((snap) => {
                  const isRestoringThis = restoringId === snap.id;
                  const relTime = getRelativeTime(snap.timestamp);

                  return (
                    <div
                      key={snap.id}
                      className="p-2.5 rounded-lg hover:bg-muted/40 transition-colors flex items-start gap-2.5 group"
                    >
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-200/60 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800/60 dark:text-emerald-300">
                        <ArchiveRestore className="w-3 h-3" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-xs text-foreground truncate max-w-[220px]">
                              {snap.title}
                            </span>
                            {snap.isPinned && (
                              <span className="rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-300/40 text-[9px] font-bold px-1 py-0.2">
                                Đã ghim
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                            <span className="font-medium text-foreground/80" title={snap.timestamp}>
                              {relTime}
                            </span>
                            <span className="text-border">·</span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                              {snap.timeString}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <span>Kỳ: {snap.globalMonth || "Tất cả"}</span>
                          <span>·</span>
                          <span>{snap.stats?.totalRows || 0} dòng</span>
                          <span>·</span>
                          <span>{snap.stats?.approxSizeKb || 0} KB</span>
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <span className="font-mono text-[9px] text-muted-foreground/60">
                            {snap.dateString}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRestoreSnapshot(snap.id, snap.title)}
                            disabled={isRestoringThis}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] font-bold transition-all active:scale-[0.97] cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                            title="Khôi phục trạng thái bảng từ bản sao lưu này"
                          >
                            <RotateCcw className={`w-3 h-3 ${isRestoringThis ? "animate-spin" : ""}`} />
                            <span>Khôi phục bản sao</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>

          {/* Read-only storage diagnostics and the existing snapshot manager. */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/70 bg-muted/20 text-[10px] text-muted-foreground font-medium">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setIsFullPanelOpen(true);
              }}
              className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-bold hover:underline cursor-pointer"
            >
              <Layers className="w-3 h-3 text-primary" />
              <span className="whitespace-nowrap">Quản lý bản sao →</span>
            </button>

            <button
              type="button"
              onClick={() => { setIsOpen(false); setIsStorageUsageOpen(true); }}
              className="flex items-center gap-1.5 whitespace-nowrap text-primary hover:text-primary/80 font-bold hover:underline cursor-pointer active:scale-[0.98]"
            >
              <HardDrive className="h-3 w-3" />
              Kiểm tra dung lượng
            </button>

            <span className="font-mono tabular-nums text-muted-foreground/80">
              {activeTab === "user_edits" ? `${filteredUserEdits.length} mục` : `${filteredSnapshots.length} bản sao`}
            </span>
          </div>
        </PopoverContent>
      </Popover>

      {isStorageUsageOpen ? (
        <Suspense fallback={null}>
          <StorageUsageDialog onClose={() => setIsStorageUsageOpen(false)} />
        </Suspense>
      ) : null}

      {/* Full Screen Snapshot History Modal if user wants deep comparison */}
      <SnapshotHistoryPanel
        isOpen={isFullPanelOpen}
        onClose={() => setIsFullPanelOpen(false)}
      />
    </>
  );
}

export default DataChangeHistoryToggle;
