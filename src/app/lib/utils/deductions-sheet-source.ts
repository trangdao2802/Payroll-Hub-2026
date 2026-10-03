export type DeductionsSourceRow = Record<string, unknown>;

export interface DeductionsSheetSourceResolution {
  sheetSource: string;
  salaryMonth: number | null;
  needsSourceMonthNote: boolean;
}

const cleanText = (value: unknown) => String(value ?? "").trim();

const normalizeText = (value: unknown) =>
  cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "D")
    .toUpperCase();

const toMonth = (value: string | undefined): number | null => {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12
    ? month
    : null;
};

function getExplicitMonths(value: unknown): number[] {
  const normalized = normalizeText(value).replace(/\b(?:19|20)\d{2}\b/g, "");
  const months: number[] = [];

  for (const match of normalized.matchAll(
    /\b(?:THANG|THG|T)?\s*(0?[1-9]|1[0-2])\b/g,
  )) {
    const month = toMonth(match[1]);
    if (month !== null && !months.includes(month)) months.push(month);
  }

  return months;
}

export function isMultiMonthHoldSource(value: unknown): boolean {
  const normalized = normalizeText(value);
  return (
    /\bHOLD\b/.test(normalized) &&
    normalized.includes("+") &&
    getExplicitMonths(normalized).length > 1
  );
}

export function getSalaryMonthFromNote(value: unknown): number | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const contextualMatch = normalized.match(
    /\b(?:LUONG|SALARY)\b[^0-9]{0,32}(?:THANG|THG|MONTH|T)?\s*(0?[1-9]|1[0-2])\b/,
  );
  if (contextualMatch) return toMonth(contextualMatch[1]);

  const monthLabelMatch = normalized.match(
    /\b(?:THANG|THG|MONTH|T)\s*(0?[1-9]|1[0-2])\b/,
  );
  if (monthLabelMatch) return toMonth(monthLabelMatch[1]);

  const monthYearMatch = normalized.match(
    /\b(0?[1-9]|1[0-2])\s*[./-]\s*(?:19|20)\d{2}\b/,
  );
  return toMonth(monthYearMatch?.[1]);
}

export function resolveDeductionsSheetSource(
  sourceValue: unknown,
  noteValue: unknown,
): DeductionsSheetSourceResolution {
  const sheetSource = cleanText(sourceValue);
  if (!isMultiMonthHoldSource(sheetSource)) {
    return {
      sheetSource,
      salaryMonth: null,
      needsSourceMonthNote: false,
    };
  }

  const salaryMonth = getSalaryMonthFromNote(noteValue);
  if (salaryMonth === null) {
    return {
      sheetSource,
      salaryMonth: null,
      needsSourceMonthNote: true,
    };
  }

  return {
    sheetSource: `Hold T${salaryMonth}`,
    salaryMonth,
    needsSourceMonthNote: false,
  };
}

/** Sheet Source is authoritative; a combined HOLD sheet needs its salary-month Note. */
export function getDeductionsSourceMonth(
  sourceValue: unknown,
  noteValue: unknown,
  reportMonth: unknown,
): string | null {
  const resolution = resolveDeductionsSheetSource(sourceValue, noteValue);
  if (resolution.needsSourceMonthNote) return null;
  const source = normalizeText(resolution.sheetSource);
  const parseFullMonth = (text: string): string | null => {
    const monthFirst = text.match(/(?:^|[^\d])(0?[1-9]|1[0-2])\s*[./-]\s*((?:19|20)\d{2})\b/);
    if (monthFirst) return `${monthFirst[1].padStart(2, "0")}.${monthFirst[2]}`;
    const yearFirst = text.match(/\b((?:19|20)\d{2})\s*[./-]\s*(0?[1-9]|1[0-2])\b/);
    return yearFirst ? `${yearFirst[2].padStart(2, "0")}.${yearFirst[1]}` : null;
  };
  const fullSourceMonth = parseFullMonth(source);
  if (fullSourceMonth) return fullSourceMonth;
  if (resolution.salaryMonth !== null) {
    const fullNoteMonth = parseFullMonth(normalizeText(noteValue));
    if (fullNoteMonth) return fullNoteMonth;
  }
  const match = source.match(/(?:THANG|THG|MONTH|HOLD|T)\s*(0?[1-9]|1[0-2])\b/);
  const month = resolution.salaryMonth ?? toMonth(match?.[1]);
  const reporting = parseFullMonth(normalizeText(reportMonth));
  if (month === null || !reporting) return null;
  const [reportingMonth, reportingYear] = reporting.split(".").map(Number);
  const year = month > reportingMonth ? reportingYear - 1 : reportingYear;
  return `${String(month).padStart(2, "0")}.${year}`;
}

export function sortMissingDeductionsSourceNotesFirst<
  T extends DeductionsSourceRow,
>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aNeedsNote = Boolean(a.row._needsSheetSourceNote);
      const bNeedsNote = Boolean(b.row._needsSheetSourceNote);
      if (aNeedsNote !== bNeedsNote) return aNeedsNote ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
