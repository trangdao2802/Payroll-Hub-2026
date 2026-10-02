import localforage from "localforage";
import { useState, useEffect } from "react";
import { defaultCustomRules } from "./custom-rules";

export interface CustomRule {
  id: string;
  selector: string;
  radius?: string;
  bg?: string;
  color?: string;
  border?: string;
  borderColor?: string;
  borderWidth?: string;
  padding?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingRight?: string;
  margin?: string;
  width?: string;
  height?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  textAlign?: string;
  lineHeight?: string;
}

export interface UiSettings {
  bg: string;
  bgImage: string;
  bgImageStyle?:
    | "cover"
    | "contain"
    | "original"
    | "pattern-sm"
    | "pattern-md"
    | "pattern-lg"
    | "brand-stripes-purple"
    | "brand-stripes-green"
    | "brand-stripes-brown";
  bgImageOpacity?: number;
  accent: string;
  text: string;
  border: string;
  fontSize: string;
  tablePadding: string;
  tablePaddingMode?: "compact" | "comfortable";
  sidebarPos: "left" | "right";
  radius: string;
  tableRadius?: string;
  customRules?: CustomRule[];
  titleAlign: string;
  tableFont?: string;
  titleFont?: string;
  titleFontIncludeInitial?: boolean;
  autoSave?: boolean;
  showHelp?: boolean;
  stripeColor1?: string;
  stripeColor2?: string;
  gridLineColor?: string;
  showPivotSubtotals?: boolean;
  showGrandTotals?: boolean;
  showMktCols?: boolean;
  showBusiness?: boolean;
  showL07?: boolean;
  showChargeToCenterMkt?: boolean;
  colWidthPreference?: "narrow" | "normal" | "wide";
  defaultAuditYear?: number;
  tableHeaderBg?: string;
  tableSubHeaderBg?: string;
  tableFooterBg?: string;
  tableColumnHeaderBg?: string;
  tableColumnHeaderTextColor?: string;
  tableDataBg?: string;
  preset?: string;
}

export interface TastePreset {
  id: string;
  name: string;
  bg: string;
  accent: string;
  text: string;
  border: string;
  stripeColor1: string;
  stripeColor2: string;
  gridLineColor: string;
  tableHeaderBg: string;
  tableSubHeaderBg?: string;
  tableFooterBg: string;
  tableColumnHeaderBg?: string;
  tableColumnHeaderTextColor?: string;
  tableDataBg: string;
  tableFont: string;
  tableRadius: string;
}

export interface TitleFontOption {
  id: string;
  label: string;
  fontFamily: string;
  fileName: string;
}

export const TITLE_FONT_OPTIONS: TitleFontOption[] = [
  {
    id: "Voyage",
    label: "Voyage (Mặc định · Voyage.otf)",
    fontFamily: '"Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "Voyage.otf",
  },
  {
    id: "Tanamera",
    label: "Tanamera (TANAMERA.otf)",
    fontFamily: '"Tanamera", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "TANAMERA.otf",
  },
  {
    id: "Grandstand",
    label: "Grandstand (GRANDSTAND.ttf)",
    fontFamily: '"Grandstand", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "GRANDSTAND.ttf",
  },
  {
    id: "Roulen Atelier",
    label: "Roulen Atelier (ROULEN ATELIER-Regular.ttf)",
    fontFamily: '"Roulen Atelier", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "ROULEN ATELIER-Regular.ttf",
  },
  {
    id: "Anthelion",
    label: "Anthelion (Anthelion.ttf)",
    fontFamily: '"Anthelion", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "Anthelion.ttf",
  },
  {
    id: "Noradya",
    label: "Noradya (Noradya.ttf)",
    fontFamily: '"Noradya", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "Noradya.ttf",
  },
  {
    id: "Athene Voyage",
    label: "Athene Voyage (Athene Voyage.otf / .ttf)",
    fontFamily: '"Athene Voyage", "Voyage", "Be Vietnam Pro", Georgia, serif',
    fileName: "Athene Voyage.otf",
  },
  {
    id: "Modak",
    label: "Modak (Modak-Regular.ttf)",
    fontFamily: '"Modak", "Be Vietnam Pro", cursive',
    fileName: "Modak-Regular.ttf",
  },
];

export function resolveTitleFontStack(titleFont?: string): string {
  if (!titleFont) return TITLE_FONT_OPTIONS[0].fontFamily;
  const trimmed = titleFont.trim();
  const matched = TITLE_FONT_OPTIONS.find(
    (opt) =>
      opt.id.toLowerCase() === trimmed.toLowerCase() ||
      opt.fontFamily.toLowerCase() === trimmed.toLowerCase()
  );
  if (matched) return matched.fontFamily;
  return trimmed;
}

export const CURATED_PRESET_IDS = [
  "opal-garden",
  "opal-walnut",
  "dido-dreamcore",
  "pastel-cocoa",
  "pastel-blossom",
  "pastel-powder",
] as const;

export type CuratedPresetId = (typeof CURATED_PRESET_IDS)[number];

export const TASTE_PRESETS: Record<string, TastePreset> = {
  "opal-garden": {
    id: "opal-garden",
    name: "Opal Works · Dusty Petal & Antique Linen (#C4A7A7 · #D6CEC4)",
    bg: "#F6F3EE",
    accent: "#4A3424",
    text: "#4A3424",
    border: "#D6CEC4",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#F3ECEC",
    gridLineColor: "rgba(74, 52, 36, 0.13)",
    tableHeaderBg: "#C4A7A7",
    tableSubHeaderBg: "#F3EFEA",
    tableFooterBg: "#C4A7A7",
    tableColumnHeaderBg: "#D6CEC4",
    tableColumnHeaderTextColor: "#4A3424",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "opal-walnut": {
    id: "opal-walnut",
    name: "Opal Works · Dim Gray & Azureish White (#6C6C6A · #DEE5ED)",
    bg: "#FFFBFA",
    accent: "#6C6C6A",
    text: "#3A3437",
    border: "#DEE5ED",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#F4F7FA",
    gridLineColor: "rgba(108, 108, 106, 0.14)",
    tableHeaderBg: "#DEE5ED",
    tableSubHeaderBg: "#FAF2F5",
    tableFooterBg: "#DEE5ED",
    tableColumnHeaderBg: "#E8CCD7",
    tableColumnHeaderTextColor: "#3A3437",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "dido-dreamcore": {
    id: "dido-dreamcore",
    name: "Dido Market · Dreamcore Mist, Peach & Mint (梦核)",
    bg: "#F7F3E8",
    accent: "#8C5854",
    text: "#4A332D",
    border: "#CFD6EA",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#F5EFEA",
    gridLineColor: "rgba(140, 88, 84, 0.13)",
    tableHeaderBg: "#CFD6EA",
    tableSubHeaderBg: "#EAF7F3",
    tableFooterBg: "#CFD6EA",
    tableColumnHeaderBg: "#E5B8A8",
    tableColumnHeaderTextColor: "#4A332D",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "pastel-cocoa": {
    id: "pastel-cocoa",
    name: "Pastel Cocoa · Queen Pink & Floral White (#E8CCD7 · #FFFBFA)",
    bg: "#FFFBFA",
    accent: "#6C6C6A",
    text: "#3D2E35",
    border: "#E8CCD7",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#FAF2F5",
    gridLineColor: "rgba(108, 108, 106, 0.13)",
    tableHeaderBg: "#E8CCD7",
    tableSubHeaderBg: "#EEF3F8",
    tableFooterBg: "#E8CCD7",
    tableColumnHeaderBg: "#DEE5ED",
    tableColumnHeaderTextColor: "#3A3437",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "pastel-blossom": {
    id: "pastel-blossom",
    name: "Pastel Blossom · Pink, Butter & Sky (파스텔 색조합 2)",
    bg: "#FAF8F4",
    accent: "#7FAAC9",
    text: "#3D2B32",
    border: "#E6B8C4",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#F2EFE9",
    gridLineColor: "rgba(127, 170, 201, 0.15)",
    tableHeaderBg: "#E6B8C4",
    tableSubHeaderBg: "#EEF6FA",
    tableFooterBg: "#E6B8C4",
    tableColumnHeaderBg: "#FAF3C0",
    tableColumnHeaderTextColor: "#3D2B32",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "pastel-powder": {
    id: "pastel-powder",
    name: "Pastel Powder · Azureish White & Queen Pink (#DEE5ED · #E8CCD7)",
    bg: "#F7FAFD",
    accent: "#6C6C6A",
    text: "#2C333A",
    border: "#CBD6E2",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#EFF4F8",
    gridLineColor: "rgba(108, 108, 106, 0.13)",
    tableHeaderBg: "#DEE5ED",
    tableSubHeaderBg: "#FAF2F5",
    tableFooterBg: "#DEE5ED",
    tableColumnHeaderBg: "#E8CCD7",
    tableColumnHeaderTextColor: "#3A3437",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  "lila-rose": {
    id: "lila-rose",
    name: "Lila Rose · Hồng Phấn (Theo ảnh)",
    bg: "#FAF7F8",
    accent: "#A26377",
    text: "#2D2126",
    border: "#DFD0D6",
    stripeColor1: "#FFFFFF",
    stripeColor2: "#FAF2F5",
    gridLineColor: "rgba(162, 99, 119, 0.14)",
    tableHeaderBg: "#F4E8EC",
    tableSubHeaderBg: "#FFFFFF",
    tableFooterBg: "#F4E8EC",
    tableColumnHeaderBg: "#F8EEF1",
    tableColumnHeaderTextColor: "#2D2126",
    tableDataBg: "#FFFFFF",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  ss26: {
    id: "ss26",
    name: "SS26 · Xuân Hè 2026",
    bg: "#F0EFEB",
    accent: "#6A243E",
    text: "#394241",
    border: "#CE8DAB",
    stripeColor1: "#F8F7F4",
    stripeColor2: "#E8EDF3",
    gridLineColor: "rgba(57, 66, 65, 0.10)",
    tableHeaderBg: "#E7C5D5",
    tableSubHeaderBg: "#EBF0F6",
    tableFooterBg: "#E7C5D5",
    tableColumnHeaderBg: "#EFD67C",
    tableColumnHeaderTextColor: "#394241",
    tableDataBg: "#F8F7F4",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
  flowbutter: {
    id: "flowbutter",
    name: "Flowbutter Pantone (Vintage)",
    bg: "#F5EFC6",
    accent: "#4D0E12",
    text: "#231815",
    border: "#A5BCD6",
    stripeColor1: "#FFF8D9",
    stripeColor2: "#EDF3F9",
    gridLineColor: "rgba(74, 46, 39, 0.13)",
    tableHeaderBg: "#E8DDB3",
    tableSubHeaderBg: "#EDF3F9",
    tableFooterBg: "#E8DDB3",
    tableColumnHeaderBg: "#D4E0EC",
    tableColumnHeaderTextColor: "#231815",
    tableDataBg: "#FFF8D9",
    tableFont: "var(--font-main)",
    tableRadius: "0px",
  },
};

// Aliases for backwards compatibility with removed/merged preset IDs
TASTE_PRESETS["breeze-blue"] = TASTE_PRESETS["pastel-blossom"];
TASTE_PRESETS["dream-state"] = TASTE_PRESETS["dido-dreamcore"];
TASTE_PRESETS["espresso-blush"] = TASTE_PRESETS["pastel-cocoa"];
TASTE_PRESETS["systematic"] = TASTE_PRESETS["opal-garden"];
TASTE_PRESETS["bardak-pastel"] = TASTE_PRESETS["pastel-blossom"];
TASTE_PRESETS["dido-dream"] = TASTE_PRESETS["dido-dreamcore"];

export const USER_DEFAULT_UI_SETTINGS_KEY = "PayrollApp_UiSettings_UserDefault_v1";

export function colorToHex7(color: string | undefined | null, fallback = "#000000"): string {
  if (!color || typeof color !== "string") return fallback;
  const s = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (/^#[0-9A-Fa-f]{8}$/.test(s)) {
    return s.slice(0, 7);
  }
  const rgbaMatch = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    const r = Math.min(255, parseInt(rgbaMatch[1], 10)).toString(16).padStart(2, "0");
    const g = Math.min(255, parseInt(rgbaMatch[2], 10)).toString(16).padStart(2, "0");
    const b = Math.min(255, parseInt(rgbaMatch[3], 10)).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return fallback;
}

// Defaults also supply every required field of the registered theme preset.
export const defaultSettings: UiSettings & Omit<TastePreset, "id" | "name"> = {
  bg: "#F6F3EE",
  bgImage: "",
  bgImageStyle: "cover",
  bgImageOpacity: 100,
  accent: "#4A3424",
  text: "#4A3424",
  border: "#D6CEC4",
  fontSize: "13px",
  tablePadding: "12px 16px",
  tablePaddingMode: "comfortable",
  sidebarPos: "left",
  radius: "12px",
  tableRadius: "0px",
  customRules: defaultCustomRules,
  titleAlign: "center",
  tableFont: "var(--font-main)",
  titleFont: "Voyage",
  titleFontIncludeInitial: false,
  autoSave: true,
  showHelp: true,
  stripeColor1: "#FFFFFF",
  stripeColor2: "#F3ECEC",
  gridLineColor: "rgba(74, 52, 36, 0.13)",
  tableHeaderBg: "#C4A7A7",
  tableSubHeaderBg: "#F3EFEA",
  tableFooterBg: "#C4A7A7",
  tableColumnHeaderBg: "#D6CEC4",
  tableColumnHeaderTextColor: "#4A3424",
  tableDataBg: "#FFFFFF",
  showPivotSubtotals: true,
  preset: "default",
  showGrandTotals: true,
  showMktCols: true,
  showBusiness: true,
  showL07: true,
  colWidthPreference: "normal",
  defaultAuditYear: 2026,
};

export function getEffectiveTablePadding(settings: Partial<UiSettings>): string {
  if (settings.tablePaddingMode === "compact") {
    return "4px 8px";
  }
  if (settings.tablePaddingMode === "comfortable") {
    return "12px 16px";
  }
  return settings.tablePadding || "12px 16px";
}

// Immediately rehydrate saved user default settings if present in browser localStorage
try {
  const syncDefaultRaw =
    typeof window !== "undefined" && window.localStorage
      ? localStorage.getItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small")
      : null;
  if (syncDefaultRaw) {
    const syncDefault = JSON.parse(syncDefaultRaw);
    if (syncDefault && typeof syncDefault === "object") {
      Object.assign(defaultSettings, syncDefault);
    }
  }
} catch {
  // ignore
}

// Registered default preset replacing the base template
TASTE_PRESETS["default"] = {
  id: "default",
  name: "⭐ Giao diện mẫu mặc định (Default Theme)",
  bg: defaultSettings.bg,
  accent: defaultSettings.accent,
  text: defaultSettings.text,
  border: defaultSettings.border,
  stripeColor1: defaultSettings.stripeColor1,
  stripeColor2: defaultSettings.stripeColor2,
  gridLineColor: defaultSettings.gridLineColor,
  tableHeaderBg: defaultSettings.tableHeaderBg,
  tableSubHeaderBg: defaultSettings.tableSubHeaderBg,
  tableFooterBg: defaultSettings.tableFooterBg,
  tableColumnHeaderBg: defaultSettings.tableColumnHeaderBg,
  tableColumnHeaderTextColor: defaultSettings.tableColumnHeaderTextColor,
  tableDataBg: defaultSettings.tableDataBg,
  tableFont: defaultSettings.tableFont,
  tableRadius: defaultSettings.tableRadius,
};

// Synchronize "Lila Rose · Hồng Phấn (Theo ảnh)" with custom saved default if available
try {
  const syncDefaultRaw =
    typeof window !== "undefined" && window.localStorage
      ? localStorage.getItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small")
      : null;
  if (syncDefaultRaw) {
    const syncDefault = JSON.parse(syncDefaultRaw);
    if (syncDefault && typeof syncDefault === "object" && TASTE_PRESETS["lila-rose"]) {
      Object.assign(TASTE_PRESETS["lila-rose"], {
        bg: syncDefault.bg || TASTE_PRESETS["lila-rose"].bg,
        accent: syncDefault.accent || TASTE_PRESETS["lila-rose"].accent,
        text: syncDefault.text || TASTE_PRESETS["lila-rose"].text,
        border: syncDefault.border || TASTE_PRESETS["lila-rose"].border,
        stripeColor1: syncDefault.stripeColor1 || TASTE_PRESETS["lila-rose"].stripeColor1,
        stripeColor2: syncDefault.stripeColor2 || TASTE_PRESETS["lila-rose"].stripeColor2,
        gridLineColor: syncDefault.gridLineColor || TASTE_PRESETS["lila-rose"].gridLineColor,
        tableHeaderBg: syncDefault.tableHeaderBg || TASTE_PRESETS["lila-rose"].tableHeaderBg,
        tableSubHeaderBg: syncDefault.tableSubHeaderBg || TASTE_PRESETS["lila-rose"].tableSubHeaderBg,
        tableFooterBg: syncDefault.tableFooterBg || TASTE_PRESETS["lila-rose"].tableFooterBg,
        tableColumnHeaderBg: syncDefault.tableColumnHeaderBg || TASTE_PRESETS["lila-rose"].tableColumnHeaderBg,
        tableColumnHeaderTextColor: syncDefault.tableColumnHeaderTextColor || TASTE_PRESETS["lila-rose"].tableColumnHeaderTextColor,
        tableDataBg: syncDefault.tableDataBg || TASTE_PRESETS["lila-rose"].tableDataBg,
        tableFont: syncDefault.tableFont || TASTE_PRESETS["lila-rose"].tableFont,
        tableRadius: syncDefault.tableRadius || TASTE_PRESETS["lila-rose"].tableRadius,
      });
    }
  }
} catch {
  // ignore
}

export const CURATED_PRESETS: TastePreset[] = CURATED_PRESET_IDS.map(
  (id) => TASTE_PRESETS[id]
);

export const ALL_TASTE_PRESETS: TastePreset[] = [
  TASTE_PRESETS["default"],
  ...CURATED_PRESETS,
  TASTE_PRESETS["lila-rose"],
  TASTE_PRESETS["ss26"],
  TASTE_PRESETS["flowbutter"],
].filter(Boolean);

export const UI_SETTINGS_KEY = "PayrollApp_UiSettings_HushedElegance_v11";

const COCOA_BLUSH_PRESET_ID = "cocoa_blush_palette";
const LEGACY_COCOA_BLUSH_ACCENT = "#DCDDE8";
const COCOA_BLUSH_ACCENT = "#5A4542";
const COCOA_BLUSH_POWDER_BLUE = "#DCDDE8";
const COCOA_BLUSH_BLUSH = "#E6CED6";
const COCOA_BLUSH_DUSTY_PINK = "#D2B6BD";
const COCOA_BLUSH_WARM_BEIGE = "#EBCEAA";

const FRENCH_MATCHA_PRESET_ID = "french_matcha_palette";
const LEGACY_FRENCH_MATCHA = {
  bg: "#F7F2EC",
  accent: "#601D40",
  text: "#601D40",
  border: "#949E86",
  stripeColor1: "#FFD6EC",
  stripeColor2: "#CAE5F0",
  gridLineColor: "rgba(96, 29, 64, 0.14)",
  tableHeaderBg: "#949E86",
  tableFooterBg: "#FFA873",
  tableColumnHeaderBg: "#FFF5B5",
  tableDataBg: "#F7F2EC",
} as const;
const CLOUDY_PUDDING = {
  bg: "#F2F3F4",
  accent: "#27292C",
  text: "#27292C",
  border: "#AFB0B0",
  stripeColor1: "#F7EDF0",
  stripeColor2: "#E4ECF3",
  gridLineColor: "rgba(39, 41, 44, 0.16)",
  tableHeaderBg: "#DDE4E6",
  tableFooterBg: "#F7EDF0",
  tableColumnHeaderBg: "#F7F7EC",
  tableDataBg: "#F2F3F4",
} as const;

function sameValue(value: unknown, expected?: string) {
  if (typeof value !== "string" || typeof expected !== "string") return false;
  return (
    value.trim().toUpperCase() === expected.trim().toUpperCase()
  );
}

/**
 * The first Cocoa Blush release used powder blue as --primary. That made the
 * settings panel and table controls too light to read. Migrate only the
 * untouched values from that release; deliberate user edits remain intact.
 */
export function migrateCocoaBlushContrast(settings: UiSettings): UiSettings {
  const isLegacyCocoaBlush =
    settings.preset === COCOA_BLUSH_PRESET_ID &&
    sameValue(settings.bg, "#F8F4EE") &&
    sameValue(settings.accent, LEGACY_COCOA_BLUSH_ACCENT) &&
    sameValue(settings.text, "#433837") &&
    sameValue(settings.border, "#A38E96") &&
    sameValue(settings.stripeColor1, "#E6CED6") &&
    sameValue(settings.stripeColor2, "#EBCEAA") &&
    sameValue(settings.gridLineColor, "rgba(90, 69, 66, 0.12)") &&
    sameValue(settings.tableHeaderBg, "#5A4542") &&
    sameValue(settings.tableFooterBg, "#D2B6BD") &&
    sameValue(settings.tableColumnHeaderBg, "#5A4542") &&
    sameValue(settings.tableDataBg, "#F8F4EE");

  if (!isLegacyCocoaBlush) return settings;

  return {
    ...settings,
    accent: COCOA_BLUSH_ACCENT,
    stripeColor2: COCOA_BLUSH_POWDER_BLUE,
    tableHeaderBg: COCOA_BLUSH_DUSTY_PINK,
    tableFooterBg: COCOA_BLUSH_BLUSH,
    tableColumnHeaderBg: COCOA_BLUSH_WARM_BEIGE,
    gridLineColor: "rgba(90, 69, 66, 0.16)",
  };
}

/**
 * Move saved French Tips/Matcha settings to the softer moodboard palette.
 * Only the untouched preset values are migrated so custom edits are kept.
 */
export function migrateFrenchMatchaPalette(settings: UiSettings): UiSettings {
  const isLegacyFrenchMatcha =
    settings.preset === FRENCH_MATCHA_PRESET_ID &&
    sameValue(settings.bg, LEGACY_FRENCH_MATCHA.bg) &&
    sameValue(settings.accent, LEGACY_FRENCH_MATCHA.accent) &&
    sameValue(settings.text, LEGACY_FRENCH_MATCHA.text) &&
    sameValue(settings.border, LEGACY_FRENCH_MATCHA.border) &&
    sameValue(settings.stripeColor1, LEGACY_FRENCH_MATCHA.stripeColor1) &&
    sameValue(settings.stripeColor2, LEGACY_FRENCH_MATCHA.stripeColor2) &&
    sameValue(settings.gridLineColor, LEGACY_FRENCH_MATCHA.gridLineColor) &&
    sameValue(settings.tableHeaderBg, LEGACY_FRENCH_MATCHA.tableHeaderBg) &&
    sameValue(settings.tableFooterBg, LEGACY_FRENCH_MATCHA.tableFooterBg) &&
    sameValue(settings.tableColumnHeaderBg, LEGACY_FRENCH_MATCHA.tableColumnHeaderBg) &&
    sameValue(settings.tableDataBg, LEGACY_FRENCH_MATCHA.tableDataBg);

  if (!isLegacyFrenchMatcha) return settings;

  return {
    ...settings,
    preset: FRENCH_MATCHA_PRESET_ID,
    ...CLOUDY_PUDDING,
  };
}

export function calculateContrastRatio(color1: string, color2: string): number {
  const p1 = parseCssColor(color1);
  const p2 = parseCssColor(color2);
  if (!p1 || !p2) return 1;
  const linear = ({ r, g, b }: RgbColor) =>
    [r, g, b].map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
  const [r1, g1, b1] = linear(p1);
  const [r2, g2, b2] = linear(p2);
  const l1 = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
  const l2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Calculates WCAG 2.1 relative luminance for a given color string or RGB object.
 * Returns a value in [0, 1] where 0 is darkest black and 1 is brightest white.
 */
export function calculateRelativeLuminance(color: string | RgbColor): number {
  const parsed = typeof color === "string" ? parseCssColor(color) : color;
  if (!parsed) return 0.5;
  const linear = ({ r, g, b }: RgbColor) =>
    [r, g, b].map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
  const [r, g, b] = linear(parsed);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface ContrastTextColors {
  primary: string;
  muted: string;
  isLightBg: boolean;
  luminance: number;
}

/**
 * Computes optimal high-contrast text and muted colors based on the luminance
 * of a background color according to WCAG contrast standards.
 *
 * @param bgHex The background color string (hex, rgb, etc.)
 * @param preferredDark Optional preferred dark color (e.g. theme's text color)
 * @param preferredLight Optional preferred light color (e.g. #FFFFFF)
 */
export function computeContrastTextColor(
  bgHex: string,
  preferredDark?: string,
  preferredLight?: string
): ContrastTextColors {
  const luminance = calculateRelativeLuminance(bgHex);
  // Standard WCAG threshold for light vs dark background decision is ~0.179
  const isLightBg = luminance > 0.179;

  if (isLightBg) {
    // Light background requires dark text for readability
    let primary = preferredDark && isValidColor(preferredDark) ? preferredDark : "#0F172A";
    if (calculateContrastRatio(bgHex, primary) < 3.8) {
      primary = "#09090B";
    }
    const muted = "#475569";
    return { primary, muted, isLightBg, luminance };
  } else {
    // Dark background requires light text for readability
    let primary = preferredLight && isValidColor(preferredLight) ? preferredLight : "#FFFFFF";
    if (calculateContrastRatio(bgHex, primary) < 3.8) {
      primary = "#FFFFFF";
    }
    const muted = "#CBD5E1";
    return { primary, muted, isLightBg, luminance };
  }
}

export function migrateSoftMatchaPalette(settings: UiSettings): UiSettings {
  if (settings.preset === "soft-matcha" || settings.preset === "butter-matcha") {
    const lilaPreset = TASTE_PRESETS["lila-rose"] || defaultSettings;
    return {
      ...settings,
      preset: "lila-rose",
      bg: lilaPreset.bg,
      accent: lilaPreset.accent,
      text: lilaPreset.text,
      border: lilaPreset.border,
      stripeColor1: lilaPreset.stripeColor1,
      stripeColor2: lilaPreset.stripeColor2,
      gridLineColor: lilaPreset.gridLineColor,
      tableHeaderBg: lilaPreset.tableHeaderBg,
      tableFooterBg: lilaPreset.tableFooterBg,
      tableColumnHeaderBg: lilaPreset.tableColumnHeaderBg,
      tableColumnHeaderTextColor: lilaPreset.tableColumnHeaderTextColor,
      tableDataBg: lilaPreset.tableDataBg,
    };
  }
  return settings;
}

export function migrateEspressoBlushPalette(settings: UiSettings): UiSettings {
  if (settings.preset === "espresso-blush") {
    // If the saved tableColumnHeaderBg is the old dark coffee color (#3D2A2A) or empty,
    // migrate to the warm coral rose (#C49797) and high-contrast espresso text (#3D2A2A)
    if (
      sameValue(settings.tableColumnHeaderBg, "#3D2A2A") ||
      sameValue(settings.tableColumnHeaderTextColor, "#FBE8B9") ||
      !settings.tableColumnHeaderBg
    ) {
      return {
        ...settings,
        tableColumnHeaderBg: "#C49797",
        tableColumnHeaderTextColor: "#3D2A2A",
      };
    }
  }
  return settings;
}

export function migrateMultiColorPastelPalettes(settings: UiSettings): UiSettings {
  if (settings.preset === "bardak-pastel" || settings.preset === "dido-dream") {
    const targetPreset = settings.preset === "bardak-pastel" ? "breeze-blue" : "dream-state";
    const p = TASTE_PRESETS[targetPreset];
    if (p) {
      return {
        ...settings,
        preset: targetPreset,
        bg: p.bg,
        accent: p.accent,
        text: p.text,
        border: p.border,
        stripeColor1: p.stripeColor1,
        stripeColor2: p.stripeColor2,
        gridLineColor: p.gridLineColor,
        tableHeaderBg: p.tableHeaderBg,
        tableSubHeaderBg: p.tableSubHeaderBg,
        tableFooterBg: p.tableFooterBg,
        tableColumnHeaderBg: p.tableColumnHeaderBg,
        tableColumnHeaderTextColor: p.tableColumnHeaderTextColor,
      };
    }
  }
  return settings;
}

function isValidColor(color: unknown): boolean {
  if (typeof color !== "string") return false;
  const c = color.trim();
  return (
    /^#[0-9A-Fa-f]{3,8}$/.test(c) ||
    c.startsWith("rgba(") ||
    c.startsWith("rgb(") ||
    c === "transparent" ||
    c === "inherit"
  );
}

export function normalizeCssLength(value?: string): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return `${clean}px`;
  return clean;
}

export function isSafeCustomSelector(selector: unknown): selector is string {
  if (typeof selector !== "string") return false;
  const clean = selector.trim();
  if (!clean || clean.length > 500 || /[{};@]/.test(clean)) return false;
  if (typeof document === "undefined") return true;
  try {
    document.querySelector(clean);
    return true;
  } catch {
    return false;
  }
}

function normalizeBoxShorthand(value?: string): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return clean
    .split(/\s+/)
    .map((part) => normalizeCssLength(part) || part)
    .join(" ");
}

function buildCustomRuleCss(
  rule: Partial<CustomRule>,
  includeInspectorOutline = false,
): string {
  if (!isSafeCustomSelector(rule.selector)) return "";
  return `
    ${rule.selector} {
      ${rule.radius ? `border-radius: ${normalizeCssLength(rule.radius)} !important;` : ""}
      ${rule.bg ? `background-color: ${rule.bg} !important;` : ""}
      ${rule.color ? `color: ${rule.color} !important;` : ""}
      ${rule.border ? `border: ${rule.border} !important;` : ""}
      ${rule.borderColor ? `border-color: ${rule.borderColor} !important;` : ""}
      ${rule.borderWidth ? `border-width: ${normalizeCssLength(rule.borderWidth)} !important;` : ""}
      ${rule.padding ? `padding: ${normalizeBoxShorthand(rule.padding)} !important;` : ""}
      ${rule.paddingTop ? `padding-top: ${normalizeCssLength(rule.paddingTop)} !important;` : ""}
      ${rule.paddingBottom ? `padding-bottom: ${normalizeCssLength(rule.paddingBottom)} !important;` : ""}
      ${rule.paddingLeft ? `padding-left: ${normalizeCssLength(rule.paddingLeft)} !important;` : ""}
      ${rule.paddingRight ? `padding-right: ${normalizeCssLength(rule.paddingRight)} !important;` : ""}
      ${rule.margin ? `margin: ${normalizeBoxShorthand(rule.margin)} !important;` : ""}
      ${rule.width ? `width: ${normalizeCssLength(rule.width)} !important;` : ""}
      ${rule.height ? `height: ${normalizeCssLength(rule.height)} !important;` : ""}
      ${rule.fontSize ? `font-size: ${normalizeCssLength(rule.fontSize)} !important;` : ""}
      ${rule.fontFamily ? `font-family: ${rule.fontFamily} !important;` : ""}
      ${rule.fontWeight ? `font-weight: ${rule.fontWeight} !important;` : ""}
      ${rule.fontStyle ? `font-style: ${rule.fontStyle} !important;` : ""}
      ${rule.textDecoration ? `text-decoration-line: ${rule.textDecoration} !important;` : ""}
      ${rule.textAlign ? `text-align: ${rule.textAlign} !important;` : ""}
      ${rule.lineHeight ? `line-height: ${normalizeCssLength(rule.lineHeight)} !important;` : ""}
      ${includeInspectorOutline ? "outline: 3px solid var(--primary, #3b82f6) !important; outline-offset: -3px !important;" : ""}
    }
  `;
}

type RgbColor = { r: number; g: number; b: number };

function parseCssColor(color: string): RgbColor | null {
  const value = color.trim();
  const shortHex = value.match(/^#([0-9a-f]{3,4})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].slice(0, 3).split("").map((part) =>
      parseInt(part + part, 16),
    );
    return { r, g, b };
  }

  const longHex = value.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (longHex) {
    return {
      r: parseInt(longHex[1].slice(0, 2), 16),
      g: parseInt(longHex[1].slice(2, 4), 16),
      b: parseInt(longHex[1].slice(4, 6), 16),
    };
  }

  const rgb = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  );
  if (!rgb) return null;
  return {
    r: Math.min(255, Number(rgb[1])),
    g: Math.min(255, Number(rgb[2])),
    b: Math.min(255, Number(rgb[3])),
  };
}

function rgbToHsl({ r, g, b }: RgbColor) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function rotateHarmonyColor(color: RgbColor, degrees: number) {
  const { h, s, l } = rgbToHsl(color);
  return `hsl(${Math.round((h + degrees) % 360)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

function readableForeground(color: RgbColor) {
  const linear = ({ r, g, b }: RgbColor) =>
    [r, g, b].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });
  const [r, g, b] = linear(color);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? "#09090b" : "#ffffff";
}

function applyHarmonyVariables(root: HTMLElement, accent: string) {
  const parsed = parseCssColor(accent) || { r: 9, g: 9, b: 11 };
  root.style.setProperty("--primary-foreground", readableForeground(parsed));
  root.style.setProperty("--harmony-complement", rotateHarmonyColor(parsed, 180));
  root.style.setProperty("--harmony-triadic-1", rotateHarmonyColor(parsed, 120));
  root.style.setProperty("--harmony-triadic-2", rotateHarmonyColor(parsed, 240));
  root.style.setProperty("--harmony-tetradic-1", rotateHarmonyColor(parsed, 90));
  root.style.setProperty("--harmony-tetradic-2", rotateHarmonyColor(parsed, 180));
  root.style.setProperty("--harmony-tetradic-3", rotateHarmonyColor(parsed, 270));
  root.style.setProperty(
    "--theme-surface-soft",
    `color-mix(in srgb, ${accent} 5%, var(--card, #ffffff))`,
  );
  root.style.setProperty(
    "--theme-surface-strong",
    `color-mix(in srgb, ${accent} 10%, var(--card, #ffffff))`,
  );
  root.style.setProperty(
    "--theme-surface-complement",
    "color-mix(in srgb, var(--harmony-complement) 7%, var(--card, #ffffff))",
  );
  root.style.setProperty(
    "--theme-surface-triadic",
    "color-mix(in srgb, var(--harmony-triadic-1) 6%, var(--card, #ffffff))",
  );
  root.style.setProperty(
    "--theme-surface-tetradic",
    "color-mix(in srgb, var(--harmony-tetradic-1) 5%, var(--card, #ffffff))",
  );
}

/**
 * Utility function to apply/synchronize the CSS variable `--table-footer-bg`
 * based on the current value of `--table-header-bg` in `document.documentElement.style`,
 * ensuring table header and footer background consistency across all themes.
 *
 * @param rootElement Optional target element (defaults to `document.documentElement`)
 * @returns The applied background color string
 */
export function syncTableFooterBgFromHeader(rootElement?: HTMLElement | null): string {
  if (typeof document === "undefined") return "";
  const root = rootElement || document.documentElement;
  if (!root) return "";

  // 1. Read directly from document.documentElement.style (inline style)
  let headerBg = root.style.getPropertyValue("--table-header-bg")?.trim();

  // 2. If not found inline, read from computed style (e.g. from active [data-theme] CSS definitions)
  if (!headerBg && typeof window !== "undefined") {
    headerBg = window.getComputedStyle(root).getPropertyValue("--table-header-bg")?.trim();
  }

  // 3. Fallback to default if still empty
  const effectiveBg = headerBg || "#E9D9DF";

  // 4. Apply --table-footer-bg to document.documentElement.style
  root.style.setProperty("--table-footer-bg", effectiveBg);

  // 5. Automatically compute and synchronize contrast text colors for footer based on luminance
  const footerContrast = computeContrastTextColor(effectiveBg);
  root.style.setProperty("--table-footer-text-color", footerContrast.primary);
  root.style.setProperty("--table-footer-text", footerContrast.primary);
  root.style.setProperty("--table-footer-muted-color", footerContrast.muted);

  return effectiveBg;
}

export const applyTableFooterBgFromHeader = syncTableFooterBgFromHeader;

export function applyUiSettings(settings: UiSettings, previewRule?: Partial<CustomRule>) {
  settings = { ...settings, tableRadius: "0px" };
  const root = document.documentElement;
  applyHarmonyVariables(root, settings.accent || "#09090b");

  // Always expose the coordinated 3-card Dream State palette variables for cross-app harmony
  root.style.setProperty("--palette-matcha", "#7A9476");
  root.style.setProperty("--palette-matcha-bg", "#DFE7DC");
  root.style.setProperty("--palette-matcha-soft", "#F5F8F4");
  root.style.setProperty("--palette-matcha-border", "#CCD7C9");
  root.style.setProperty("--palette-matcha-text", "#2B362A");

  root.style.setProperty("--palette-rose", "#A26377");
  root.style.setProperty("--palette-rose-bg", "#F8EEF1");
  root.style.setProperty("--palette-rose-soft", "#FAF7F8");
  root.style.setProperty("--palette-rose-border", "#DFD0D6");
  root.style.setProperty("--palette-rose-text", "#2D2126");

  root.style.setProperty("--palette-blue", "#6F8E9F");
  root.style.setProperty("--palette-blue-bg", "#E4ECEF");
  root.style.setProperty("--palette-blue-soft", "#F5F8FA");
  root.style.setProperty("--palette-blue-border", "#CCD8DF");
  root.style.setProperty("--palette-blue-text", "#1E2C35");

  if (settings.preset) {
    root.setAttribute("data-theme", settings.preset);
  }

  if (settings.preset === "dark_tech") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  const accent = settings.accent || "#09090b";
  const background = settings.bg || (settings.preset === "dark_tech" ? "#09090b" : "#ffffff");
  const foreground = settings.text || (settings.preset === "dark_tech" ? "#f4f4f5" : "#18181b");
  const cardMix = settings.preset === "dark_tech" ? 8 : 2;
  const card = `color-mix(in srgb, ${accent} ${cardMix}%, ${background})`;
  root.style.setProperty("--card", card);
  root.style.setProperty("--card-foreground", foreground);
  root.style.setProperty("--popover", card);
  root.style.setProperty("--popover-foreground", foreground);
  root.style.setProperty(
    "--muted",
    `color-mix(in srgb, ${accent} ${settings.preset === "dark_tech" ? 14 : 7}%, ${background})`,
  );
  root.style.setProperty(
    "--muted-foreground",
    `color-mix(in srgb, ${accent} 48%, ${foreground})`,
  );

  if (settings.bg) {
    root.style.setProperty("--background", settings.bg);
    root.style.setProperty("--bg", settings.bg);
    if (typeof document !== "undefined" && document.body) {
      document.body.style.backgroundColor = settings.bg;
    }
  }
  if (settings.text) {
    root.style.setProperty("--foreground", settings.text);
    root.style.setProperty("--ink", settings.text);
  }
  if (settings.border) {
    root.style.setProperty("--border", settings.border);
    root.style.setProperty("--shadow-hard", `4px 4px 0px ${settings.border}`);
    root.style.setProperty("--shadow-hard-sm", `2px 2px 0px ${settings.border}`);
  }
  if (settings.accent) {
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--primary", settings.accent);
    root.style.setProperty("--table-initial-color", settings.accent);
    root.style.setProperty("--ring", settings.accent);
    root.style.setProperty("--secondary", "var(--harmony-complement)");
    root.style.setProperty("--secondary-foreground", "var(--primary-foreground)");
    root.style.setProperty("--accent-foreground", "var(--primary-foreground)");
  }

  if (settings.bgImageStyle?.startsWith("brand-stripes-")) {
    root.style.setProperty(
      "--bg-image-opacity",
      ((settings.bgImageOpacity ?? 100) / 100).toString(),
    );
    root.style.setProperty("--bg-image-size", "20px 20px");
    root.style.setProperty("--bg-image-repeat", "repeat");
    root.style.setProperty("--bg-image-attachment", "fixed");

    if (settings.bgImageStyle === "brand-stripes-purple") {
      root.style.setProperty("--bg-image", "var(--pattern-stripes-purple)");
    } else if (settings.bgImageStyle === "brand-stripes-green") {
      root.style.setProperty("--bg-image", "var(--pattern-stripes-green)");
    } else if (settings.bgImageStyle === "brand-stripes-brown") {
      root.style.setProperty("--bg-image", "var(--pattern-stripes-brown)");
    }
  } else if (settings.bgImage) {
    root.style.setProperty("--bg-image", `url(${settings.bgImage})`);
    root.style.setProperty("--bg-image-attachment", "fixed");
    root.style.setProperty(
      "--bg-image-opacity",
      ((settings.bgImageOpacity ?? 100) / 100).toString(),
    );
    if (settings.bgImageStyle === "pattern-sm") {
      root.style.setProperty("--bg-image-size", "50px");
      root.style.setProperty("--bg-image-repeat", "repeat");
      root.style.setProperty("--bg-image-position", "top left");
    } else if (settings.bgImageStyle === "pattern-md") {
      root.style.setProperty("--bg-image-size", "100px");
      root.style.setProperty("--bg-image-repeat", "repeat");
      root.style.setProperty("--bg-image-position", "top left");
    } else if (settings.bgImageStyle === "pattern-lg") {
      root.style.setProperty("--bg-image-size", "200px");
      root.style.setProperty("--bg-image-repeat", "repeat");
      root.style.setProperty("--bg-image-position", "top left");
    } else if (settings.bgImageStyle === "contain") {
      root.style.setProperty("--bg-image-size", "contain");
      root.style.setProperty("--bg-image-repeat", "no-repeat");
      root.style.setProperty("--bg-image-position", "center");
    } else if (settings.bgImageStyle === "original") {
      root.style.setProperty("--bg-image-size", "auto");
      root.style.setProperty("--bg-image-repeat", "no-repeat");
      root.style.setProperty("--bg-image-position", "center");
    } else {
      root.style.setProperty("--bg-image-size", "cover");
      root.style.setProperty("--bg-image-repeat", "no-repeat");
      root.style.setProperty("--bg-image-position", "center");
    }
  } else {
    root.style.removeProperty("--bg-image");
    root.style.removeProperty("--bg-image-size");
    root.style.removeProperty("--bg-image-repeat");
    root.style.removeProperty("--bg-image-position");
    root.style.removeProperty("--bg-image-attachment");
    root.style.setProperty("--bg-image-opacity", "0");
  }

  if (settings.accent) {
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--primary", settings.accent);
    root.style.setProperty("--table-initial-color", settings.accent);
    root.style.setProperty("--ring", settings.accent);
  }
  if (settings.text) {
    root.style.setProperty("--foreground", settings.text);
  }
  if (settings.border) {
    root.style.setProperty("--border", settings.border);
    root.style.setProperty("--shadow-hard", `4px 4px 0px ${settings.border}`);
    root.style.setProperty(
      "--shadow-hard-sm",
      `2px 2px 0px ${settings.border}`,
    );
  }
  if (settings.fontSize) {
    // Keep the user's chosen size as the baseline; CSS adds only the
    // device-specific adjustment so the preference remains authoritative.
    root.style.removeProperty("--font-size");
    root.style.setProperty("--user-font-size", settings.fontSize);
  }
  if (settings.tableFont) {
    root.style.setProperty("--font-table", settings.tableFont);
    root.style.setProperty("--tabular-nums", settings.tableFont);
  }
  const effectiveTitleFont = resolveTitleFontStack(settings.titleFont);
  root.style.setProperty("--font-table-title", effectiveTitleFont);
  root.setAttribute(
    "data-title-font-include-initial",
    settings.titleFontIncludeInitial ? "true" : "false"
  );
  const effectivePadding = getEffectiveTablePadding(settings);
  root.style.setProperty("--table-padding", effectivePadding);
  if (settings.radius) root.style.setProperty("--radius", settings.radius);
  if (settings.stripeColor1)
    root.style.setProperty("--stripe-color1", settings.stripeColor1);
  if (settings.stripeColor2)
    root.style.setProperty("--stripe-color2", settings.stripeColor2);

  const rawGrid = settings.gridLineColor?.trim();
  const effectiveGrid =
    !rawGrid ||
    rawGrid === "#E7E5E4" ||
    rawGrid === "#e7dbdc" ||
    rawGrid === "#cbd5e1" ||
    rawGrid === "#e2e8f0" ||
    rawGrid === "#ccc" ||
    rawGrid === "#ddd" ||
    rawGrid === "#94a3b8"
      ? "rgba(0, 0, 0, 0.035)"
      : rawGrid;

  root.style.setProperty("--grid-line-color", effectiveGrid);
  root.style.setProperty("--table-grid-color", effectiveGrid);
  root.style.setProperty("--table-border-color", effectiveGrid);

  const effectiveHeaderBg = settings.tableHeaderBg || "#E9D9DF";
  root.style.setProperty("--table-header-bg", effectiveHeaderBg);
  const effectiveSubHeaderBg =
    settings.tableSubHeaderBg ||
    (settings.preset && TASTE_PRESETS[settings.preset]?.tableSubHeaderBg) ||
    "#FAF1F4";
  root.style.setProperty("--table-sub-header-bg", effectiveSubHeaderBg);
  // Table header and table footer background are synchronized to have the exact same color via utility function
  const effectiveFooterBg = syncTableFooterBgFromHeader(root);
  root.style.setProperty("--table-column-header-bg", settings.tableColumnHeaderBg || "#D9C9D0");
  root.style.setProperty("--table-data-bg", settings.tableDataBg || "#FBF8FA");

  // Dynamic automatic contrast text color computation for table header and footer based on luminance
  const preferredDarkCandidate = settings.text || "#1E293B";
  const headerContrast = computeContrastTextColor(effectiveHeaderBg, preferredDarkCandidate);
  root.style.setProperty("--table-header-text-color", headerContrast.primary);
  root.style.setProperty("--table-header-text", headerContrast.primary);
  root.style.setProperty("--table-header-muted-color", headerContrast.muted);

  const footerContrast = computeContrastTextColor(effectiveFooterBg, preferredDarkCandidate);
  root.style.setProperty("--table-footer-text-color", footerContrast.primary);
  root.style.setProperty("--table-footer-text", footerContrast.primary);
  root.style.setProperty("--table-footer-muted-color", footerContrast.muted);

  // Dynamic high-contrast header text color computation
  const colHeaderBg =
    settings.preset === "espresso-blush" && sameValue(settings.tableColumnHeaderBg, "#3D2A2A")
      ? "#C49797"
      : settings.tableColumnHeaderBg || "#D9C9D0";
  const parsedHeaderBg = parseCssColor(colHeaderBg);
  let computedHeaderTextColor =
    settings.preset === "espresso-blush" && sameValue(settings.tableColumnHeaderTextColor, "#FBE8B9")
      ? "#3D2A2A"
      : settings.tableColumnHeaderTextColor || "";

  // Verify contrast against header background
  const hasAdequateContrast =
    computedHeaderTextColor &&
    isValidColor(computedHeaderTextColor) &&
    calculateContrastRatio(colHeaderBg, computedHeaderTextColor) >= 3.8 &&
    computedHeaderTextColor.trim().toUpperCase() !== colHeaderBg.trim().toUpperCase() &&
    !(
      computedHeaderTextColor.trim().toUpperCase() === (settings.accent || "").trim().toUpperCase() &&
      calculateContrastRatio(colHeaderBg, settings.accent || "") < 3.8
    );

  if (!hasAdequateContrast) {
    if (parsedHeaderBg) {
      const contrastWithWhite = calculateContrastRatio(colHeaderBg, "#FFFFFF");
      const darkColorCandidate =
        settings.preset === "espresso-blush"
          ? "#3D2A2A"
          : settings.preset === "soft-matcha" || (settings.accent && settings.accent.toUpperCase() === "#A0B8A2")
          ? "#1E2A20"
          : settings.text || settings.accent || "#1E293B";
      const contrastWithDark = calculateContrastRatio(colHeaderBg, darkColorCandidate);

      if (contrastWithWhite >= 3.8 && contrastWithWhite >= contrastWithDark) {
        computedHeaderTextColor = "#FFFFFF";
      } else {
        computedHeaderTextColor = contrastWithDark >= 3.8 ? darkColorCandidate : "#1E293B";
      }
    } else {
      computedHeaderTextColor = "#1E293B";
    }
  }

  root.style.setProperty("--table-column-header-text-color", computedHeaderTextColor);
  root.style.setProperty("--table-column-header-text", computedHeaderTextColor);

  if (settings.titleAlign) {
    const [flexAlign, textAlign] = settings.titleAlign.split("|");
    root.style.setProperty("--title-align", flexAlign);
    root.style.setProperty("--text-align", textAlign);
  }

  if (settings.sidebarPos === "right") {
    document.body.classList.add("sidebar-right");
  } else {
    document.body.classList.remove("sidebar-right");
  }

  // Inject custom CSS rules
  let styleEl = document.getElementById("custom-ui-rules");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "custom-ui-rules";
    document.head.appendChild(styleEl);
  }

  let css = "";
  css += `
    .table-container,
    .table-container table,
    .data-table-wrapper,
    .pivot-table-container,
    .master-ae-table-wrapper,
    #table-card,
    header.table-header,
    div.table-wrapper,
    .main-header-wrapper,
    .table-data-container {
      border-radius: 0px !important;
    }

    .page-master-config .unified-table-frame,
    .page-master-config .table-container,
    .pivot-master-frame {
      border-radius: var(--table-radius, 12px) !important;
    }

    .trial-balance-frame {
      border: 1px solid #dfd0d6 !important;
      border-radius: 0px !important;
      padding: 0px !important;
      gap: 0px !important;
    }

    /* General Table & Grid Rules */
    table, 
    .data-table-wrapper table, 
    .pivot-table-container table, 
    .pivot-master-table,
    .master-ae-table-wrapper table {
      border-color: ${effectiveGrid} !important;
      font-size: var(--responsive-table-font-size, ${settings.fontSize || "13px"}) !important;
      font-family: ${settings.tableFont || "var(--font-table, var(--font-main))"} !important;
    }

    table th, 
    table td, 
    .data-table-wrapper th, 
    .data-table-wrapper td, 
    .pivot-table-container th, 
    .pivot-table-container td, 
    .pivot-master-table th,
    .pivot-master-table td,
    .master-ae-table-wrapper th, 
    .master-ae-table-wrapper td,
    .unified-table-frame th,
    .unified-table-frame td,
    .reconcile-table-region th,
    .reconcile-table-region td,
    .analysis-data-table th,
    .analysis-data-table td,
    .bulk-payment-layout table th,
    .bulk-payment-layout table td {
      border-color: ${effectiveGrid} !important;
      border-right: 1px solid ${effectiveGrid} !important;
      border-left: none !important;
      padding: ${effectivePadding} !important;
      font-size: var(--responsive-table-font-size, ${settings.fontSize || "13px"}) !important;
      font-family: ${settings.tableFont || "var(--font-table, var(--font-main))"} !important;
    }

    table th :where(span, div, button, input, select, option, label, p),
    table td :where(span, div, button, input, select, option, label, p),
    .pivot-master-table th :where(span, div, button, input, select, option, label, p),
    .pivot-master-table td :where(span, div, button, input, select, option, label, p) {
      font-family: ${settings.tableFont || "var(--font-table, var(--font-main))"} !important;
      font-size: var(--responsive-table-font-size, ${settings.fontSize || "13px"}) !important;
    }

    table th, 
    .data-table-wrapper th, 
    .pivot-table-container th, 
    .pivot-master-table th,
    .master-ae-table-wrapper th,
    .audit-data-table-wrapper th,
    .unified-table-frame th,
    .analysis-data-table th,
    .reconcile-table-region th {
      text-align: center !important;
    }

    table th > div, 
    .data-table-wrapper th > div, 
    .pivot-table-container th > div, 
    .pivot-master-table th > div,
    .master-ae-table-wrapper th > div,
    .audit-data-table-wrapper th > div,
    .unified-table-frame th > div,
    .analysis-data-table th > div,
    .reconcile-table-region th > div,
    table th span,
    .data-table-wrapper th span,
    .pivot-table-container th span,
    .pivot-master-table th span {
      justify-content: center !important;
      text-align: center !important;
    }

    table tbody td,
    .data-table-wrapper tbody td,
    .pivot-table-container tbody td,
    .pivot-master-table tbody td,
    .master-ae-table-wrapper tbody td,
    .audit-data-table-wrapper tbody td {
      background-color: ${settings.tableDataBg || "#FFFFFF"} !important;
    }

    thead,
    thead th,
    thead tr,
    table thead th, 
    table thead tr, 
    .data-table-wrapper thead th, 
    .data-table-wrapper thead tr,
    .pivot-table-container thead th,
    .pivot-table-container thead tr,
    .pivot-master-table thead th,
    .pivot-master-table thead tr,
    .master-ae-table-wrapper thead th,
    .master-ae-table-wrapper thead tr,
    .audit-data-table-wrapper thead th,
    .audit-data-table-wrapper thead tr,
    .sticky-header-col,
    tfoot,
    table tfoot,
    table tfoot tr,
    table tfoot td,
    table tfoot th,
    .data-table-wrapper tfoot td,
    .data-table-wrapper tfoot th,
    .master-ae-table-wrapper tfoot td,
    .master-ae-table-wrapper tfoot th,
    .pivot-table-container tfoot td,
    .pivot-table-container tfoot th,
    .pivot-master-table tfoot td,
    .pivot-master-table tfoot th,
    .audit-data-table-wrapper tfoot td,
    .audit-data-table-wrapper tfoot th,
    .total-row,
    .total-row td,
    .total-row th,
    tr.total-row td,
    tr.total-row th {
      background-color: ${settings.tableColumnHeaderBg || "#D9C9D0"} !important;
      color: var(--table-column-header-text-color, ${computedHeaderTextColor || "inherit"}) !important;
      border-left: none !important;
      border-right: none !important;
    }

    .dark tfoot,
    .dark table tfoot,
    .dark table tfoot tr,
    .dark table tfoot td,
    .dark table tfoot th,
    .dark .total-row,
    .dark .total-row td,
    .dark .total-row th {
      background-color: var(--table-column-header-bg, #1e293b) !important;
      color: var(--table-column-header-text-color, var(--table-column-header-text, #f8fafc)) !important;
    }

    table thead th :where(span, div, p),
    .pivot-master-table thead th :where(span, div, p),
    .data-table-wrapper thead th :where(span, div, p),
    .master-ae-table-wrapper thead th :where(span, div, p),
    .audit-data-table-wrapper thead th :where(span, div, p),
    .analysis-data-table thead th :where(span, div, p),
    table thead th svg:not(.stroke-rose-600):not(.text-rose-600) {
      color: inherit !important;
    }

    .unified-table-frame-header,
    .table-header,
    .trial-balance-header,
    .pivot-master-frame .unified-table-frame-header,
    .page-master-ae .unified-table-frame-header,
    .page-master-config .unified-table-frame-header,
    .bulk-payment-data-panel .unified-table-frame-header,
    .analysis-table-frame > .unified-table-frame-header {
      background: ${effectiveHeaderBg} !important;
      background-color: ${effectiveHeaderBg} !important;
      color: var(--table-header-text-color, ${headerContrast.primary}) !important;
    }

    .unified-table-frame-header :is(h1, h2, h3, h4, .app-table-title-remainder, .app-table-title-remainder--expanded),
    .table-header :is(h1, h2, h3, h4),
    .trial-balance-header :is(h1, h2, h3, h4) {
      color: var(--table-header-text-color, ${headerContrast.primary}) !important;
    }

    .app-table-title-remainder,
    .app-table-title-remainder--expanded,
    #trial-balance-summary #trial-balance-title .app-table-title-remainder,
    #trial-balance-summary .trial-balance-title .app-table-title-remainder,
    .page-timesheet-summary h1 .app-table-title-remainder,
    .navbar-current-label {
      font-family: ${effectiveTitleFont} !important;
    }

    ${
      settings.titleFontIncludeInitial
        ? `
    .app-table-initial-mark,
    #trial-balance-summary #trial-balance-title .app-table-initial-mark,
    #trial-balance-summary .trial-balance-title .app-table-initial-mark {
      width: auto !important;
      height: auto !important;
      line-height: 1.35 !important;
    }
    .app-table-initial-mark__glyph,
    .table-initial-toggle[aria-expanded="false"] .app-table-initial-mark__glyph,
    #trial-balance-summary #trial-balance-title .app-table-initial-mark__glyph,
    #trial-balance-summary .trial-balance-title .app-table-initial-mark__glyph {
      width: auto !important;
      height: auto !important;
      line-height: 1.35 !important;
      color: var(--table-initial-color, var(--primary, #8E4A49)) !important;
      background: transparent !important;
      background-color: transparent !important;
      -webkit-mask-image: none !important;
      mask-image: none !important;
      font-family: ${effectiveTitleFont} !important;
      font-weight: 400 !important;
      letter-spacing: -0.025em !important;
      text-transform: uppercase !important;
      filter: none !important;
    }
    .app-table-initial-mark__glyph:empty::before {
      content: attr(data-glyph);
    }
    .unified-table-frame-header .app-table-initial-mark__glyph,
    .table-header .app-table-initial-mark__glyph,
    .trial-balance-header .app-table-initial-mark__glyph {
      color: var(--table-header-text-color, ${headerContrast.primary}) !important;
    }
    .app-table-title-line,
    #trial-balance-summary #trial-balance-title,
    #trial-balance-summary .trial-balance-title {
      gap: 0px !important;
    }
        `
        : ""
    }

    .unified-table-frame-header :is(p, .app-table-title-meta, .text-muted-foreground),
    .table-header :is(p, .text-muted-foreground),
    .trial-balance-header :is(p, .text-muted-foreground) {
      color: var(--table-header-muted-color, ${headerContrast.muted}) !important;
    }

    .bu-filter-bar {
      background: ${effectiveSubHeaderBg} !important;
      background-color: ${effectiveSubHeaderBg} !important;
    }

    .table-footer-pagination,
    .unified-table-frame-footer,
    .pivot-master-frame .unified-table-frame-footer,
    .page-master-ae .unified-table-frame-footer,
    .page-master-ae .table-footer-pagination,
    .page-master-config .table-footer-pagination,
    .page-master-config .unified-table-frame-footer,
    .bulk-payment-data-panel .table-footer-pagination,
    .analysis-data-table > .table-footer-pagination {
      background: ${effectiveFooterBg} !important;
      background-color: ${effectiveFooterBg} !important;
      color: var(--table-footer-text-color, ${footerContrast.primary}) !important;
    }

    .table-footer-pagination :is(span:not([class*="badge"]), p, label, .text-muted-foreground, .text-slate-600, .text-slate-700),
    .unified-table-frame-footer :is(span:not([class*="badge"]), p, label, .text-muted-foreground, .text-slate-600, .text-slate-700) {
      color: var(--table-footer-text-color, ${footerContrast.primary}) !important;
    }

    .table-footer-pagination :is(.text-muted-foreground, .app-table-title-meta),
    .unified-table-frame-footer :is(.text-muted-foreground, .app-table-title-meta) {
      color: var(--table-footer-muted-color, ${footerContrast.muted}) !important;
    }

    .table-footer-pagination,
    .table-footer-pagination *,
    .unified-table-frame-footer,
    .unified-table-frame-footer * {
      font-family: ${settings.tableFont || "var(--font-table, var(--font-main))"} !important;
      font-size: 12px !important;
    }

    button:not(.rounded-full):not(.rounded-none):not(.search-btn-exception),
    [role="button"]:not(.rounded-full):not(.rounded-none):not(.search-btn-exception) {
      border-radius: 20px !important;
    }

    span.rounded-full,
    div.rounded-full,
    input.rounded-full,
    button.rounded-full,
    .search-btn-exception,
    [class*="rounded-full"] {
      border-radius: 9999px !important;
    }

    .flex.bg-slate-200\\/30,
    div.flex.bg-slate-200\\/30,
    div[class*="bg-slate-200/30"] {
      background-color: transparent !important;
      border-width: 0px !important;
      box-shadow: none !important;
    }

    body, #root, .bg-background {
      background: radial-gradient(circle at 18% 14%, ${settings.stripeColor1 || "#FBF8FA"} 0%, transparent 58%),
                  radial-gradient(circle at 82% 86%, ${settings.stripeColor2 || "#F1E7EB"} 0%, transparent 62%),
                  linear-gradient(135deg, ${settings.stripeColor1 || "#FBF8FA"} 0%, ${settings.stripeColor2 || "#F1E7EB"} 100%) !important;
      background-attachment: fixed !important;
    }

    /* CARD BORDERS & THEMED BACKGROUNDS FOR ALL PAGES */
    .vintage-card,
    .stat-card,
    .stat-group,
    .payroll-theme-card,
    .bu-summary-card,
    .bu-amount-card,
    .master-info-card,
    .master-theme-panel,
    .unified-table-frame,
    .holding-card,
    .summary-card,
    .analytics-card,
    .metric-card,
    .filter-card,
    .side-panel-card,
    div[class*="theme-card"],
    div[class*="info-card"],
    div[class*="summary-card"],
    div[class*="amount-card"],
    div[class*="stat-card"] {
      border: 1px solid ${settings.border || "var(--border, #E7E5E4)"} !important;
      border-color: ${settings.border || "var(--border, #E7E5E4)"} !important;
      background-color: var(--card, ${card}) !important;
      color: var(--card-foreground, var(--foreground)) !important;
    }

    .payroll-theme-card {
      background-color: color-mix(in srgb, ${accent} 6%, var(--card, ${card})) !important;
      border: 1px solid color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
      border-color: color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
    }

    .bu-summary-card {
      background: linear-gradient(145deg, var(--card, ${card}) 0%, color-mix(in srgb, ${accent} 5%, var(--card, ${card})) 100%) !important;
      border: 1px solid color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
      border-color: color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
    }

    .bu-amount-card {
      background: linear-gradient(135deg, color-mix(in srgb, ${accent} 8%, var(--card, ${card})) 0%, color-mix(in srgb, ${accent} 4%, var(--card, ${card})) 100%) !important;
      border: 1px solid color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
      border-color: color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
    }

    .master-info-card {
      background: linear-gradient(145deg, color-mix(in srgb, ${accent} 6%, var(--card, ${card})), color-mix(in srgb, ${accent} 2%, var(--card, ${card}))) !important;
      border: 1px solid color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
      border-color: color-mix(in srgb, ${accent} 22%, ${settings.border || "var(--border, #E7E5E4)"}) !important;
    }
  `;

  css += `
    .pivot-table-container,
    .pivot-table-container table,
    .pivot-table-container th,
    .pivot-table-container td,
    .pivot-table-container input,
    .pivot-master-table,
    .pivot-master-table th,
    .pivot-master-table td,
    .pivot-master-table input,
    .master-ae-table-wrapper,
    .master-ae-table-wrapper table,
    .master-ae-table-wrapper th,
    .master-ae-table-wrapper td,
    .master-ae-table-wrapper input {
      font-family: var(--font-table, var(--font-main)) !important;
      font-size: var(--responsive-table-font-size, ${settings.fontSize || "12px"}) !important;
    }

    .pivot-table-container thead,
    .pivot-table-container thead tr,
    .pivot-table-container thead th,
    .pivot-master-table thead,
    .pivot-master-table thead tr,
    .pivot-master-table thead th {
      background-color: ${settings.tableColumnHeaderBg || "#F4ECD8"} !important;
    }

    .pivot-table-container tfoot,
    .pivot-table-container tfoot tr,
    .pivot-table-container tfoot td,
    .pivot-table-container .total-row,
    .pivot-table-container .total-row td,
    .pivot-master-table tfoot,
    .pivot-master-table tfoot tr,
    .pivot-master-table tfoot td {
      background-color: ${settings.tableColumnHeaderBg || "#F4ECD8"} !important;
    }

    .pivot-table-container thead input:not(:focus),
    .pivot-master-table thead input:not(:focus) {
      background-color: transparent !important;
    }
  `;

  if (settings.customRules && Array.isArray(settings.customRules)) {
    settings.customRules.forEach((rule) => {
      css += buildCustomRuleCss(rule);
    });
  }

  styleEl.innerHTML = css;

  // Keep live preview separate so an in-progress rule never becomes part of
  // the persisted stylesheet before the user applies it.
  let previewStyleEl = document.getElementById("custom-ui-preview");
  if (!previewStyleEl) {
    previewStyleEl = document.createElement("style");
    previewStyleEl.id = "custom-ui-preview";
    document.head.appendChild(previewStyleEl);
  }
  previewStyleEl.innerHTML = previewRule
    ? buildCustomRuleCss(previewRule, true)
    : "";
}

export async function loadUiSettings(): Promise<UiSettings> {
  const sanitize = (s: unknown): UiSettings => {
    const sObj = (s && typeof s === "object" ? s : {}) as Partial<UiSettings>;
    let result: UiSettings = { ...defaultSettings, ...sObj };
    result = migrateCocoaBlushContrast(result);
    result = migrateFrenchMatchaPalette(result);
    result = migrateSoftMatchaPalette(result);
    result = migrateEspressoBlushPalette(result);
    result = migrateMultiColorPastelPalettes(result);
    // Move previous default accents to Lila Rose while preserving deliberate
    // custom colors and every other preset.
    if (
      result.preset === "systematic" &&
      typeof result.accent === "string" &&
      ["#8E659A", "#413644", "#A34C54"].includes(result.accent.toUpperCase())
    ) {
      result.accent = defaultSettings.accent;
    }
    if (!result.tableColumnHeaderTextColor) {
      result.tableColumnHeaderTextColor = defaultSettings.tableColumnHeaderTextColor || "#FFFFFF";
    }
    // Migrate only untouched values from the previous default palette. Custom
    // user colors and non-default presets remain unchanged.
    if (result.preset === "systematic") {
      const migrateDefaultColor = (
        key: keyof Pick<
          UiSettings,
          | "bg"
          | "text"
          | "border"
          | "stripeColor1"
          | "stripeColor2"
          | "gridLineColor"
          | "tableHeaderBg"
          | "tableFooterBg"
          | "tableColumnHeaderBg"
          | "tableDataBg"
        >,
        previousValue: string,
      ) => {
        const currentValue = result[key];
        if (
          typeof currentValue === "string" &&
          currentValue.toUpperCase() === previousValue.toUpperCase()
        ) {
          result[key] = defaultSettings[key] || "";
        }
      };

      migrateDefaultColor("bg", "#EAE7EE");
      migrateDefaultColor("bg", "#F6F7F7");
      migrateDefaultColor("text", "#4D3653");
      migrateDefaultColor("text", "#3A3129");
      migrateDefaultColor("border", "#D3CCD8");
      migrateDefaultColor("border", "#CFCDC2");
      migrateDefaultColor("stripeColor1", "#FFFFFF");
      migrateDefaultColor("stripeColor1", "#F6F7F7");
      migrateDefaultColor("stripeColor2", "#EFECE8");
      migrateDefaultColor("stripeColor2", "#DFD9DF");
      migrateDefaultColor("gridLineColor", "rgba(77, 54, 83, 0.06)");
      migrateDefaultColor("gridLineColor", "rgba(58, 49, 41, 0.08)");
      migrateDefaultColor("gridLineColor", "#CFCDC2");
      migrateDefaultColor("tableHeaderBg", "#CFC4D6");
      migrateDefaultColor("tableHeaderBg", "#DFD9DF");
      migrateDefaultColor("tableFooterBg", "#CFC4D6");
      migrateDefaultColor("tableFooterBg", "#DFD9DF");
      migrateDefaultColor("tableColumnHeaderBg", "#E3DBE8");
      migrateDefaultColor("tableColumnHeaderBg", "#C4CBD5");
      migrateDefaultColor("tableDataBg", "#FCFBFD");
      migrateDefaultColor("tableDataBg", "#F6F7F7");
    }
    // Force valid hex for specific fields
    if (!isValidColor(result.accent)) result.accent = defaultSettings.accent;
    if (!isValidColor(result.text)) result.text = defaultSettings.text;
    if (!isValidColor(result.border)) result.border = defaultSettings.border;
    if (!isValidColor(result.bg)) result.bg = defaultSettings.bg;
    if (result.stripeColor1 && !isValidColor(result.stripeColor1))
      result.stripeColor1 = defaultSettings.stripeColor1;
    if (result.stripeColor2 && !isValidColor(result.stripeColor2))
      result.stripeColor2 = defaultSettings.stripeColor2;
    if (result.gridLineColor && !isValidColor(result.gridLineColor))
      result.gridLineColor = defaultSettings.gridLineColor;
    if (result.tableHeaderBg && !isValidColor(result.tableHeaderBg))
      result.tableHeaderBg = defaultSettings.tableHeaderBg;
    if (result.tableFooterBg && !isValidColor(result.tableFooterBg))
      result.tableFooterBg = defaultSettings.tableFooterBg;
    if (result.tableColumnHeaderBg && !isValidColor(result.tableColumnHeaderBg))
      result.tableColumnHeaderBg = defaultSettings.tableColumnHeaderBg;
    if (result.tableDataBg && !isValidColor(result.tableDataBg))
      result.tableDataBg = defaultSettings.tableDataBg;
    if (!/^\d+(?:\.\d+)?(?:px|rem|em)$/.test(result.fontSize || ""))
      result.fontSize = defaultSettings.fontSize;

    // Validate bgImage URL (must start with http, https or data:)
    if (
      result.bgImage &&
      !result.bgImage.startsWith("http") &&
      !result.bgImage.startsWith("data:")
    ) {
      result.bgImage = "";
    }

    if (!result.customRules || !Array.isArray(result.customRules)) {
      result.customRules = [...defaultCustomRules];
    } else {
      // A custom rule is user-owned state. Never silently discard a valid
      // selector during hydration: doing so made a DIV jump back to its
      // original style after the next DIV was edited or after a reload.
      // Rules now return to the default state only through an explicit delete.
      result.customRules = result.customRules.filter(
        (rule) => rule && isSafeCustomSelector(rule.selector),
      );

      defaultCustomRules.forEach((defRule) => {
        const idx = result.customRules!.findIndex(
          (r) => r.selector === defRule.selector || r.id === defRule.id
        );
        if (idx === -1) {
          result.customRules!.push(defRule);
        }
      });
    }

    // Normalize legacy/removed presets to their new replacement presets
    if (result.preset) {
      if (result.preset === "bardak-pastel" || result.preset === "breeze-blue") {
        result.preset = "pastel-blossom";
      } else if (result.preset === "dido-dream" || result.preset === "dream-state") {
        result.preset = "dido-dreamcore";
      } else if (result.preset === "espresso-blush") {
        result.preset = "pastel-cocoa";
      } else if (result.preset === "systematic") {
        result.preset = "opal-garden";
      }
    }

    if (result.preset && TASTE_PRESETS[result.preset] && result.preset !== "default") {
      const presetDef = TASTE_PRESETS[result.preset];
      if (!result.tableHeaderBg) result.tableHeaderBg = presetDef.tableHeaderBg;
      if (!result.tableSubHeaderBg) result.tableSubHeaderBg = presetDef.tableSubHeaderBg;
      if (!result.tableFooterBg) result.tableFooterBg = presetDef.tableHeaderBg;
      if (!result.tableColumnHeaderBg) result.tableColumnHeaderBg = presetDef.tableColumnHeaderBg;
      if (!result.tableColumnHeaderTextColor) result.tableColumnHeaderTextColor = presetDef.tableColumnHeaderTextColor;
    } else if (result.tableHeaderBg) {
      result.tableFooterBg = result.tableHeaderBg;
    }

    return { ...result, tableRadius: "0px" };
  };

  try {
    const saved =
      (await localforage.getItem<UiSettings>(UI_SETTINGS_KEY)) ||
      (await localforage.getItem<UiSettings>("PayrollApp_UiSettings_HushedElegance_v10")) ||
      (await localforage.getItem<UiSettings>("PayrollApp_UiSettings_HushedElegance_v9")) ||
      (await localforage.getItem<UiSettings>("PayrollApp_UiSettings_HushedElegance_v8"));
    if (saved) return sanitize(saved);

    const legacySaved =
      localStorage.getItem(UI_SETTINGS_KEY) ||
      localStorage.getItem("PayrollApp_UiSettings_HushedElegance_v10") ||
      localStorage.getItem("PayrollApp_UiSettings_HushedElegance_v9") ||
      localStorage.getItem("PayrollApp_UiSettings_HushedElegance_v8");
    if (legacySaved) {
      try {
        const parsed = JSON.parse(legacySaved);
        return sanitize(parsed);
      } catch {
        // Ignore parsing errors
      }
    }
  } catch {
    // Ignore storage errors
  }
  try {
    const userDef = getUserDefaultUiSettingsSync();
    if (userDef) return sanitize(userDef);
  } catch {
    // Ignore fallback errors
  }
  return defaultSettings;
}

export async function saveUserDefaultUiSettings(settings: UiSettings): Promise<void> {
  const settingsToSave = { ...settings, tableRadius: "0px" };
  Object.assign(defaultSettings, settingsToSave);

  const updatedPresetFields = {
    bg: settingsToSave.bg || defaultSettings.bg,
    accent: settingsToSave.accent || defaultSettings.accent,
    text: settingsToSave.text || defaultSettings.text,
    border: settingsToSave.border || defaultSettings.border,
    stripeColor1: settingsToSave.stripeColor1 || defaultSettings.stripeColor1,
    stripeColor2: settingsToSave.stripeColor2 || defaultSettings.stripeColor2,
    gridLineColor: settingsToSave.gridLineColor || defaultSettings.gridLineColor,
    tableHeaderBg: settingsToSave.tableHeaderBg || defaultSettings.tableHeaderBg,
    tableSubHeaderBg: settingsToSave.tableSubHeaderBg || defaultSettings.tableSubHeaderBg,
    tableFooterBg: settingsToSave.tableFooterBg || defaultSettings.tableFooterBg,
    tableColumnHeaderBg: settingsToSave.tableColumnHeaderBg || defaultSettings.tableColumnHeaderBg,
    tableColumnHeaderTextColor: settingsToSave.tableColumnHeaderTextColor || defaultSettings.tableColumnHeaderTextColor,
    tableDataBg: settingsToSave.tableDataBg || defaultSettings.tableDataBg,
    tableFont: settingsToSave.tableFont || defaultSettings.tableFont,
    tableRadius: settingsToSave.tableRadius || defaultSettings.tableRadius,
  };

  if (TASTE_PRESETS["default"]) {
    Object.assign(TASTE_PRESETS["default"], updatedPresetFields);
  }

  // Synchronize "Lila Rose · Hồng Phấn (Theo ảnh)" ("phần ảnh tôi gửi") with the custom saved default!
  if (TASTE_PRESETS["lila-rose"]) {
    Object.assign(TASTE_PRESETS["lila-rose"], updatedPresetFields);
  }

  try {
    await localforage.setItem(USER_DEFAULT_UI_SETTINGS_KEY, settingsToSave);
  } catch (err) {
    console.error("Failed to save user default in localforage", err);
  }
  const smallSettings: Partial<UiSettings> = { ...settingsToSave };
  delete smallSettings.bgImage;
  try {
    localStorage.setItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small", JSON.stringify(smallSettings));
  } catch {
    // Ignore storage quota errors
  }
  window.dispatchEvent(new Event("ui-user-default-changed"));
}

export async function loadUserDefaultUiSettings(): Promise<UiSettings | null> {
  try {
    const saved = await localforage.getItem<UiSettings>(USER_DEFAULT_UI_SETTINGS_KEY);
    if (saved && typeof saved === "object") return saved;
  } catch {
    // fallback
  }
  try {
    const savedLocal = localStorage.getItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small");
    if (savedLocal) {
      return JSON.parse(savedLocal);
    }
  } catch {
    // ignore
  }
  return null;
}

export function getUserDefaultUiSettingsSync(): UiSettings | null {
  try {
    const savedLocal = localStorage.getItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small");
    if (savedLocal) {
      return JSON.parse(savedLocal);
    }
  } catch {
    // ignore
  }
  return null;
}

export async function clearUserDefaultUiSettings(): Promise<void> {
  try {
    await localforage.removeItem(USER_DEFAULT_UI_SETTINGS_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(USER_DEFAULT_UI_SETTINGS_KEY + "_small");
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("ui-user-default-changed"));
}

export async function getEffectiveDefaultUiSettings(): Promise<UiSettings> {
  const userDef = await loadUserDefaultUiSettings();
  if (userDef) {
    return { ...defaultSettings, ...userDef };
  }
  return defaultSettings;
}

export async function saveUiSettings(nextSettings: UiSettings): Promise<void> {
  nextSettings = { ...nextSettings, tableRadius: "0px" };
  await localforage.setItem(UI_SETTINGS_KEY, nextSettings);
  const smallSettings: Partial<UiSettings> = { ...nextSettings };
  delete smallSettings.bgImage;
  try {
    localStorage.setItem(UI_SETTINGS_KEY + "_small", JSON.stringify(smallSettings));
  } catch {
    // Ignore storage quota errors
  }
  applyUiSettings(nextSettings);
  window.dispatchEvent(new Event("ui-settings-changed"));
}

export function useUiSettings() {
  const [settings, setSettings] = useState<UiSettings>(defaultSettings);

  useEffect(() => {
    let active = true;
    const fetchSettings = async () => {
      try {
        const s = await loadUiSettings();
        if (active) {
          setSettings(s);
        }
      } catch (err) {
        console.error("Failed to load reactive UI settings:", err);
      }
    };

    fetchSettings();

    const handleUpdate = () => {
      fetchSettings();
    };

    window.addEventListener("ui-settings-changed", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      active = false;
      window.removeEventListener("ui-settings-changed", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  return settings;
}

