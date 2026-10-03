import { parseMoneyToNumber, removeVietnameseTones } from "./data-utils";

type Row = Record<string, unknown>;

export function deductionsNote(row: Row): string {
  const note = String(row.Note ?? "").trim();
  const normalized = removeVietnameseTones(note).toUpperCase();
  return /^LUONG\s*(?:THANG|THG|T)\s*\d{1,2}\b/.test(normalized)
    ? String(row._adjacentNote ?? row["Diễn giải"] ?? "").trim()
    : note;
}

/** Scoped to a mounted table, with weak keys so old imports can be collected. */
export function createDeductionsPrioritizer() {
  const cache = new WeakMap<Row, { key: string; matching?: boolean; row?: Row }>();
  const entryOf = (row: Row) => {
    const existing = cache.get(row);
    if (existing) return existing;
    const name = removeVietnameseTones(String(row["Full name"] ?? row["Full Name"] ?? ""))
      .trim().replace(/\s+/g, " ").toUpperCase();
    const value = row["TOTAL PAYMENT"];
    const entry: { key: string; matching?: boolean; row?: Row } = { key: name && value !== "" && value != null
      ? `${name}|${Math.abs(parseMoneyToNumber(value))}` : "" };
    cache.set(row, entry);
    return entry;
  };
  return <T extends Row>(rows: T[]): T[] => {
    const counts = new Map<string, number>();
    rows.forEach(row => {
      const { key } = entryOf(row);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return rows.map(row => {
      const entry = entryOf(row);
      const matching = (counts.get(entry.key) ?? 0) > 1;
      if (!entry.row || entry.matching !== matching) {
        entry.matching = matching;
        entry.row = { ...row, _matchingDeduction: matching };
      }
      return entry.row as T;
    }).sort((a, b) => Number(b._matchingDeduction) - Number(a._matchingDeduction));
  };
}

export function prioritizeMatchingDeductions<T extends Row>(rows: T[]): T[] {
  return createDeductionsPrioritizer()(rows);
}
