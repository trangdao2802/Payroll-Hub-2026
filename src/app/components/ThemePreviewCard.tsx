import { getVisibleTastePresets } from "../lib/theme-preset-library";
import { useState, useMemo, useEffect } from "react";
import {
  Palette,
  Check,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Table2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  TastePreset,
  UiSettings,
  applyUiSettings,
  saveUiSettings,
  loadUiSettings,
  computeContrastTextColor,
  calculateRelativeLuminance,
  calculateContrastRatio,
  resolveTitleFontStack,
} from "../lib/ui-settings";
import { TableInitialMark, TableTitleRemainder } from "./TableInitialMark";
import { toast } from "sonner";

export interface ThemePreviewCardProps {
  /** Initial preset ID to preview (defaults to current applied theme) */
  initialPresetId?: string;
  /** Custom settings preview override (e.g., when editing in settings modal) */
  customSettingsPreview?: Partial<UiSettings>;
  /** Callback when user clicks Apply */
  onApply?: (presetId: string, presetData: TastePreset) => void;
  /** Callback to close container if inside popover/modal */
  onClose?: () => void;
  /** Extra container classes */
  className?: string;
  /** Compact mode (hides preset list, only shows card preview) */
  compact?: boolean;
}

export function ThemePreviewCard({
  initialPresetId,
  customSettingsPreview,
  onApply,
  onClose,
  className = "",
  compact = false,
}: ThemePreviewCardProps) {
  // Current active theme from document / localStorage
  const [activeThemeId, setActiveThemeId] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        document.documentElement.getAttribute("data-theme") ||
        localStorage.getItem("app-theme") ||
        "opal-garden"
      );
    }
    return "opal-garden";
  });

  // Selected preset being previewed (null means follow initialPresetId / activeThemeId)
  const [userSelectedPresetId, setUserSelectedPresetId] = useState<string | null>(null);
  const [presetVersion, setPresetVersion] = useState(0);

  const previewId = userSelectedPresetId ?? (initialPresetId || activeThemeId || "opal-garden");

  // Synchronize active theme from storage/DOM mutation events
  useEffect(() => {
    const handleStorageChange = () => {
      const current =
        document.documentElement.getAttribute("data-theme") ||
        localStorage.getItem("app-theme") ||
        "opal-garden";
      setActiveThemeId(current);
      setPresetVersion((v) => v + 1);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("ui-user-default-changed", handleStorageChange);
    window.addEventListener("ui-settings-changed", handleStorageChange);
    const observer = new MutationObserver(handleStorageChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("ui-user-default-changed", handleStorageChange);
      window.removeEventListener("ui-settings-changed", handleStorageChange);
      observer.disconnect();
    };
  }, []);

  const presetEntries = useMemo(() => {
    void presetVersion;
    return getVisibleTastePresets();
  }, [presetVersion]);

  const selectedPreset: TastePreset = useMemo(() => {
    void presetVersion;
    return (
      presetEntries.find(p => p.id === previewId) ||
      presetEntries.find(p => p.id === activeThemeId) ||
      presetEntries[0]
    );
  }, [previewId, activeThemeId, presetVersion, presetEntries]);

  // Resolve preview colors: custom override takes precedence if supplied
  const previewColors = useMemo(() => {
    const tableHeaderBg =
      customSettingsPreview?.tableHeaderBg || selectedPreset.tableHeaderBg;
    // Footer strictly mirrors header background
    const tableFooterBg =
      customSettingsPreview?.tableFooterBg || tableHeaderBg;
    const tableColumnHeaderBg =
      customSettingsPreview?.tableColumnHeaderBg ||
      selectedPreset.tableColumnHeaderBg;
    const tableColumnHeaderTextColor =
      customSettingsPreview?.tableColumnHeaderTextColor ||
      selectedPreset.tableColumnHeaderTextColor ||
      "#2D2126";
    const tableDataBg =
      customSettingsPreview?.tableDataBg || selectedPreset.tableDataBg;
    const stripeColor2 =
      customSettingsPreview?.stripeColor2 || selectedPreset.stripeColor2;
    const gridLineColor =
      customSettingsPreview?.gridLineColor || selectedPreset.gridLineColor;
    const accent = customSettingsPreview?.accent || selectedPreset.accent;
    const text = customSettingsPreview?.text || selectedPreset.text;

    const headerContrast = computeContrastTextColor(tableHeaderBg, text);
    const footerContrast = computeContrastTextColor(tableFooterBg, text);
    const headerLuminance = calculateRelativeLuminance(tableHeaderBg);
    const contrastRatio = calculateContrastRatio(
      tableHeaderBg,
      headerContrast.primary
    );

    return {
      tableHeaderBg,
      tableFooterBg,
      tableColumnHeaderBg,
      tableColumnHeaderTextColor,
      tableDataBg,
      stripeColor2,
      gridLineColor,
      accent,
      text,
      headerContrast,
      footerContrast,
      headerLuminance,
      contrastRatio,
    };
  }, [selectedPreset, customSettingsPreview]);

  const isDifferentFromActive =
    previewId !== activeThemeId || Boolean(customSettingsPreview);

  const handleApply = async () => {
    try {
      const presetData = selectedPreset;
      // 1. Update data-theme on HTML root
      document.documentElement.setAttribute("data-theme", presetData.id);
      localStorage.setItem("app-theme", presetData.id);
      setActiveThemeId(presetData.id);

      // 2. Load existing settings and merge with preset
      const current = await loadUiSettings();
      const updated: UiSettings = {
        ...current,
        preset: presetData.id,
        bg: presetData.bg,
        accent: presetData.accent,
        text: presetData.text,
        border: presetData.border,
        stripeColor1: presetData.stripeColor1,
        stripeColor2: presetData.stripeColor2,
        gridLineColor: presetData.gridLineColor,
        tableHeaderBg: presetData.tableHeaderBg,
        tableSubHeaderBg: presetData.tableSubHeaderBg,
        tableFooterBg: presetData.tableFooterBg,
        tableColumnHeaderBg: presetData.tableColumnHeaderBg,
        tableColumnHeaderTextColor: presetData.tableColumnHeaderTextColor,
        tableDataBg: presetData.tableDataBg,
        tableFont: presetData.tableFont,
        tableRadius: presetData.tableRadius,
        ...(customSettingsPreview || {}),
      };

      await saveUiSettings(updated);
      applyUiSettings(updated);

      toast.success(`Đã áp dụng chủ đề: ${presetData.name}`);
      setUserSelectedPresetId(null);
      if (onApply) {
        onApply(presetData.id, presetData);
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error("Failed to apply theme preset:", err);
      toast.error("Không thể lưu chủ đề, vui lòng thử lại.");
    }
  };

  const handleReset = () => {
    setUserSelectedPresetId(null);
    toast.info("Đã khôi phục xem trước về chủ đề đang dùng.");
  };

  return (
    <div
      id="theme-preview-card"
      className={`flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-3.5 text-card-foreground shadow-md transition-all ${className}`}
    >
      {/* Header bar of preview card */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 text-accent shadow-xs"
            style={{ backgroundColor: previewColors.tableHeaderBg }}
          >
            <Table2
              className="h-4 w-4"
              style={{ color: previewColors.headerContrast.primary }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs tracking-tight text-foreground">
                Xem Trước Chủ Đề Bảng
              </span>
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: previewColors.tableHeaderBg,
                  color: previewColors.headerContrast.primary,
                  border: `1px solid ${previewColors.gridLineColor}`,
                }}
              >
                {selectedPreset.id}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">
              {selectedPreset.name}
            </p>
          </div>
        </div>

        {isDifferentFromActive && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
            <Sparkles className="h-2.5 w-2.5" />
            Đang xem thử
          </span>
        )}
      </div>

      {/* Preset selection chips (if not compact) */}
      {!compact && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Palette className="h-3 w-3" /> Chủ đề phối màu giao diện:
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
              {presetEntries.length} chủ đề
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 py-0.5">
            {presetEntries.map((preset) => {
              const isSelected = preset.id === previewId;
              const isActive = preset.id === activeThemeId;
              const titlePart = preset.name.includes("·")
                ? preset.name.split("·")[0].trim()
                : preset.name;
              const subPart = preset.name.includes("·")
                ? preset.name.split("·")[1]?.trim()
                : (preset.id === "default" ? "Giao diện đã lưu" : preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setUserSelectedPresetId(preset.id)}
                  className={`group relative flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-all cursor-pointer active:scale-[0.98] ${
                    isSelected
                      ? "border-primary bg-primary/10 font-bold text-primary shadow-xs ring-1 ring-primary/30"
                      : "border-border/70 bg-background/90 hover:bg-muted/70 text-foreground"
                  }`}
                  title={preset.name}
                >
                  <div className="flex items-center -space-x-1 shrink-0">
                    <span
                      className="h-4 w-4 rounded-full border border-border/80 shadow-2xs z-30"
                      style={{ backgroundColor: preset.tableHeaderBg }}
                      title={`Tiêu đề & Chân bảng: ${preset.tableHeaderBg}`}
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-border/80 shadow-2xs z-20"
                      style={{ backgroundColor: preset.tableColumnHeaderBg }}
                      title={`Tiêu đề cột & Tổng cộng: ${preset.tableColumnHeaderBg}`}
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-border/80 shadow-2xs z-10"
                      style={{ backgroundColor: preset.accent }}
                      title={`Màu nhấn: ${preset.accent}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-semibold text-[11px]">
                      {titlePart}
                    </div>
                    <div className="text-[9.5px] text-muted-foreground truncate">
                      {subPart}
                    </div>
                  </div>
                  {isActive && (
                    <span title="Chủ đề đang áp dụng" className="shrink-0">
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mini Interactive Table Preview Frame */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-border shadow-xs">
        {/* 1. Mini Table Header */}
        <div
          className="flex min-h-[38px] items-center justify-between border-b px-3 py-1.5 transition-colors"
          style={{
            backgroundColor: previewColors.tableHeaderBg,
            borderColor: previewColors.gridLineColor,
          }}
        >
          <div className="flex flex-col min-w-0">
            <div
              className={`app-table-title-line ${
                customSettingsPreview?.titleFontIncludeInitial ? "app-table-title-line--font-mode" : ""
              }`}
              style={{
                color: previewColors.headerContrast.primary,
                "--font-table-title": resolveTitleFontStack(customSettingsPreview?.titleFont),
                "--table-initial-color": previewColors.headerContrast.primary,
              } as React.CSSProperties}
            >
              <TableInitialMark
                label="BẢNG TỔNG HỢP CÔNG & LƯƠNG"
                color={previewColors.headerContrast.primary}
                className={
                  customSettingsPreview?.titleFontIncludeInitial
                    ? "app-table-initial-mark--font-mode"
                    : ""
                }
              />
              <TableTitleRemainder label="BẢNG TỔNG HỢP CÔNG & LƯƠNG" />
            </div>
            <span
              className="text-[10px] leading-tight"
              style={{ color: previewColors.headerContrast.muted }}
            >
              Tiêu đề bảng (Đồng bộ cùng chân bảng)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums border"
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.45)",
                borderColor: previewColors.gridLineColor,
                color: previewColors.headerContrast.primary,
              }}
            >
              Tiêu đề & Chân bảng
            </span>
          </div>
        </div>

        {/* 2. Mini Column Header */}
        <div
          className="grid grid-cols-12 gap-1 border-b px-3 py-1 text-[10px] font-bold transition-colors"
          style={{
            backgroundColor: previewColors.tableColumnHeaderBg,
            color: previewColors.tableColumnHeaderTextColor,
            borderColor: previewColors.gridLineColor,
          }}
        >
          <span className="col-span-3 truncate">Mã NV</span>
          <span className="col-span-4 truncate">Họ và Tên</span>
          <span className="col-span-2 text-right tabular-nums">Giờ công</span>
          <span className="col-span-3 text-right tabular-nums">Thực lĩnh</span>
        </div>

        {/* 3. Mini Rows */}
        <div
          className="flex flex-col text-[10px]"
          style={{ backgroundColor: previewColors.tableDataBg }}
        >
          <div
            className="grid grid-cols-12 gap-1 border-b px-3 py-1 tabular-nums text-foreground/90 font-mono transition-colors"
            style={{ borderColor: previewColors.gridLineColor }}
          >
            <span className="col-span-3 font-semibold text-primary">NV0129</span>
            <span className="col-span-4 truncate font-sans text-foreground">
              Nguyễn Văn An
            </span>
            <span className="col-span-2 text-right">184.0h</span>
            <span className="col-span-3 text-right font-semibold">18,500,000₫</span>
          </div>

          <div
            className="grid grid-cols-12 gap-1 border-b px-3 py-1 tabular-nums text-foreground/90 font-mono transition-colors"
            style={{
              backgroundColor: previewColors.stripeColor2,
              borderColor: previewColors.gridLineColor,
            }}
          >
            <span className="col-span-3 font-semibold text-primary">NV0142</span>
            <span className="col-span-4 truncate font-sans text-foreground">
              Trần Thị Mai
            </span>
            <span className="col-span-2 text-right">176.5h</span>
            <span className="col-span-3 text-right font-semibold">16,200,000₫</span>
          </div>

          {/* Mini Total Row (Synchronized with Column Header color) */}
          <div
            className="grid grid-cols-12 gap-1 border-b px-3 py-1 text-[10px] font-bold transition-colors tabular-nums"
            style={{
              backgroundColor: previewColors.tableColumnHeaderBg,
              color: previewColors.tableColumnHeaderTextColor,
              borderColor: previewColors.gridLineColor,
            }}
          >
            <span className="col-span-7 font-bold">DÒNG TỔNG CỘNG (2 NV)</span>
            <span className="col-span-2 text-right">360.5h</span>
            <span className="col-span-3 text-right font-extrabold">34,700,000₫</span>
          </div>
        </div>

        {/* 4. Mini Table Footer / Pagination */}
        <div
          className="flex min-h-[34px] items-center justify-between border-t px-3 py-1 transition-colors text-[10px]"
          style={{
            backgroundColor: previewColors.tableFooterBg,
            borderColor: previewColors.gridLineColor,
          }}
        >
          <div className="flex items-center gap-1.5 tabular-nums">
            <span
              className="font-medium"
              style={{ color: previewColors.footerContrast.primary }}
            >
              Trang 1 / 10
            </span>
            <span style={{ color: previewColors.footerContrast.muted }}>•</span>
            <span style={{ color: previewColors.footerContrast.muted }}>
              250 nhân sự
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled
              className="flex h-5 w-5 items-center justify-center rounded border opacity-50 cursor-not-allowed"
              style={{
                borderColor: previewColors.gridLineColor,
                color: previewColors.footerContrast.primary,
              }}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded border hover:bg-black/5 active:scale-95 transition-transform"
              style={{
                borderColor: previewColors.gridLineColor,
                color: previewColors.footerContrast.primary,
              }}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* 4 distinct pastel color roles explanation badge */}
      <div className="grid grid-cols-4 gap-1.5 rounded-lg bg-muted/40 p-2 text-[10.5px] border border-border/50">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-border/70 shrink-0"
              style={{ backgroundColor: selectedPreset.accent }}
            />
            <span className="text-[10px] font-semibold text-muted-foreground truncate">Màu nhấn</span>
          </div>
          <span className="font-mono text-[9.5px] text-foreground font-medium truncate">
            {selectedPreset.accent}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-border/70 shrink-0"
              style={{ backgroundColor: selectedPreset.bg }}
            />
            <span className="text-[10px] font-semibold text-muted-foreground truncate">Màu nền</span>
          </div>
          <span className="font-mono text-[9.5px] text-foreground font-medium truncate">
            {selectedPreset.bg}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-border/70 shrink-0"
              style={{ backgroundColor: previewColors.tableColumnHeaderBg }}
            />
            <span className="text-[10px] font-semibold text-muted-foreground truncate">Cột & Tổng</span>
          </div>
          <span className="font-mono text-[9.5px] text-foreground font-medium truncate">
            {previewColors.tableColumnHeaderBg}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-border/70 shrink-0"
              style={{ backgroundColor: previewColors.tableHeaderBg }}
            />
            <span className="text-[10px] font-semibold text-muted-foreground truncate">Bảng & Chân</span>
          </div>
          <span className="font-mono text-[9.5px] text-foreground font-medium truncate">
            {previewColors.tableHeaderBg}
          </span>
        </div>
      </div>

      {/* Contrast and WCAG Spec Indicator */}
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground border border-border/40">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            WCAG AA ({previewColors.contrastRatio.toFixed(1)}:1)
          </span>
          <span className="text-border">•</span>
          <span className="tabular-nums">
            Độ sáng: {(previewColors.headerLuminance * 100).toFixed(0)}% (
            {previewColors.headerContrast.isLightBg ? "Nền sáng" : "Nền tối"})
          </span>
        </div>

        <div className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-border"
            style={{ backgroundColor: previewColors.tableHeaderBg }}
            title={`Màu tiêu đề: ${previewColors.tableHeaderBg}`}
          />
          <span className="text-[10px] text-muted-foreground font-mono">
            {previewColors.tableHeaderBg}
          </span>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {isDifferentFromActive ? (
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted active:scale-[0.98] transition-all cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Khôi phục
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">
            Chủ đề đang hoạt động
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-semibold hover:bg-muted active:scale-[0.98] transition-all cursor-pointer text-foreground"
            >
              Đóng
            </button>
          )}

          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            Áp dụng toàn bộ cài đặt
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThemePreviewCard;
