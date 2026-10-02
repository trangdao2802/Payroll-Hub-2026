import { getVisibleTastePresets, deleteTastePreset } from "../lib/theme-preset-library";
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Settings2,
  Trash2,
  Target,
  ChevronDown,
  PaintBucket,
  Type,
  SquareDashed,
  Maximize2,
  PanelTopOpen,
  Check,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Ruler,
  BookmarkCheck,
  RotateCcw,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import localforage from "localforage";
import { useAppData } from "../lib/contexts/AppDataContext";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { createClearedWebData } from "../lib/utils/data-clear-scopes";
import { isSupabaseConfigured } from "../lib/supabase";
import { clearSupabaseRosterData } from "../lib/supabase-sync-utils";
import { ThemePreviewCard } from "./ThemePreviewCard";
import { TableInitialMark, TableTitleRemainder } from "./TableInitialMark";
import {
  type UiSettings,
  defaultSettings,
  UI_SETTINGS_KEY,
  applyUiSettings,
  loadUiSettings,
  saveUiSettings,
  saveUserDefaultUiSettings,
  loadUserDefaultUiSettings,
  clearUserDefaultUiSettings,
  getUserDefaultUiSettingsSync,
  colorToHex7,
  isSafeCustomSelector,
  normalizeCssLength,
  TITLE_FONT_OPTIONS,
  resolveTitleFontStack,
} from "../lib/ui-settings";

// Helper utilities for parsing CSS shorthand paddings/margins
const parseShorthand = (val: string) => {
  if (!val) return { top: "", right: "", bottom: "", left: "" };
  const parts = val.trim().split(/\s+/);
  if (parts.length === 1) {
    const v = parts[0];
    return { top: v, right: v, bottom: v, left: v };
  } else if (parts.length === 2) {
    const t = parts[0];
    const r = parts[1];
    return { top: t, right: r, bottom: t, left: r };
  } else if (parts.length === 3) {
    const t = parts[0];
    const r = parts[1];
    const b = parts[2];
    return { top: t, right: r, bottom: b, left: r };
  } else if (parts.length >= 4) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return { top: "", right: "", bottom: "", left: "" };
};

const cleanUnit = (val: string) => {
  if (!val) return "";
  if (val === "0px") return "0";
  const match = val.match(/^([\d.]+)(px)$/);
  if (match) {
    return match[1];
  }
  return val;
};

interface SelectedDivInfo {
  tag: string;
  selector: string;
  background: string;
  color: string;
  border: string;
  radius: string;
  padding: string;
  margin: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: string;
  lineHeight: string;
  width: string;
  height: string;
}

const stepNumericValue = (
  value: string,
  delta: number,
  setter: (val: string) => void,
  defaultUnit: string = "px"
) => {
  const str = String(value ?? "").trim();
  if (!str || str === "auto" || str === "none") {
    setter(delta > 0 ? `1${defaultUnit}` : `0${defaultUnit}`);
    return;
  }
  const match = str.match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
  if (match) {
    const num = parseFloat(match[1]);
    const rawUnit = match[2]?.trim();
    const unit = rawUnit !== "" ? rawUnit : defaultUnit;
    const nextNum = Math.round((num + delta) * 100) / 100;
    setter(`${nextNum}${unit}`);
  } else {
    setter(delta > 0 ? `1${defaultUnit}` : `0${defaultUnit}`);
  }
};

const StepperButtons = ({
  value,
  setter,
  defaultUnit = "px",
  className = "right-1.5 text-slate-400 hover:text-white",
  btnClassName = "h-3.5 w-4 text-[9px]",
}: {
  value: string;
  setter: (val: string) => void;
  defaultUnit?: string;
  className?: string;
  btnClassName?: string;
}) => (
  <div className={`absolute flex flex-col justify-center select-none z-10 ${className}`}>
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        stepNumericValue(value, step, setter, defaultUnit);
      }}
      className={`flex items-center justify-center hover:bg-white/20 active:bg-white/30 rounded text-center font-bold leading-none cursor-pointer transition-colors ${btnClassName}`}
      title="Tăng (Click: +1, Shift+Click: +10, Alt+Click: +0.1)"
    >
      ∆
    </button>
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? -10 : e.altKey ? -0.1 : -1;
        stepNumericValue(value, step, setter, defaultUnit);
      }}
      className={`flex items-center justify-center hover:bg-white/20 active:bg-white/30 rounded text-center font-bold leading-none cursor-pointer transition-colors ${btnClassName}`}
      title="Giảm (Click: -1, Shift+Click: -10, Alt+Click: -0.1)"
    >
      ∇
    </button>
  </div>
);

export function UiSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<UiSettings>(defaultSettings);
  const [hasCustomDefault, setHasCustomDefault] = useState(false);
  const persistedSettingsRef = useRef<UiSettings>(defaultSettings);
  const wasOpenRef = useRef(false);
  const { updateAppData } = useAppData();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<"general" | "div_selector">("general");

  // States for new custom selector style rule
  const [newSelector, setNewSelector] = useState("");
  const [newRadius, setNewRadius] = useState("");
  const [newBg, setNewBg] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newBorder, setNewBorder] = useState("");
  const [newWidth, setNewWidth] = useState("");
  const [newHeight, setNewHeight] = useState("");
  const [newFontSize, setNewFontSize] = useState("");
  const [newFontFamily, setNewFontFamily] = useState("");
  const [newFontWeight, setNewFontWeight] = useState("");
  const [newFontStyle, setNewFontStyle] = useState("");
  const [newTextDecoration, setNewTextDecoration] = useState("");
  const [newTextAlign, setNewTextAlign] = useState("");
  const [newLineHeight, setNewLineHeight] = useState("");

  // Split padding states
  const [padTop, setPadTop] = useState("");
  const [padRight, setPadRight] = useState("");
  const [padBottom, setPadBottom] = useState("");
  const [padLeft, setPadLeft] = useState("");

  // Split margin states
  const [marTop, setMarTop] = useState("");
  const [marRight, setMarRight] = useState("");
  const [marBottom, setMarBottom] = useState("");
  const [marLeft, setMarLeft] = useState("");
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const editorBaselineRef = useRef<Record<string, string>>({});
  const [selectedDivInfo, setSelectedDivInfo] = useState<SelectedDivInfo | null>(null);
  const [isCompactInspector, setIsCompactInspector] = useState(false);
  const [compactPanel, setCompactPanel] = useState<"type" | "spacing" | "paint" | null>(null);

  const getCombinedMargin = useCallback(() => {
    const t = marTop.trim();
    const r = marRight.trim();
    const b = marBottom.trim();
    const l = marLeft.trim();
    
    if (!t && !r && !b && !l) return "";
    const toPx = (v: string) => {
      if (!v) return "0px";
      if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
      return v;
    };
    return `${toPx(t)} ${toPx(r)} ${toPx(b)} ${toPx(l)}`;
  }, [marTop, marRight, marBottom, marLeft]);

  const editorHasChanges = useCallback(() => {
    const baseline = editorBaselineRef.current;
    const changed = (key: string, value: string) => (baseline[key] || "") !== value;
    return (
      changed("radius", newRadius) || changed("bg", newBg) ||
      changed("color", newColor) || changed("border", newBorder) ||
      changed("padTop", padTop) || changed("padRight", padRight) ||
      changed("padBottom", padBottom) || changed("padLeft", padLeft) ||
      changed("marTop", marTop) || changed("marRight", marRight) ||
      changed("marBottom", marBottom) || changed("marLeft", marLeft) ||
      changed("width", newWidth) || changed("height", newHeight) ||
      changed("fontSize", newFontSize) || changed("fontFamily", newFontFamily) ||
      changed("fontWeight", newFontWeight) || changed("fontStyle", newFontStyle) ||
      changed("textDecoration", newTextDecoration) ||
      changed("textAlign", newTextAlign) || changed("lineHeight", newLineHeight)
    );
  }, [
    newRadius, newBg, newColor, newBorder,
    padTop, padRight, padBottom, padLeft,
    marTop, marRight, marBottom, marLeft,
    newWidth, newHeight, newFontSize, newFontFamily, newFontWeight,
    newFontStyle, newTextDecoration, newTextAlign, newLineHeight,
  ]);

  const syncEditorBaseline = useCallback(() => {
    editorBaselineRef.current = {
      radius: newRadius,
      bg: newBg,
      color: newColor,
      border: newBorder,
      padTop,
      padRight,
      padBottom,
      padLeft,
      marTop,
      marRight,
      marBottom,
      marLeft,
      width: newWidth,
      height: newHeight,
      fontSize: newFontSize,
      fontFamily: newFontFamily,
      fontWeight: newFontWeight,
      fontStyle: newFontStyle,
      textDecoration: newTextDecoration,
      textAlign: newTextAlign,
      lineHeight: newLineHeight,
    };
  }, [
    newRadius, newBg, newColor, newBorder,
    padTop, padRight, padBottom, padLeft,
    marTop, marRight, marBottom, marLeft,
    newWidth, newHeight, newFontSize, newFontFamily, newFontWeight,
    newFontStyle, newTextDecoration, newTextAlign, newLineHeight,
  ]);

  const updatePaddingStates = useCallback((padVal: string) => {
    const parsed = parseShorthand(padVal);
    setPadTop(cleanUnit(parsed.top));
    setPadRight(cleanUnit(parsed.right));
    setPadBottom(cleanUnit(parsed.bottom));
    setPadLeft(cleanUnit(parsed.left));
  }, []);

  const updateMarginStates = useCallback((marVal: string) => {
    const parsed = parseShorthand(marVal);
    setMarTop(cleanUnit(parsed.top));
    setMarRight(cleanUnit(parsed.right));
    setMarBottom(cleanUnit(parsed.bottom));
    setMarLeft(cleanUnit(parsed.left));
  }, []);

  const resetCustomRuleFields = useCallback(() => {
    setNewRadius("");
    setNewBg("");
    setNewColor("");
    setNewBorder("");
    updatePaddingStates("");
    updateMarginStates("");
    setNewWidth("");
    setNewHeight("");
    setNewFontSize("");
    setNewFontFamily("");
    setNewFontWeight("");
    setNewFontStyle("");
    setNewTextDecoration("");
    setNewTextAlign("");
    setNewLineHeight("");
    editorBaselineRef.current = {};
  }, [updatePaddingStates, updateMarginStates]);

  const captureSelectedElement = useCallback((element: HTMLElement, selector: string) => {
    const computed = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    selectedElementRef.current?.classList.remove("ui-inspector-selected");
    selectedElementRef.current = element;
    element.classList.add("ui-inspector-selected");
    const info: SelectedDivInfo = {
      tag: element.tagName.toLowerCase(),
      selector,
      background: computed.backgroundColor,
      color: computed.color,
      border: computed.border,
      radius: computed.borderRadius,
      padding: computed.padding,
      margin: computed.margin,
      fontSize: computed.fontSize,
      fontFamily: computed.fontFamily,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      textDecoration: computed.textDecorationLine,
      textAlign: computed.textAlign,
      lineHeight: computed.lineHeight,
      width: `${Math.round(rect.width)}px`,
      height: `${Math.round(rect.height)}px`,
    };
    setSelectedDivInfo(info);
    return info;
  }, []);

  const loadComputedFields = useCallback((info: SelectedDivInfo) => {
    const padding = parseShorthand(info.padding);
    const margin = parseShorthand(info.margin);
    const values = {
      radius: info.radius,
      bg: info.background,
      color: info.color,
      border: info.border,
      padTop: cleanUnit(padding.top),
      padRight: cleanUnit(padding.right),
      padBottom: cleanUnit(padding.bottom),
      padLeft: cleanUnit(padding.left),
      marTop: cleanUnit(margin.top),
      marRight: cleanUnit(margin.right),
      marBottom: cleanUnit(margin.bottom),
      marLeft: cleanUnit(margin.left),
      width: info.width,
      height: info.height,
      fontSize: info.fontSize,
      fontFamily: info.fontFamily,
      fontWeight: info.fontWeight,
      fontStyle: info.fontStyle,
      textDecoration: info.textDecoration,
      textAlign: info.textAlign,
      lineHeight: info.lineHeight,
    };
    setNewRadius(info.radius);
    setNewBg(info.background);
    setNewColor(info.color);
    setNewBorder(info.border);
    setPadTop(values.padTop);
    setPadRight(values.padRight);
    setPadBottom(values.padBottom);
    setPadLeft(values.padLeft);
    setMarTop(values.marTop);
    setMarRight(values.marRight);
    setMarBottom(values.marBottom);
    setMarLeft(values.marLeft);
    setNewWidth(info.width);
    setNewHeight(info.height);
    setNewFontSize(info.fontSize);
    setNewFontFamily(info.fontFamily);
    setNewFontWeight(info.fontWeight);
    setNewFontStyle(info.fontStyle);
    setNewTextDecoration(info.textDecoration);
    setNewTextAlign(info.textAlign);
    setNewLineHeight(info.lineHeight);
    editorBaselineRef.current = values;
  }, []);

  const handleSelectorChange = useCallback((selector: string, targetElement?: HTMLElement) => {
    setNewSelector(selector);
    const cleanSelector = selector.trim();
    if (!cleanSelector) {
      resetCustomRuleFields();
      selectedElementRef.current?.classList.remove("ui-inspector-selected");
      selectedElementRef.current = null;
      setSelectedDivInfo(null);
      return;
    }

    let resolvedElement = targetElement;
    if (!resolvedElement && isSafeCustomSelector(cleanSelector)) {
      try {
        resolvedElement = document.querySelector<HTMLElement>(cleanSelector) || undefined;
      } catch {
        resolvedElement = undefined;
      }
    }
    const computedInfo = resolvedElement
      ? captureSelectedElement(resolvedElement, cleanSelector)
      : null;

    const existingRule = settings.customRules?.find(
      (r) => r.selector === cleanSelector
    );
    if (computedInfo) {
      // Show the actual computed result (including an existing saved rule),
      // while retaining the original rule until a field is really edited.
      loadComputedFields(computedInfo);
    } else if (existingRule) {
      const existingPadding = parseShorthand(existingRule.padding || "");
      const existingMargin = parseShorthand(existingRule.margin || "");
      setNewRadius(existingRule.radius || "");
      setNewBg(existingRule.bg || "");
      setNewColor(existingRule.color || "");
      setNewBorder(existingRule.border || "");
      updatePaddingStates(existingRule.padding || "");
      setPadTop(cleanUnit(existingRule.paddingTop || existingPadding.top));
      setPadRight(cleanUnit(existingRule.paddingRight || existingPadding.right));
      setPadBottom(cleanUnit(existingRule.paddingBottom || existingPadding.bottom));
      setPadLeft(cleanUnit(existingRule.paddingLeft || existingPadding.left));
      updateMarginStates(existingRule.margin || "");
      setNewWidth(existingRule.width || "");
      setNewHeight(existingRule.height || "");
      setNewFontSize(existingRule.fontSize || "");
      setNewFontFamily(existingRule.fontFamily || "");
      setNewFontWeight(existingRule.fontWeight || "");
      setNewFontStyle(existingRule.fontStyle || "");
      setNewTextDecoration(existingRule.textDecoration || "");
      setNewTextAlign(existingRule.textAlign || "");
      setNewLineHeight(existingRule.lineHeight || "");
      editorBaselineRef.current = {
        radius: existingRule.radius || "",
        bg: existingRule.bg || "",
        color: existingRule.color || "",
        border: existingRule.border || "",
        padTop: cleanUnit(existingRule.paddingTop || existingPadding.top),
        padRight: cleanUnit(existingRule.paddingRight || existingPadding.right),
        padBottom: cleanUnit(existingRule.paddingBottom || existingPadding.bottom),
        padLeft: cleanUnit(existingRule.paddingLeft || existingPadding.left),
        marTop: cleanUnit(existingMargin.top),
        marRight: cleanUnit(existingMargin.right),
        marBottom: cleanUnit(existingMargin.bottom),
        marLeft: cleanUnit(existingMargin.left),
        width: existingRule.width || "",
        height: existingRule.height || "",
        fontSize: existingRule.fontSize || "",
        fontFamily: existingRule.fontFamily || "",
        fontWeight: existingRule.fontWeight || "",
        fontStyle: existingRule.fontStyle || "",
        textDecoration: existingRule.textDecoration || "",
        textAlign: existingRule.textAlign || "",
        lineHeight: existingRule.lineHeight || "",
      };
    } else {
      resetCustomRuleFields();
    }
  }, [settings.customRules, resetCustomRuleFields, updatePaddingStates, updateMarginStates, captureSelectedElement, loadComputedFields]);

  // State and effect for element inspector mode
  const [isInspecting, setIsInspecting] = useState(false);

  useEffect(() => {
    if (!isInspecting) return;

    // Create a style element for highlighting the hovered element
    const styleEl = document.createElement("style");
    styleEl.id = "inspector-hover-style";
    styleEl.innerHTML = `
      .inspector-hovered {
        outline: 3px solid #6b2636 !important;
        outline-offset: -3px !important;
        cursor: crosshair !important;
        transition: outline 0.08s ease-in-out !important;
      }
    `;
    document.head.appendChild(styleEl);

    let activeEl: HTMLElement | null = null;

    const handleMouseOver = (e: MouseEvent) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      
      // Do not highlight elements inside the settings panel itself
      if (target.closest('[data-ui-settings-shell="true"]')) return;

      if (activeEl && activeEl !== target) {
        activeEl.classList.remove("inspector-hovered");
      }
      activeEl = target;
      activeEl.classList.add("inspector-hovered");
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      target.classList.remove("inspector-hovered");
    };

    const getReadableSelector = (el: HTMLElement): string => {
      const escapeIdentifier = (value: string) =>
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(value)
          : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

      if (el.id) {
        return `#${escapeIdentifier(el.id)}`;
      }

      // List of highly unique/semantic classes that we can return directly if matched
      const knownUniqueClasses = [
        "navbar-header",
        "side-panel",
        "content-area",
        "table-container",
        "data-table-wrapper",
        "stat-card",
        "stat-group",
        "filter-toolbar",
        "table-card",
        "modal-content",
        "pivot-table-container",
        "master-ae-table-wrapper",
        "btn-primary",
        "btn-secondary",
        "dashboard-card",
        "section-label",
        "hero-badge"
      ];

      for (const cls of knownUniqueClasses) {
        if (
          el.classList.contains(cls) &&
          document.querySelectorAll(`.${escapeIdentifier(cls)}`).length === 1
        ) {
          return `.${cls}`;
        }
      }

      const path: string[] = [];
      let current: HTMLElement | null = el;

      while (current && current !== document.body) {
        if (current.id) {
          path.unshift(`#${escapeIdentifier(current.id)}`);
          break;
        }

        let foundUniqueParent = false;
        for (const cls of knownUniqueClasses) {
          if (
            current.classList.contains(cls) &&
            document.querySelectorAll(`.${escapeIdentifier(cls)}`).length === 1
          ) {
            path.unshift(`.${cls}`);
            foundUniqueParent = true;
            break;
          }
        }
        if (foundUniqueParent) {
          break;
        }

        const tag = current.tagName.toLowerCase();
        if (
          (tag === "main" ||
            tag === "header" ||
            tag === "nav" ||
            tag === "table" ||
            tag === "thead" ||
            tag === "tbody") &&
          document.querySelectorAll(tag).length === 1
        ) {
          path.unshift(tag);
          break;
        }

        // Filter out Tailwind utility classes, hover state classes, and custom inspector classes
        const classes = Array.from(current.classList).filter((c) => {
          return c !== "inspector-hovered" &&
                 !c.includes(":") &&
                 !c.startsWith("hover:") &&
                 !c.startsWith("focus:") &&
                 !c.startsWith("p-") &&
                 !c.startsWith("px-") &&
                 !c.startsWith("py-") &&
                 !c.startsWith("m-") &&
                 !c.startsWith("mx-") &&
                 !c.startsWith("my-") &&
                 !c.startsWith("bg-") &&
                 !c.startsWith("text-") &&
                 !c.startsWith("border-") &&
                 !c.startsWith("rounded-") &&
                 !c.startsWith("w-") &&
                 !c.startsWith("h-") &&
                 !c.startsWith("flex") &&
                 !c.startsWith("grid") &&
                 !c.startsWith("gap-") &&
                 !c.startsWith("items-") &&
                 !c.startsWith("justify-") &&
                 !c.startsWith("font-") &&
                 !c.startsWith("shadow-") &&
                 !c.startsWith("transition-") &&
                 !c.startsWith("animate-") &&
                 !c.startsWith("duration-");
        });

        // Filter to standard alphanumeric class names to avoid any special characters
        const safeClasses = classes.filter(c => /^[a-zA-Z0-9_-]+$/.test(c));

        let segment = tag;
        if (safeClasses.length > 0) {
          segment += `.${escapeIdentifier(safeClasses[0])}`;
        }

        const parent = current.parentElement;
        if (parent) {
          const sameTagSiblings = Array.from(parent.children).filter(
            (child) => child.tagName === current!.tagName,
          );
          if (sameTagSiblings.length > 1) {
            segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
          }
        }

        path.unshift(segment);
        current = current.parentElement;
      }

      const finalSelector = path.join(" > ");
      return finalSelector || el.tagName.toLowerCase();
    };

    const handleClick = (e: MouseEvent) => {
      // Prevent standard browser action & bubbling
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      if (target?.closest?.('[data-ui-settings-shell="true"]')) return;

      const selector = getReadableSelector(target);
      handleSelectorChange(selector, target);
      setIsInspecting(false);
      setCompactPanel(null);
      setIsCompactInspector(true);
      toast.dismiss();
    };

    const blockPointer = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.closest?.('[data-ui-settings-shell="true"]')) return;
      // Stop Radix from seeing pointerdown/mousedown/touchstart so it doesn't open dropdowns
      e.stopPropagation();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsInspecting(false);
        toast.dismiss();
      }
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("pointerdown", blockPointer, true);
    document.addEventListener("mousedown", blockPointer, true);
    document.addEventListener("pointerup", blockPointer, true);
    document.addEventListener("mouseup", blockPointer, true);
    document.addEventListener("touchstart", blockPointer, true);
    document.addEventListener("touchend", blockPointer, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      if (activeEl) {
        activeEl.classList.remove("inspector-hovered");
      }
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("pointerdown", blockPointer, true);
      document.removeEventListener("mousedown", blockPointer, true);
      document.removeEventListener("pointerup", blockPointer, true);
      document.removeEventListener("mouseup", blockPointer, true);
      document.removeEventListener("touchstart", blockPointer, true);
      document.removeEventListener("touchend", blockPointer, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      styleEl.remove();
    };
  }, [isInspecting, handleSelectorChange]);

  const addCustomRule = (keepSelection = false, notifySuccess = true): UiSettings | null => {
    if (!newSelector.trim()) {
      toast.error("Vui lòng nhập hoặc chọn một CSS selector!");
      return null;
    }
    const cleanSelector = newSelector.trim();
    if (!isSafeCustomSelector(cleanSelector)) {
      toast.error("CSS selector không hợp lệ. Vui lòng chọn lại phần tử.");
      return null;
    }
    const matchedElements = document.querySelectorAll(cleanSelector).length;
    if (matchedElements === 0) {
      toast.error("Selector không tìm thấy phần tử nào trên trang hiện tại.");
      return null;
    }

    const normalizedRadius = normalizeCssLength(newRadius);
    const normalizedWidth = normalizeCssLength(newWidth);
    const normalizedHeight = normalizeCssLength(newHeight);
    const normalizedFontSize = normalizeCssLength(newFontSize);
    const normalizedLineHeight = normalizeCssLength(newLineHeight);
    const normalizedPaddingTop = normalizeCssLength(padTop);
    const normalizedPaddingRight = normalizeCssLength(padRight);
    const normalizedPaddingBottom = normalizeCssLength(padBottom);
    const normalizedPaddingLeft = normalizeCssLength(padLeft);
    const margin = getCombinedMargin() || undefined;
    const baseline = editorBaselineRef.current;
    const changed = (key: string, value: string) => (baseline[key] || "") !== value;
    const paddingChanged =
      changed("padTop", padTop) || changed("padRight", padRight) ||
      changed("padBottom", padBottom) || changed("padLeft", padLeft);
    const marginChanged =
      changed("marTop", marTop) || changed("marRight", marRight) ||
      changed("marBottom", marBottom) || changed("marLeft", marLeft);
    const hasChanges =
      changed("radius", newRadius) || changed("bg", newBg) ||
      changed("color", newColor) || changed("border", newBorder) ||
      paddingChanged || marginChanged || changed("width", newWidth) ||
      changed("height", newHeight) || changed("fontSize", newFontSize) ||
      changed("fontFamily", newFontFamily) || changed("fontWeight", newFontWeight) ||
      changed("fontStyle", newFontStyle) || changed("textDecoration", newTextDecoration) ||
      changed("textAlign", newTextAlign) || changed("lineHeight", newLineHeight);

    const existingRules = settings.customRules || [];
    const index = existingRules.findIndex((r) => r.selector === cleanSelector);
    if (!hasChanges && index < 0) {
      toast.error("Hãy nhập ít nhất một thuộc tính cần thay đổi.");
      return null;
    }

    const supports = (property: string, value?: string) =>
      !value || typeof CSS === "undefined" || CSS.supports(property, value);
    if (
      !supports("border-radius", normalizedRadius) ||
      !supports("background-color", newBg.trim()) ||
      !supports("color", newColor.trim()) ||
      !supports("border", newBorder.trim()) ||
      !supports("padding-top", normalizedPaddingTop) ||
      !supports("padding-right", normalizedPaddingRight) ||
      !supports("padding-bottom", normalizedPaddingBottom) ||
      !supports("padding-left", normalizedPaddingLeft) ||
      !supports("margin", margin) ||
      !supports("width", normalizedWidth) ||
      !supports("height", normalizedHeight) ||
      !supports("font-size", normalizedFontSize) ||
      !supports("font-family", newFontFamily.trim()) ||
      !supports("font-weight", newFontWeight.trim()) ||
      !supports("font-style", newFontStyle.trim()) ||
      !supports("text-decoration-line", newTextDecoration.trim()) ||
      !supports("text-align", newTextAlign.trim()) ||
      !supports("line-height", normalizedLineHeight)
    ) {
      toast.error("Có giá trị CSS không hợp lệ. Vui lòng kiểm tra lại đơn vị hoặc màu.");
      return null;
    }

    const newRule = {
      ...(index >= 0 ? existingRules[index] : {}),
      id: index >= 0 ? existingRules[index].id : "rule-" + Date.now(),
      selector: cleanSelector,
      ...(changed("radius", newRadius) ? { radius: normalizedRadius } : {}),
      ...(changed("bg", newBg) ? { bg: newBg.trim() || undefined } : {}),
      ...(changed("color", newColor) ? { color: newColor.trim() || undefined } : {}),
      ...(changed("border", newBorder) ? { border: newBorder.trim() || undefined } : {}),
      ...(paddingChanged ? {
        padding: undefined,
        paddingTop: normalizedPaddingTop,
        paddingRight: normalizedPaddingRight,
        paddingBottom: normalizedPaddingBottom,
        paddingLeft: normalizedPaddingLeft,
      } : {}),
      ...(marginChanged ? { margin } : {}),
      ...(changed("width", newWidth) ? { width: normalizedWidth } : {}),
      ...(changed("height", newHeight) ? { height: normalizedHeight } : {}),
      ...(changed("fontSize", newFontSize) ? { fontSize: normalizedFontSize } : {}),
      ...(changed("fontFamily", newFontFamily) ? { fontFamily: newFontFamily.trim() || undefined } : {}),
      ...(changed("fontWeight", newFontWeight) ? { fontWeight: newFontWeight.trim() || undefined } : {}),
      ...(changed("fontStyle", newFontStyle) ? { fontStyle: newFontStyle.trim() || undefined } : {}),
      ...(changed("textDecoration", newTextDecoration) ? { textDecoration: newTextDecoration.trim() || undefined } : {}),
      ...(changed("textAlign", newTextAlign) ? { textAlign: newTextAlign.trim() || undefined } : {}),
      ...(changed("lineHeight", newLineHeight) ? { lineHeight: normalizedLineHeight } : {}),
    };

    let updatedRules;
    if (index >= 0) {
      updatedRules = [...existingRules];
      updatedRules[index] = newRule;
    } else {
      updatedRules = [...existingRules, newRule];
    }

    const updatedSettings = { ...settings, customRules: updatedRules };
    setSettings(updatedSettings);
    
    if (!keepSelection) {
      setNewSelector("");
      resetCustomRuleFields();
      selectedElementRef.current?.classList.remove("ui-inspector-selected");
      selectedElementRef.current = null;
      setSelectedDivInfo(null);
    }
    if (notifySuccess) {
      toast.success(
        `${index >= 0 ? "Đã cập nhật" : "Đã thêm"} style cho ${matchedElements} phần tử.`,
      );
    }
    return updatedSettings;
  };

  const persistSettings = useCallback(async (nextSettings: UiSettings) => {
    await localforage.setItem(UI_SETTINGS_KEY, nextSettings);
    persistedSettingsRef.current = nextSettings;
    const { bgImage: _bgImage, ...smallSettings } = nextSettings;
    try { localStorage.setItem(UI_SETTINGS_KEY + "_small", JSON.stringify(smallSettings)); } catch (e) { console.warn(e); }
    applyUiSettings(nextSettings);
    window.dispatchEvent(new Event("ui-settings-changed"));
  }, []);

  const applyAndPersistCurrentRule = async (keepSelection = true) => {
    const updatedSettings = addCustomRule(keepSelection, false);
    if (!updatedSettings) return false;
    try {
      await persistSettings(updatedSettings);
      syncEditorBaseline();
      toast.success(
        `Đã áp dụng style cho ${document.querySelectorAll(newSelector.trim()).length} phần tử.`,
      );
      return true;
    } catch (error) {
      console.error("Failed to persist selected DIV style", error);
      toast.error("Không thể lưu style của DIV.");
      return false;
    }
  };

  const handleChooseAnotherElement = async () => {
    if (editorHasChanges()) {
      const saved = await applyAndPersistCurrentRule(true);
      if (!saved) return;
    }
    setCompactPanel(null);
    setIsCompactInspector(false);
    setIsInspecting(true);
  };

  const removeCustomRule = async (id: string) => {
    const updatedRules = (settings.customRules || []).filter((r) => r.id !== id);
    const updatedSettings = { ...settings, customRules: updatedRules };
    setSettings(updatedSettings);
    try {
      await persistSettings(updatedSettings);
      if (newSelector && !(updatedRules || []).some((rule) => rule.selector === newSelector)) {
        const element = selectedElementRef.current;
        if (element && document.contains(element)) {
          const info = captureSelectedElement(element, newSelector);
          loadComputedFields(info);
        }
      }
      toast.success("Đã xoá style custom và khôi phục DIV.");
    } catch (error) {
      console.error("Failed to delete selected DIV style", error);
      toast.error("Không thể xoá style của DIV.");
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loaded = await loadUiSettings();
        persistedSettingsRef.current = loaded;
        setSettings(loaded);
      } catch (e) {
        console.error("Failed to load UI settings", e);
      }
    };

    if (isOpen) {
      loadSettings();
      loadUserDefaultUiSettings().then((def) => {
        setHasCustomDefault(!!def);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleCustomDefaultChange = () => {
      setHasCustomDefault(!!getUserDefaultUiSettingsSync());
    };
    window.addEventListener("ui-user-default-changed", handleCustomDefaultChange);
    return () => {
      window.removeEventListener("ui-user-default-changed", handleCustomDefaultChange);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setIsInspecting(false);
    setIsCompactInspector(false);
    setCompactPanel(null);
    setNewSelector("");
    selectedElementRef.current?.classList.remove("ui-inspector-selected");
    selectedElementRef.current = null;
    setSelectedDivInfo(null);
    resetCustomRuleFields();
    applyUiSettings(persistedSettingsRef.current);
  }, [isOpen, resetCustomRuleFields]);

  useEffect(() => {
    if (isOpen) {
      const baseline = editorBaselineRef.current;
      const changed = (key: string, value: string) => (baseline[key] || "") !== value;
      const paddingChanged =
        changed("padTop", padTop) || changed("padRight", padRight) ||
        changed("padBottom", padBottom) || changed("padLeft", padLeft);
      const marginChanged =
        changed("marTop", marTop) || changed("marRight", marRight) ||
        changed("marBottom", marBottom) || changed("marLeft", marLeft);
      const previewRule = {
        selector: newSelector.trim(),
        radius: changed("radius", newRadius) ? newRadius : undefined,
        bg: changed("bg", newBg) ? newBg : undefined,
        color: changed("color", newColor) ? newColor : undefined,
        border: changed("border", newBorder) ? newBorder : undefined,
        paddingTop: paddingChanged ? normalizeCssLength(padTop) : undefined,
        paddingRight: paddingChanged ? normalizeCssLength(padRight) : undefined,
        paddingBottom: paddingChanged ? normalizeCssLength(padBottom) : undefined,
        paddingLeft: paddingChanged ? normalizeCssLength(padLeft) : undefined,
        margin: marginChanged ? getCombinedMargin() : undefined,
        width: changed("width", newWidth) ? newWidth : undefined,
        height: changed("height", newHeight) ? newHeight : undefined,
        fontSize: changed("fontSize", newFontSize) ? newFontSize : undefined,
        fontFamily: changed("fontFamily", newFontFamily) ? newFontFamily : undefined,
        fontWeight: changed("fontWeight", newFontWeight) ? newFontWeight : undefined,
        fontStyle: changed("fontStyle", newFontStyle) ? newFontStyle : undefined,
        textDecoration: changed("textDecoration", newTextDecoration) ? newTextDecoration : undefined,
        textAlign: changed("textAlign", newTextAlign) ? newTextAlign : undefined,
        lineHeight: changed("lineHeight", newLineHeight) ? newLineHeight : undefined,
      };
      applyUiSettings(settings, previewRule);
    }
  }, [settings, isOpen, newSelector, newRadius, newBg, newColor, newBorder, getCombinedMargin, padTop, padRight, padBottom, padLeft, marTop, marRight, marBottom, marLeft, newWidth, newHeight, newFontSize, newFontFamily, newFontWeight, newFontStyle, newTextDecoration, newTextAlign, newLineHeight]);

  const saveSettings = async () => {
    let settingsToPersist = settings;
    if (
      activeModalTab === "div_selector" &&
      newSelector.trim() &&
      editorHasChanges()
    ) {
      const updatedSettings = addCustomRule(true, false);
      if (!updatedSettings) return;
      settingsToPersist = updatedSettings;
    }

    try {
      await persistSettings(settingsToPersist);
      syncEditorBaseline();
      toast.dismiss();
      toast.success("Đã lưu cài đặt!");
    } catch (e) {
      console.error("Failed to save UI settings", e);
      toast.dismiss();
      toast.error("Không thể lưu cài đặt.");
      return;
    }

    onClose();
  };

  const saveCompactSettings = async () => {
    const updatedSettings = addCustomRule(true, false);
    if (!updatedSettings) return;

    try {
      await persistSettings(updatedSettings);
      syncEditorBaseline();
      toast.success("Đã lưu style của DIV.");
      onClose();
    } catch (error) {
      console.error("Failed to save selected DIV style", error);
      toast.error("Không thể lưu style của DIV.");
    }
  };

  const saveAsCustomDefault = async () => {
    let settingsToPersist = settings;
    if (
      activeModalTab === "div_selector" &&
      newSelector.trim() &&
      editorHasChanges()
    ) {
      const updatedSettings = addCustomRule(true, false);
      if (!updatedSettings) return;
      settingsToPersist = updatedSettings;
    }

    try {
      const defaultToSave: UiSettings = {
        ...settingsToPersist,
        preset: "default",
      };
      setSettings(defaultToSave);
      await saveUserDefaultUiSettings(defaultToSave);
      await persistSettings(defaultToSave);
      setHasCustomDefault(true);
      syncEditorBaseline();
      toast.dismiss();
      toast.success("Đã lưu giao diện hiện tại thành giao diện mẫu mặc định!");
    } catch (e) {
      console.error("Failed to save default UI settings", e);
      toast.dismiss();
      toast.error("Không thể lưu giao diện làm mặc định.");
    }
  };

  const resetSettings = async () => {
    toast.info("Đang khôi phục giao diện mẫu mặc định...");
    const userDef = await loadUserDefaultUiSettings();
    const targetSettings = userDef
      ? { ...defaultSettings, ...userDef, preset: "default" }
      : defaultSettings;
    setSettings(targetSettings);
    persistedSettingsRef.current = targetSettings;
    await persistSettings(targetSettings);
    toast.dismiss();
    toast.success("Đã khôi phục về giao diện mẫu mặc định!");
    onClose();
  };

  const handleClearAll = async () => {
    updateAppData((prev) => createClearedWebData(prev), false);
    localStorage.removeItem("pivot_master_processed_data");
    localStorage.removeItem("pivot_mkt_type_cache");

    if (isSupabaseConfigured()) {
      try {
        await clearSupabaseRosterData();
      } catch (error) {
        console.error("Failed to clear Supabase Timesheet roster", error);
        toast.error("Đã xóa dữ liệu trên web nhưng chưa xóa được Roster trên Supabase.");
      }
    }
    setShowClearConfirm(false);
    toast.success("Đã xóa toàn bộ dữ liệu Timesheet, Audit, Balance và Master.");
    onClose();
  };

  const toggleTextDecoration = (decoration: "underline" | "line-through") => {
    setNewTextDecoration((current) => {
      const values = new Set(
        String(current || "")
          .split(/\s+/)
          .filter((value) => value && value !== "none"),
      );
      if (values.has(decoration)) values.delete(decoration);
      else values.add(decoration);
      return values.size > 0 ? Array.from(values).join(" ") : "none";
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {isInspecting && (
        <div data-ui-settings-shell="true" className="fixed top-4 left-1/2 -translate-x-1/2 bg-[#6b2636] text-white px-4 py-2.5 rounded-lg shadow-2xl z-[100001] flex items-center gap-3 border-2 border-white font-sans text-xs font-bold pointer-events-auto select-none animate-in fade-in slide-in-from-top-4 duration-300">
          <Target className="w-4 h-4 animate-pulse text-rose-300" />
          <span>Di chuột và click vào phần tử trên màn hình để chọn. Nhấn ESC để huỷ.</span>
          <button
            type="button"
            onClick={() => setIsInspecting(false)}
            className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded cursor-pointer transition-all border border-white/30 text-[10px] uppercase font-bold"
          >
            Huỷ
          </button>
        </div>
      )}

      {isCompactInspector && selectedDivInfo && (
        <>
          {compactPanel && (
            <div
              data-ui-settings-shell="true"
              className="fixed bottom-[76px] left-1/2 z-[100002] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#1f1f21] p-4 text-white shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300">
                  {compactPanel === "type" ? "Kiểu chữ" : compactPanel === "spacing" ? "Kích thước & khoảng cách" : "Màu & đường viền"}
                </span>
                <button type="button" onClick={() => setCompactPanel(null)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {compactPanel === "type" && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Font family</span>
                    <input value={newFontFamily} onChange={(event) => setNewFontFamily(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/30" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[["Font size", newFontSize, setNewFontSize], ["Line height", newLineHeight, setNewLineHeight]].map(([label, value, setter]) => (
                      <label key={String(label)}>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">{String(label)}</span>
                        <div className="relative flex items-center">
                          <input
                            value={value as string}
                            onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
                            className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-3 pr-8 tabular-nums text-sm outline-none focus:border-white/30"
                          />
                          <StepperButtons
                            value={value as string}
                            setter={setter as (val: string) => void}
                            className="right-2"
                            btnClassName="h-3.5 w-4 text-[9px] text-slate-300 hover:text-white"
                          />
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Bold", icon: Bold, active: Number(newFontWeight) >= 600, onClick: () => setNewFontWeight(Number(newFontWeight) >= 600 ? "400" : "700") },
                      { label: "Italic", icon: Italic, active: newFontStyle === "italic", onClick: () => setNewFontStyle(newFontStyle === "italic" ? "normal" : "italic") },
                      { label: "Underline", icon: Underline, active: newTextDecoration.includes("underline"), onClick: () => toggleTextDecoration("underline") },
                      { label: "Gạch ngang", icon: Strikethrough, active: newTextDecoration.includes("line-through"), onClick: () => toggleTextDecoration("line-through") },
                    ].map(({ label, icon: Icon, active, onClick }) => (
                      <button key={label} type="button" onClick={onClick} title={label} className={`flex h-10 w-10 items-center justify-center rounded-xl border ${active ? "border-white bg-white text-slate-950" : "border-white/10 text-slate-300 hover:bg-white/10"}`}>
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                    <span className="mx-1 h-10 w-px bg-white/10" />
                    {[
                      { value: "left", label: "Căn trái", icon: AlignLeft },
                      { value: "center", label: "Căn giữa", icon: AlignCenter },
                      { value: "right", label: "Căn phải", icon: AlignRight },
                      { value: "justify", label: "Căn đều", icon: AlignJustify },
                    ].map(({ value, label, icon: Icon }) => (
                      <button key={value} type="button" onClick={() => setNewTextAlign(value)} title={label} className={`flex h-10 w-10 items-center justify-center rounded-xl border ${newTextAlign === value ? "border-white bg-white text-slate-950" : "border-white/10 text-slate-300 hover:bg-white/10"}`}>
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {compactPanel === "spacing" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {[["Width", newWidth, setNewWidth], ["Height", newHeight, setNewHeight]].map(([label, value, setter]) => (
                      <label key={String(label)}>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">{String(label)} (px)</span>
                        <div className="relative flex items-center">
                          <input
                            value={value as string}
                            onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
                            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-3 pr-8 tabular-nums text-base outline-none focus:border-white/30"
                          />
                          <StepperButtons
                            value={value as string}
                            setter={setter as (val: string) => void}
                            className="right-2"
                            btnClassName="h-4 w-5 text-[10px] text-slate-300 hover:text-white"
                          />
                        </div>
                      </label>
                    ))}
                  </div>
                  {[
                    ["Padding (px)", [[padTop, setPadTop, "T"], [padRight, setPadRight, "R"], [padBottom, setPadBottom, "B"], [padLeft, setPadLeft, "L"]]],
                    ["Margin (px)", [[marTop, setMarTop, "T"], [marRight, setMarRight, "R"], [marBottom, setMarBottom, "B"], [marLeft, setMarLeft, "L"]]],
                  ].map(([groupLabel, fields]) => (
                    <div key={String(groupLabel)}>
                      <span className="mb-2 block text-sm font-medium text-slate-300">{String(groupLabel)}</span>
                      <div className="grid grid-cols-2 gap-2">
                        {(fields as Array<[string, React.Dispatch<React.SetStateAction<string>>, string]>).map(([value, setter, label]) => (
                          <label key={label} className="relative flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/5 pl-3 pr-8">
                            <span className="w-4 text-[10px] font-black text-slate-500">{label}</span>
                            <input value={value} onChange={(event) => setter(event.target.value)} className="min-w-0 flex-1 bg-transparent tabular-nums text-base outline-none pr-2" />
                            <StepperButtons
                              value={value}
                              setter={setter}
                              className="right-2"
                              btnClassName="h-4 w-5 text-[10px] text-slate-300 hover:text-white"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {compactPanel === "paint" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    ["Nền", newBg, setNewBg], ["Màu chữ", newColor, setNewColor],
                    ["Viền", newBorder, setNewBorder], ["Bo góc", newRadius, setNewRadius],
                  ].map(([label, value, setter]) => (
                    <label key={String(label)}>
                      <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">{String(label)}</span>
                      {label === "Bo góc" ? (
                        <div className="relative flex items-center">
                          <input
                            value={value as string}
                            onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
                            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-3 pr-8 tabular-nums text-xs outline-none focus:border-white/30"
                          />
                          <StepperButtons
                            value={value as string}
                            setter={setter as (val: string) => void}
                            className="right-2"
                            btnClassName="h-4 w-5 text-[10px] text-slate-300 hover:text-white"
                          />
                        </div>
                      ) : (
                        <input value={value as string} onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 tabular-nums text-xs outline-none focus:border-white/30" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            data-ui-settings-shell="true"
            className="fixed bottom-4 left-1/2 z-[100001] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-stretch overflow-hidden rounded-2xl border border-white/15 bg-[#1f1f21] text-white shadow-2xl"
          >
            <button type="button" onClick={() => void handleChooseAnotherElement()} title="Chọn DIV khác" className="flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
              <Target className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCompactPanel((value) => value === "paint" ? null : "paint")} title="Màu & viền" className={`flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 transition-colors ${compactPanel === "paint" ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
              <PaintBucket className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCompactPanel((value) => value === "type" ? null : "type")} title="Kiểu chữ" className={`flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 transition-colors ${compactPanel === "type" ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
              <Type className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCompactPanel((value) => value === "spacing" ? null : "spacing")} title="Kích thước & khoảng cách" className={`flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 transition-colors ${compactPanel === "spacing" ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
              <Ruler className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { setCompactPanel(null); setIsCompactInspector(false); }} title="Mở bảng cài đặt đầy đủ" className="flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
              <PanelTopOpen className="h-4 w-4" />
            </button>
            {settings.customRules?.some((rule) => rule.selector === newSelector) && (
              <button
                type="button"
                onClick={() => {
                  const rule = settings.customRules?.find((item) => item.selector === newSelector);
                  if (rule) void removeCustomRule(rule.id);
                }}
                title="Xoá style của DIV"
                className="flex h-12 w-11 shrink-0 items-center justify-center border-r border-white/10 text-rose-300 hover:bg-rose-500/20 hover:text-rose-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => void applyAndPersistCurrentRule(true)} className="flex h-12 min-w-16 items-center justify-center gap-1 border-r border-white/10 px-2 text-[8px] font-black uppercase tracking-wider text-slate-200 hover:bg-white/10 hover:text-white">
              <Check className="h-4 w-4" /> Áp dụng
            </button>
            <button type="button" onClick={saveCompactSettings} className="h-12 min-w-16 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-950 hover:bg-slate-200">
              Lưu
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Đóng tùy chỉnh DIV"
              aria-label="Đóng tùy chỉnh DIV"
              className="flex h-12 w-11 shrink-0 items-center justify-center border-l border-white/10 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      <div 
        data-ui-settings-shell="true"
        className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-300 ${
          isInspecting || isCompactInspector
            ? "bg-transparent pointer-events-none" 
            : "bg-black/45 backdrop-blur-sm pointer-events-auto overflow-y-auto"
        }`}
        onClick={onClose}
      >
        <div 
          className={`bg-white border-4 border-primary rounded-2xl shadow-hard-lg w-[96vw] max-w-[960px] max-h-[92vh] h-[92vh] flex flex-col overflow-hidden transition-all duration-300 pointer-events-auto ${
            isInspecting || isCompactInspector ? "opacity-0 pointer-events-none scale-95 invisible" : "scale-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 flex justify-between items-center bg-background border-b-2 border-primary/10">
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  value={activeModalTab}
                  onChange={(e) => setActiveModalTab(e.target.value as "general" | "div_selector")}
                  aria-label="Chọn chế độ hiển thị cài đặt giao diện"
                  className="appearance-none bg-white border-2 border-primary rounded-lg pl-3 pr-8 py-1.5 font-bold text-xs text-primary focus:outline-none cursor-pointer shadow-sm"
                >
                  <option value="general">⚙️ Cài đặt chung (General)</option>
                  <option value="div_selector">📐 Quản lý DIV & Style (Trang lớn)</option>
                </select>
                <ChevronDown className="w-4 h-4 text-primary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <h3 className="font-black text-lg uppercase flex items-center gap-2 text-primary tracking-wide hidden sm:flex">
                <Settings2 className="w-5 h-5 text-accent animate-pulse" /> {activeModalTab === "general" ? "Cài đặt Giao diện" : "Trang Quản lý DIV & Style"}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label="Đóng cài đặt giao diện"
              className="p-1.5 hover:bg-primary/10 rounded-lg border-2 border-transparent hover:border-primary transition-all text-primary cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 flex-1 overflow-y-auto bg-slate-50/50 text-primary custom-scrollbar">
            {activeModalTab === "div_selector" ? (
              /* Trang Quản lý DIV & Style: CHỈ CHỨA MỤC 2 */
              <div className="max-w-4xl mx-auto w-full">
                <div className="bg-white p-5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-4">
                  <h4 className="font-black text-sm text-primary tracking-widest uppercase border-b-2 border-primary/10 pb-2">
                    2. FONT CHỮ & HIỂN THỊ (QUẢN LÝ DIV & STYLE)
                  </h4>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-[0.8125rem]">
                      Font chữ Bảng (Table Font)
                    </label>
                    <select
                      value={settings.tableFont || "var(--font-main)"}
                      onChange={(e) =>
                        setSettings({ ...settings, tableFont: e.target.value })
                      }
                      className="w-full border-2 border-primary rounded-lg p-2 font-bold text-sm outline-none focus:shadow-hard-sm transition-all bg-white text-primary"
                    >
                      <option value="var(--font-main)">Plus Jakarta Sans (Mặc định / Chuẩn)</option>
                      <option value="var(--font-be-vietnam)">Be Vietnam Pro (Tối ưu Tiếng Việt hoàn hảo)</option>
                      <option value="var(--font-newsreader)">Newsreader (Serif Cổ điển / Báo chí)</option>
                      <option value="var(--font-port-lligat-slab)">Gentium Book Plus (Serif Thanh lịch)</option>
                      <option value="var(--font-nunito)">Nunito (Mềm mại)</option>
                      <option value="var(--font-space-grotesk)">Space Grotesk (Công nghệ / Rõ nét)</option>
                    </select>
                  </div>

                  {/* Font chữ Tiêu đề Bảng + tích Thay đổi cả chữ cái đầu */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/80">
                    <label className="font-bold text-[0.8125rem] text-slate-800">
                      Font chữ Tiêu đề Bảng (Table Title Font)
                    </label>
                    <select
                      value={settings.titleFont || "Voyage"}
                      onChange={(e) =>
                        setSettings({ ...settings, titleFont: e.target.value })
                      }
                      className="w-full border-2 border-primary rounded-lg p-2 font-bold text-sm outline-none focus:shadow-hard-sm transition-all bg-white text-primary cursor-pointer"
                    >
                      {TITLE_FONT_OPTIONS.map((fontOpt) => (
                        <option key={fontOpt.id} value={fontOpt.id}>
                          {fontOpt.label}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none mt-0.5">
                      <input
                        type="checkbox"
                        checked={Boolean(settings.titleFontIncludeInitial)}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            titleFontIncludeInitial: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-primary accent-primary cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        Thay đổi cả chữ cái đầu
                      </span>
                    </label>
                    <p className="text-[10px] font-medium text-slate-500">
                      Mặc định (không tích): chỉ thay đổi phần chữ phía sau chữ cái đầu của tiêu đề bảng. Khi tích chọn: áp dụng font mới cho cả chữ cái đầu và phần chữ theo sau.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 mt-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="table-font-size" className="font-bold text-[0.8125rem]">
                        Cỡ chữ của bảng
                      </label>
                      <span className="text-xs font-bold">{settings.fontSize || "13px"}</span>
                    </div>
                    <input
                      id="table-font-size"
                      type="range"
                      min="9"
                      max="20"
                      step="1"
                      value={parseFloat(settings.fontSize || "13") || 13}
                      onChange={(e) =>
                        setSettings({ ...settings, fontSize: `${e.target.value}px` })
                      }
                      className="w-full accent-primary"
                    />
                    <p className="text-[10px] font-medium text-gray-500">
                      Áp dụng đồng nhất cho tiêu đề, nội dung, dòng tổng và chân phân trang.
                    </p>
                  </div>

                  {/* Khoảng cách hàng bảng (Table Row Padding Toggle) */}
                  <div className="flex flex-col gap-1.5 mt-2.5 pt-2.5 border-t border-slate-200/80">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-[0.8125rem] text-slate-800">
                        Khoảng cách hàng bảng (Table Row Padding)
                      </label>
                      <span className="text-[11px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded-md">
                        {(settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "compact"
                          ? "Compact (Gọn)"
                          : "Comfortable (Rộng)"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            tablePaddingMode: "compact",
                            tablePadding: "4px 8px",
                          })
                        }
                        className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                          (settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "compact"
                            ? "bg-white text-primary shadow-xs border border-slate-200/80"
                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                        }`}
                      >
                        <Ruler className="w-3.5 h-3.5" />
                        <span>Compact (Gọn nhẹ)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            tablePaddingMode: "comfortable",
                            tablePadding: "12px 16px",
                          })
                        }
                        className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                          (settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "comfortable"
                            ? "bg-white text-primary shadow-xs border border-slate-200/80"
                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                        }`}
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Comfortable (Thoải mái)</span>
                      </button>
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">
                      Chuyển đổi giữa chế độ Compact (gọn nhẹ, nhiều dòng) và Comfortable (thoải mái, khoảng cách thoáng).
                    </p>
                  </div>

                  {/* Custom Element Selector Styles */}
                  <div className="flex flex-col gap-2 mt-3 border-t border-primary/10 pt-3">
                      <label className="font-black text-xs text-primary/75 uppercase tracking-wider">
                        Chỉ định DIV & sửa styles
                      </label>
                      <p className="text-[10px] font-medium leading-relaxed text-primary/60">
                        Chỉ nhập thuộc tính muốn đổi. Ô để trống sẽ giữ nguyên định dạng gốc của DIV và các phần tử con.
                      </p>
                    
                    <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-primary/10 text-xs">
                      {/* Preset selectors quick pick */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.65rem] font-bold text-primary/60 uppercase">Chọn nhanh phần tử:</span>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { label: "Bảng điều khiển (Navbar)", val: "#app-navbar, .navbar-header" },
                            { label: "Thanh bên (Sidebar)", val: "#app-sidebar, .side-panel" },
                            { label: "Vùng làm việc (Main Content)", val: "#main-content, .content-area" },
                            { label: "Vùng chứa Bảng (Table)", val: ".table-container, .data-table-wrapper" },
                            { label: "Vùng chứa trong Bảng (Table Div)", val: ".master-ae-table-wrapper > div.min-h-0" },
                            { label: "Tiêu đề Bảng (Header TH)", val: ".table-container thead th, .data-table-wrapper thead th" },
                            { label: "Thẻ Thống kê (Stat Card)", val: ".stat-card, .stat-group" },
                            { label: "Nút bấm chính (Button)", val: "button.btn-primary, .btn-primary" },
                            { label: "Thanh bộ lọc (Filter Toolbar)", val: ".filter-toolbar" }
                          ].map((p) => (
                            <button
                              key={p.val}
                              onClick={() => handleSelectorChange(p.val)}
                              type="button"
                              className="text-[0.55rem] font-bold bg-white border border-primary/20 hover:border-primary hover:bg-primary/5 px-2 py-1 rounded text-primary transition-all cursor-pointer"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Selector Input */}
                      <div className="flex flex-col gap-1 mt-1">
                        <div className="flex justify-between items-center">
                          <span className="text-[0.65rem] font-bold text-primary/60 uppercase">CSS Selector:</span>
                          <button
                            type="button"
                            onClick={() => setIsInspecting(!isInspecting)}
                            className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded transition-all cursor-pointer border flex items-center gap-1 ${
                              isInspecting
                                ? "bg-red-500 text-white border-red-500 hover:bg-red-600 animate-pulse"
                                : "bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 hover:border-primary"
                            }`}
                          >
                            <Target className="w-3 h-3" />
                            {isInspecting ? "Đang chọn... (Nhấn ESC)" : "Chọn từ màn hình"}
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. .side-panel hoặc #my-div"
                          value={newSelector}
                          onChange={(e) => handleSelectorChange(e.target.value)}
                          className="w-full border border-primary/20 rounded p-1.5 bg-white text-primary text-xs outline-none focus:border-primary"
                        />
                      </div>

                      {/* Styles Inputs */}
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Bo góc (Radius):</span>
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              placeholder="e.g. 16px hoặc 1rem"
                              value={newRadius}
                              onChange={(e) => setNewRadius(e.target.value)}
                              className="w-full border border-primary/20 rounded p-1 pr-5 bg-white text-primary text-xs outline-none"
                            />
                            <StepperButtons
                              value={newRadius}
                              setter={setNewRadius}
                              className="right-0.5 text-slate-500 hover:text-slate-800"
                              btnClassName="h-3 w-3.5 text-[8px] hover:bg-slate-200"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Màu nền (Bg):</span>
                          <input
                            type="text"
                            placeholder="e.g. #ff0000, red, transparent"
                            value={newBg}
                            onChange={(e) => setNewBg(e.target.value)}
                            className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Màu chữ (Color):</span>
                          <input
                            type="text"
                            placeholder="e.g. #000, white"
                            value={newColor}
                            onChange={(e) => setNewColor(e.target.value)}
                            className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Viền (Border):</span>
                          <input
                            type="text"
                            placeholder="e.g. 2px solid #000"
                            value={newBorder}
                            onChange={(e) => setNewBorder(e.target.value)}
                            className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 mt-1 border-t border-primary/5 pt-2">
                        <span className="text-[0.65rem] font-bold text-primary/70 uppercase">Khoảng đệm (Padding):</span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            ["Top (px)", padTop, setPadTop],
                            ["Right (px)", padRight, setPadRight],
                            ["Bottom (px)", padBottom, setPadBottom],
                            ["Left (px)", padLeft, setPadLeft],
                          ].map(([lbl, val, sttr]) => (
                            <div key={lbl as string} className="flex flex-col gap-0.5">
                              <span className="text-[0.55rem] font-bold text-primary/60 text-center">{lbl as string}</span>
                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  placeholder="0"
                                  value={val as string}
                                  onChange={(e) => (sttr as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}
                                  className="w-full border border-primary/20 rounded p-1 pr-4 bg-white text-primary text-xs outline-none text-center"
                                />
                                <StepperButtons
                                  value={val as string}
                                  setter={sttr as (v: string) => void}
                                  className="right-0.5 text-slate-500 hover:text-slate-800"
                                  btnClassName="h-3 w-3 text-[7px] hover:bg-slate-200"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 mt-1 border-t border-primary/5 pt-2">
                        <span className="text-[0.65rem] font-bold text-primary/70 uppercase">Lề ngoài (Margin):</span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            ["Top (px)", marTop, setMarTop],
                            ["Right (px)", marRight, setMarRight],
                            ["Bottom (px)", marBottom, setMarBottom],
                            ["Left (px)", marLeft, setMarLeft],
                          ].map(([lbl, val, sttr]) => (
                            <div key={lbl as string} className="flex flex-col gap-0.5">
                              <span className="text-[0.55rem] font-bold text-primary/60 text-center">{lbl as string}</span>
                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  placeholder="0"
                                  value={val as string}
                                  onChange={(e) => (sttr as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}
                                  className="w-full border border-primary/20 rounded p-1 pr-4 bg-white text-primary text-xs outline-none text-center"
                                />
                                <StepperButtons
                                  value={val as string}
                                  setter={sttr as (v: string) => void}
                                  className="right-0.5 text-slate-500 hover:text-slate-800"
                                  btnClassName="h-3 w-3 text-[7px] hover:bg-slate-200"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-1">
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Cỡ chữ (Font Size):</span>
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              placeholder="e.g. 14px, 1rem"
                              value={newFontSize}
                              onChange={(e) => setNewFontSize(e.target.value)}
                              className="w-full border border-primary/20 rounded p-1 pr-5 bg-white text-primary text-xs outline-none"
                            />
                            <StepperButtons
                              value={newFontSize}
                              setter={setNewFontSize}
                              className="right-0.5 text-slate-500 hover:text-slate-800"
                              btnClassName="h-3 w-3.5 text-[8px] hover:bg-slate-200"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Rộng (Width):</span>
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              placeholder="e.g. 280px hoặc 100%"
                              value={newWidth}
                              onChange={(e) => setNewWidth(e.target.value)}
                              className="w-full border border-primary/20 rounded p-1 pr-5 bg-white text-primary text-xs outline-none"
                            />
                            <StepperButtons
                              value={newWidth}
                              setter={setNewWidth}
                              className="right-0.5 text-slate-500 hover:text-slate-800"
                              btnClassName="h-3 w-3.5 text-[8px] hover:bg-slate-200"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Cao (Height):</span>
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              placeholder="e.g. 500px hoặc auto"
                              value={newHeight}
                              onChange={(e) => setNewHeight(e.target.value)}
                              className="w-full border border-primary/20 rounded p-1 pr-5 bg-white text-primary text-xs outline-none"
                            />
                            <StepperButtons
                              value={newHeight}
                              setter={setNewHeight}
                              className="right-0.5 text-slate-500 hover:text-slate-800"
                              btnClassName="h-3 w-3.5 text-[8px] hover:bg-slate-200"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 grid grid-cols-2 gap-2 border-t border-primary/5 pt-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Font family:</span>
                          <input
                            type="text"
                            value={newFontFamily}
                            onChange={(e) => setNewFontFamily(e.target.value)}
                            className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Line height:</span>
                          <input
                            type="text"
                            value={newLineHeight}
                            onChange={(e) => setNewLineHeight(e.target.value)}
                            className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Font weight / style:</span>
                          <div className="grid grid-cols-2 gap-1">
                            <input
                              type="text"
                              value={newFontWeight}
                              onChange={(e) => setNewFontWeight(e.target.value)}
                              className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                            />
                            <select
                              value={newFontStyle}
                              onChange={(e) => setNewFontStyle(e.target.value)}
                              className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                            >
                              <option value="normal">Normal</option>
                              <option value="italic">Italic</option>
                              <option value="oblique">Oblique</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.6rem] font-bold text-primary/60">Căn chữ / trang trí:</span>
                          <div className="grid grid-cols-2 gap-1">
                            <select
                              value={newTextAlign}
                              onChange={(e) => setNewTextAlign(e.target.value)}
                              className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                              <option value="justify">Justify</option>
                              <option value="start">Start</option>
                              <option value="end">End</option>
                            </select>
                            <input
                              type="text"
                              value={newTextDecoration}
                              onChange={(e) => setNewTextDecoration(e.target.value)}
                              className="border border-primary/20 rounded p-1 bg-white text-primary text-xs outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void applyAndPersistCurrentRule(false)}
                        className="mt-2 w-full bg-primary text-white hover:bg-primary/90 font-bold py-1.5 rounded transition-all text-[0.65rem] uppercase tracking-wider cursor-pointer"
                      >
                        ÁP DỤNG & CỐ ĐỊNH STYLE
                      </button>
                    </div>

                    {/* List of custom styles configured */}
                    {settings.customRules && settings.customRules.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-2 max-h-40 overflow-y-auto border border-primary/10 rounded-lg p-2 bg-white">
                        <span className="text-[0.6rem] font-black uppercase text-primary/50">Danh sách style đã đổi:</span>
                        {settings.customRules.map((rule) => (
                          <div key={rule.id} className="flex justify-between items-center text-[0.65rem] border-b border-primary/5 pb-1 gap-2">
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="tabular-nums text-primary font-bold truncate">{rule.selector}</span>
                              <span className="text-primary/60 font-medium text-[0.55rem] truncate">
                                {[
                                  rule.radius && `r: ${rule.radius}`,
                                  rule.bg && `bg: ${rule.bg}`,
                                  rule.color && `c: ${rule.color}`,
                                  rule.fontSize && `fs: ${rule.fontSize}`,
                                  rule.fontFamily && `font: ${rule.fontFamily}`,
                                  rule.fontWeight && `weight: ${rule.fontWeight}`,
                                  rule.fontStyle && `style: ${rule.fontStyle}`,
                                  rule.textDecoration && `decoration: ${rule.textDecoration}`,
                                  rule.textAlign && `align: ${rule.textAlign}`,
                                  rule.lineHeight && `lh: ${rule.lineHeight}`,
                                  rule.border && `b: ${rule.border}`,
                                  rule.padding && `p: ${rule.padding}`,
                                  rule.margin && `m: ${rule.margin}`,
                                  rule.width && `w: ${rule.width}`,
                                  rule.height && `h: ${rule.height}`
                                ].filter(Boolean).join(" // ")}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void removeCustomRule(rule.id)}
                              className="text-red-500 hover:text-red-700 font-bold px-1 rounded hover:bg-red-50 cursor-pointer text-[0.55rem] uppercase tracking-wider shrink-0"
                            >
                              Xoá
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* General settings use a single scrolling column. */
              <div className="flex flex-col gap-5 w-full">
                {/* CỘT TRÁI (LEFT COLUMN - 5 COLS): GIAO DIỆN MẪU, XEM TRƯỚC, FONT & THAO TÁC */}
                <div className="flex flex-col gap-4 w-full">
                  {/* 1. GIAO DIỆN MẪU & XEM TRƯỚC */}
                  <div className="bg-white p-4.5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b-2 border-primary/10 pb-2">
                      <h4 className="font-black text-xs sm:text-sm text-primary tracking-widest uppercase flex items-center gap-1.5">
                        <PaintBucket className="w-4 h-4 text-accent" />
                        1. GIAO DIỆN MẪU & XEM TRƯỚC
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
                        Taste-Skill
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="preset-select" className="font-bold text-[0.8125rem] text-primary">
                        Chọn giao diện mẫu (Taste Preset):
                      </label>
                      <select
                        id="preset-select"
                        value={settings.preset || "default"}
                        onChange={async (e) => {
                          const pId = e.target.value;
                          if (pId === "default") {
                            const userDef = await loadUserDefaultUiSettings();
                            const targetSettings = userDef
                              ? { ...defaultSettings, ...userDef, preset: "default" }
                              : defaultSettings;
                            setSettings(targetSettings);
                            toast.success("Đã áp dụng giao diện mẫu mặc định (Đã lưu cố định)");
                            return;
                          }
                          const presetData = getVisibleTastePresets().find(p => p.id === pId);
                          if (presetData) {
                            setSettings((prev) => ({
                              ...prev,
                              preset: pId,
                              bg: presetData.bg,
                              accent: presetData.accent,
                              text: presetData.text,
                              border: presetData.border,
                              stripeColor1: presetData.stripeColor1,
                              stripeColor2: presetData.stripeColor2,
                              gridLineColor: presetData.gridLineColor,
                              tableHeaderBg: presetData.tableHeaderBg,
                              tableFooterBg: presetData.tableFooterBg,
                              tableColumnHeaderBg: presetData.tableColumnHeaderBg,
                              tableColumnHeaderTextColor: presetData.tableColumnHeaderTextColor,
                              tableDataBg: presetData.tableDataBg,
                              tableFont: presetData.tableFont,
                              tableRadius: "0px",
                            }));
                            toast.success(`Đã áp dụng giao diện: ${presetData.name}`);
                          }
                        }}
                        className="w-full border-2 border-primary rounded-lg p-2 font-bold text-xs sm:text-sm outline-none focus:shadow-hard-sm transition-all bg-white text-primary cursor-pointer"
                      >
                        {getVisibleTastePresets().map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" disabled={getVisibleTastePresets().length <= 1} className="self-end text-xs text-destructive disabled:opacity-40 inline-flex items-center gap-1" onClick={async () => {
                        deleteTastePreset(settings.preset || "default");
                        const fallback = getVisibleTastePresets()[0];
                        const next = { ...settings, ...fallback, preset: fallback.id, tableRadius: "0px" };
                        setSettings(next);
                        await saveUiSettings(next);
                        if (hasCustomDefault) await saveUserDefaultUiSettings(next);
                        persistedSettingsRef.current = next;
                        toast.success("Đã xoá giao diện mẫu khỏi danh sách");
                      }}><Trash2 className="w-3 h-3" /> Xoá giao diện mẫu</button>
                      <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                        * Chọn giao diện mẫu sẽ đồng bộ bảng màu, phông chữ và bo góc chuẩn Taste-Skill.
                      </p>
                    </div>

                    {/* Tuỳ chỉnh Font chữ Tiêu đề Bảng ngay trong mục 1 */}
                    <div className="flex flex-col gap-2 rounded-lg border border-primary/15 bg-slate-50/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="title-font-select"
                          className="font-bold text-[0.8125rem] text-primary flex items-center gap-1.5"
                        >
                          <Type className="w-3.5 h-3.5 text-accent" />
                          Font chữ Tiêu đề Bảng (Table Title Font):
                        </label>
                        <span className="text-[10px] font-mono text-slate-500">
                          {settings.titleFontIncludeInitial
                            ? "Cả chữ cái đầu + phần sau"
                            : "Mặc định: Phần chữ sau chữ cái đầu"}
                        </span>
                      </div>

                      <select
                        id="title-font-select"
                        value={settings.titleFont || "Voyage"}
                        onChange={(e) =>
                          setSettings({ ...settings, titleFont: e.target.value })
                        }
                        className="w-full border-2 border-primary rounded-lg p-2 font-bold text-xs sm:text-sm outline-none focus:shadow-hard-sm transition-all bg-white text-primary cursor-pointer"
                      >
                        {TITLE_FONT_OPTIONS.map((fontOpt) => (
                          <option key={fontOpt.id} value={fontOpt.id}>
                            {fontOpt.label}
                          </option>
                        ))}
                      </select>

                      <label
                        htmlFor="title-font-include-initial"
                        className="inline-flex items-center gap-2 cursor-pointer select-none pt-0.5"
                      >
                        <input
                          id="title-font-include-initial"
                          type="checkbox"
                          checked={Boolean(settings.titleFontIncludeInitial)}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              titleFontIncludeInitial: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-primary accent-primary cursor-pointer"
                        />
                        <span className="text-xs font-bold text-primary">
                          Thay đổi cả chữ cái đầu
                        </span>
                      </label>

                      <div className="mt-1 flex items-center justify-between rounded-md border border-primary/15 bg-white px-3 py-2">
                        <div
                          className={`app-table-title-line ${
                            settings.titleFontIncludeInitial
                              ? "app-table-title-line--font-mode"
                              : ""
                          }`}
                          style={
                            {
                              "--font-table-title": resolveTitleFontStack(
                                settings.titleFont
                              ),
                            } as React.CSSProperties
                          }
                        >
                          <TableInitialMark
                            label="EMPLOYEE WORKING HOURS SUMMARY"
                            className={
                              settings.titleFontIncludeInitial
                                ? "app-table-initial-mark--font-mode"
                                : ""
                            }
                          />
                          <TableTitleRemainder label="EMPLOYEE WORKING HOURS SUMMARY" />
                        </div>
                        <span className="text-[10px] font-semibold text-slate-500 shrink-0 ml-2">
                          Xem trước tiêu đề
                        </span>
                      </div>
                    </div>

                    {/* Live Theme & Table Preview Card */}
                    <div className="mt-1">
                      <ThemePreviewCard
                        initialPresetId={settings.preset || "default"}
                        customSettingsPreview={settings}
                        compact={true}
                        onApply={(pId, presetData) => {
                          setSettings((prev) => ({
                            ...prev,
                            preset: pId,
                            bg: presetData.bg,
                            accent: presetData.accent,
                            text: presetData.text,
                            border: presetData.border,
                            stripeColor1: presetData.stripeColor1,
                            stripeColor2: presetData.stripeColor2,
                            gridLineColor: presetData.gridLineColor,
                            tableHeaderBg: presetData.tableHeaderBg,
                            tableFooterBg: presetData.tableFooterBg,
                            tableColumnHeaderBg: presetData.tableColumnHeaderBg,
                            tableColumnHeaderTextColor: presetData.tableColumnHeaderTextColor,
                            tableDataBg: presetData.tableDataBg,
                            tableFont: presetData.tableFont,
                            tableRadius: "0px",
                          }));
                        }}
                      />
                    </div>
                  </div>

                  {/* KIỂU DÁNG & PHÔNG CHỮ BẢNG */}
                  <div className="bg-white p-4.5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-3">
                    <h4 className="font-black text-xs sm:text-sm text-primary tracking-widest uppercase border-b-2 border-primary/10 pb-2 flex items-center gap-1.5">
                      <Type className="w-4 h-4 text-accent" />
                      KIỂU DÁNG & PHÔNG CHỮ BẢNG
                    </h4>
                    
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-[0.8125rem] text-slate-800">
                        Font chữ Bảng (Table Font)
                      </label>
                      <select
                        value={settings.tableFont || "var(--font-main)"}
                        onChange={(e) =>
                          setSettings({ ...settings, tableFont: e.target.value })
                        }
                        className="w-full border-2 border-primary rounded-lg p-2 font-bold text-xs sm:text-sm outline-none focus:shadow-hard-sm transition-all bg-white text-primary cursor-pointer"
                      >
                        <option value="var(--font-main)">Plus Jakarta Sans (Mặc định / Chuẩn)</option>
                        <option value="var(--font-be-vietnam)">Be Vietnam Pro (Tối ưu Tiếng Việt)</option>
                        <option value="var(--font-newsreader)">Newsreader (Serif Cổ điển / Báo chí)</option>
                        <option value="var(--font-port-lligat-slab)">Gentium Book Plus (Serif Thanh lịch)</option>
                        <option value="var(--font-nunito)">Nunito (Mềm mại)</option>
                        <option value="var(--font-space-grotesk)">Space Grotesk (Công nghệ / Rõ nét)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <label htmlFor="gen-table-font-size" className="font-bold text-[0.8125rem] text-slate-800">
                          Cỡ chữ của bảng
                        </label>
                        <span className="text-xs font-bold tabular-nums text-primary">{settings.fontSize || "13px"}</span>
                      </div>
                      <input
                        id="gen-table-font-size"
                        type="range"
                        min="9"
                        max="20"
                        step="1"
                        value={parseFloat(settings.fontSize || "13") || 13}
                        onChange={(e) =>
                          setSettings({ ...settings, fontSize: `${e.target.value}px` })
                        }
                        className="w-full accent-primary cursor-pointer"
                      />
                    </div>

                    {/* Khoảng cách hàng bảng (Table Row Padding Toggle) */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-[0.8125rem] text-slate-800">
                          Khoảng cách hàng bảng (Table Row Padding)
                        </label>
                        <span className="text-[11px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded-md">
                          {(settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "compact"
                            ? "Compact (Gọn)"
                            : "Comfortable (Rộng)"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                        <button
                          type="button"
                          onClick={() =>
                            setSettings({
                              ...settings,
                              tablePaddingMode: "compact",
                              tablePadding: "4px 8px",
                            })
                          }
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                            (settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "compact"
                              ? "bg-white text-primary shadow-xs border border-slate-200/80"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                          }`}
                        >
                          <Ruler className="w-3.5 h-3.5" />
                          <span>Compact (Gọn)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSettings({
                              ...settings,
                              tablePaddingMode: "comfortable",
                              tablePadding: "12px 16px",
                            })
                          }
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                            (settings.tablePaddingMode || (settings.tablePadding === "4px 8px" || settings.tablePadding === "5px 10px" ? "compact" : "comfortable")) === "comfortable"
                              ? "bg-white text-primary shadow-xs border border-slate-200/80"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                          }`}
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          <span>Comfortable (Thoải mái)</span>
                        </button>
                      </div>
                    </div>


                  </div>

                  {/* DỮ LIỆU & LƯU TRỮ */}
                  <div className="bg-white p-4.5 rounded-xl border-2 border-red-500/10 shadow-sm flex flex-col gap-2.5">
                    <h4 className="font-black text-xs text-red-500 tracking-widest uppercase border-b border-red-500/10 pb-1.5 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" /> DỮ LIỆU & LƯU TRỮ
                    </h4>
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-600 hover:bg-red-100 py-2 rounded-xl font-bold border-2 border-red-200 transition-colors cursor-pointer text-xs uppercase tracking-wide"
                    >
                      <Trash2 className="w-4 h-4" /> Xóa toàn bộ dữ liệu web
                    </button>
                  </div>
                </div>

                {/* CỘT PHẢI (RIGHT COLUMN - 7 COLS): BẢNG MÀU CHI TIẾT (PHẦN ẢNH 2) & CỐ ĐỊNH MẶC ĐỊNH */}
                <div className="flex flex-col gap-4 w-full">
                  {/* 2. BẢNG MÀU CHI TIẾT & NỀN WEB (MÀU SẮC CHÍNH - ẢNH 2) */}
                  <div className="bg-white p-5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b-2 border-primary/10 pb-2">
                      <h4 className="font-black text-sm text-primary tracking-widest uppercase flex items-center gap-2">
                        <PaintBucket className="w-4 h-4 text-accent" />
                        2. BẢNG MÀU CHI TIẾT & NỀN WEB (COLORS & BG)
                      </h4>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                        Đồng bộ trực tiếp
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* Màu nhấn */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="accent-color" className="font-bold text-[0.8125rem] text-slate-800">
                            Màu nhấn (Accent/Table)
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.accent, defaultSettings.accent)}
                          </span>
                        </div>
                        <input
                          id="accent-color"
                          type="color"
                          value={colorToHex7(settings.accent, defaultSettings.accent)}
                          onChange={(e) =>
                            setSettings({ ...settings, accent: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Màu chữ */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="text-color" className="font-bold text-[0.8125rem] text-slate-800">
                            Màu chữ chính (Text)
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.text, defaultSettings.text)}
                          </span>
                        </div>
                        <input
                          id="text-color"
                          type="color"
                          value={colorToHex7(settings.text, defaultSettings.text)}
                          onChange={(e) =>
                            setSettings({ ...settings, text: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Nền Web: Màu sọc 1 */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="stripe-color1" className="font-bold text-[0.8125rem] text-slate-800">
                            Nền Web: Màu sọc 1
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.stripeColor1, defaultSettings.stripeColor1)}
                          </span>
                        </div>
                        <input
                          id="stripe-color1"
                          type="color"
                          value={colorToHex7(settings.stripeColor1, defaultSettings.stripeColor1)}
                          onChange={(e) =>
                            setSettings({ ...settings, stripeColor1: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Nền Web: Màu sọc 2 */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="stripe-color2" className="font-bold text-[0.8125rem] text-slate-800">
                            Nền Web: Màu sọc 2
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.stripeColor2, defaultSettings.stripeColor2)}
                          </span>
                        </div>
                        <input
                          id="stripe-color2"
                          type="color"
                          value={colorToHex7(settings.stripeColor2, defaultSettings.stripeColor2)}
                          onChange={(e) =>
                            setSettings({ ...settings, stripeColor2: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Viền & Đổ bóng */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="border-color" className="font-bold text-[0.8125rem] text-slate-800">
                            Viền & Đổ bóng (Border)
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.border, defaultSettings.border)}
                          </span>
                        </div>
                        <input
                          id="border-color"
                          type="color"
                          value={colorToHex7(settings.border, defaultSettings.border)}
                          onChange={(e) =>
                            setSettings({ ...settings, border: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Màu kẻ lưới */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="grid-color" className="font-bold text-[0.8125rem] text-slate-800">
                            Màu kẻ lưới (Grid Line)
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.gridLineColor, colorToHex7(defaultSettings.gridLineColor, "#C8D7C9"))}
                          </span>
                        </div>
                        <input
                          id="grid-color"
                          type="color"
                          value={colorToHex7(settings.gridLineColor, colorToHex7(defaultSettings.gridLineColor, "#C8D7C9"))}
                          onChange={(e) =>
                            setSettings({ ...settings, gridLineColor: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>
                    </div>
                  </div>

                  {/* MÀU SẮC CHUYÊN SÂU BẢNG TÍNH */}
                  <div className="bg-white p-5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-4">
                    <h4 className="font-black text-sm text-primary tracking-widest uppercase border-b-2 border-primary/10 pb-2 flex items-center gap-2">
                      <Table2 className="w-4 h-4 text-accent" />
                      MÀU SẮC BẢNG TÍNH CHI TIẾT (TABLE SPECIFIC)
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* Nền Tiêu đề Bảng & Chân Bảng */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="table-header-bg" className="font-bold text-[0.8125rem] text-slate-800">
                            Nền Tiêu đề Bảng & Chân Bảng
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.tableHeaderBg, defaultSettings.tableHeaderBg)}
                          </span>
                        </div>
                        <input
                          id="table-header-bg"
                          type="color"
                          value={colorToHex7(settings.tableHeaderBg, defaultSettings.tableHeaderBg)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSettings({ ...settings, tableHeaderBg: val, tableFooterBg: val });
                          }}
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Nền Tiêu đề Cột & Dòng Tổng Cộng */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="table-column-header-bg" className="font-bold text-[0.8125rem] text-slate-800">
                            Nền Tiêu đề Cột & Tổng Cộng
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.tableColumnHeaderBg, defaultSettings.tableColumnHeaderBg)}
                          </span>
                        </div>
                        <input
                          id="table-column-header-bg"
                          type="color"
                          value={colorToHex7(settings.tableColumnHeaderBg, defaultSettings.tableColumnHeaderBg)}
                          onChange={(e) =>
                            setSettings({ ...settings, tableColumnHeaderBg: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Màu Chữ Tiêu đề Cột & Tổng Cộng */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="table-column-header-text" className="font-bold text-[0.8125rem] text-slate-800">
                            Màu Chữ Tiêu đề Cột
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.tableColumnHeaderTextColor, defaultSettings.tableColumnHeaderTextColor)}
                          </span>
                        </div>
                        <input
                          id="table-column-header-text"
                          type="color"
                          value={colorToHex7(settings.tableColumnHeaderTextColor, defaultSettings.tableColumnHeaderTextColor)}
                          onChange={(e) =>
                            setSettings({ ...settings, tableColumnHeaderTextColor: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>

                      {/* Nền Ô Dữ Liệu Bảng (Dữ liệu TD) */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <label htmlFor="table-data-bg" className="font-bold text-[0.8125rem] text-slate-800">
                            Nền Ô Dữ Liệu Bảng (TD)
                          </label>
                          <span className="font-mono text-[11px] text-slate-500">
                            {colorToHex7(settings.tableDataBg, defaultSettings.tableDataBg)}
                          </span>
                        </div>
                        <input
                          id="table-data-bg"
                          type="color"
                          value={colorToHex7(settings.tableDataBg, defaultSettings.tableDataBg)}
                          onChange={(e) =>
                            setSettings({ ...settings, tableDataBg: e.target.value })
                          }
                          className="w-10 h-10 cursor-pointer border-2 border-primary rounded-lg p-0.5 shadow-hard-sm shrink-0"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. GIAO DIỆN MẪU MẶC ĐỊNH & CỐ ĐỊNH */}
                  <div className="bg-white p-5 rounded-xl border-2 border-primary/10 shadow-sm flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b-2 border-primary/10 pb-2">
                      <h4 className="font-black text-sm text-primary tracking-widest uppercase flex items-center gap-1.5">
                        <BookmarkCheck className="w-4 h-4 text-amber-500" />
                        3. GIAO DIỆN MẪU MẶC ĐỊNH (CỐ ĐỊNH)
                      </h4>
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                        Cố định vĩnh viễn
                      </span>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed">
                      Lưu toàn bộ màu sắc, phông chữ và các quy tắc tuỳ biến của giao diện hiện tại thành giao diện mẫu mặc định cố định. Giao diện này sẽ trở thành giao diện chuẩn duy nhất của hệ thống khi mở web và không thể khôi phục lại giao diện gốc ban đầu.
                    </p>

                    <button
                      onClick={saveAsCustomDefault}
                      className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-600 text-white py-3 px-4 rounded-xl font-black border-2 border-amber-600 transition-all cursor-pointer text-xs uppercase tracking-wider shadow-sm active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      <BookmarkCheck className="w-4 h-4" />
                      Lưu giao diện hiện tại làm mặc định (Cố định)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* FOOTER: KHÔNG CÓ NÚT KHÔI PHỤC MẶC ĐỊNH */}
          <div className="p-4 flex flex-wrap items-center justify-between gap-3 bg-background border-t-2 border-primary/10 shrink-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              <BookmarkCheck className="w-4 h-4 text-amber-600" />
              <span>Giao diện đã lưu làm mặc định sẽ là cấu hình chuẩn cuối cùng của hệ thống.</span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={saveSettings}
                className="text-primary-foreground py-2.5 px-6 rounded-xl font-black border-2 border-primary bg-primary hover:bg-primary/95 shadow-hard-sm active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer text-xs md:text-sm uppercase tracking-wider"
              >
                Lưu Lại
              </button>
              <button
                onClick={saveAsCustomDefault}
                title="Lưu toàn bộ màu sắc, phông chữ và style tuỳ chỉnh hiện tại thành giao diện mẫu mặc định cố định"
                className="bg-amber-600 hover:bg-amber-500 text-white py-2.5 px-6 rounded-xl font-black border-2 border-amber-700 shadow-hard-sm active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer text-xs md:text-sm uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <BookmarkCheck className="w-4 h-4 shrink-0" />
                Lưu làm mặc định (Cố định)
              </button>
            </div>
          </div>

  <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearAll}
        title="Xác nhận xóa toàn bộ dữ liệu"
        description="Thao tác này xóa toàn bộ dữ liệu Timesheet, Audit, Balance và Master, bao gồm file tải lên, kết quả, Deductions và các kỳ Balance đã lưu. Cài đặt giao diện vẫn được giữ nguyên."
        confirmText="XÓA TOÀN BỘ WEB"
        variant="destructive"
      />
    </div>
  </div>
  </>
  );
}
