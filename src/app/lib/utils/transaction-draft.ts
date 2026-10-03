import type { AppData } from "../../types";
import { commitTransactionEdits } from "./transaction-activity";
import { cacheActiveTransactionMonth } from "./reconciliation-sync";
import type { TransactionRow } from "./transaction-history";
import { editTransactionField, protectSavedTransactionIdentity } from './transaction-saved-fields';

export interface TransactionDraft {
  sourceRows: TransactionRow[];
  rows: TransactionRow[];
  editCount: number;
}

function matchesTransactionRow(
  candidate: TransactionRow,
  target: TransactionRow,
): boolean {
  if (candidate === target) return true;

  const candidateId = candidate.id;
  const targetId = target.id;
  if (candidateId && targetId && candidateId === targetId) return true;

  const candidateSerial = candidate["Payment Serial Number"];
  const targetSerial = target["Payment Serial Number"];
  return Boolean(
    candidateSerial && targetSerial && candidateSerial === targetSerial,
  );
}

export function applyTransactionDraftCellEdit(
  savedRows: TransactionRow[],
  currentDraft: TransactionDraft | null,
  targetRow: TransactionRow,
  field: string,
  value: unknown,
): TransactionDraft | null {
  const activeDraft =
    currentDraft?.sourceRows === savedRows ? currentDraft : null;
  const workingRows = activeDraft?.rows || savedRows;
  const rowIndex = workingRows.findIndex((row) =>
    matchesTransactionRow(row, targetRow),
  );
  if (rowIndex === -1) return activeDraft;
  if (
    String(workingRows[rowIndex]?.[field] ?? "") === String(value ?? "")
  ) {
    return activeDraft;
  }

  const rows = [...workingRows];
  rows[rowIndex] = editTransactionField(rows[rowIndex], field, value);
  return {
    sourceRows: savedRows,
    rows,
    editCount: (activeDraft?.editCount || 0) + 1,
  };
}

export function saveTransactionDraft(
  appData: AppData,
  draft: TransactionDraft,
  savedAt = new Date().toISOString(),
): AppData | null {
  if (appData.BankExport.data !== draft.sourceRows) return null;

  return cacheActiveTransactionMonth({
    ...appData,
    BankExport: { ...appData.BankExport, data: draft.rows.map((row, index) =>
      row === draft.sourceRows[index] ? row : protectSavedTransactionIdentity(row)) },
    TransactionActivity: commitTransactionEdits(
      appData,
      savedAt,
      draft.editCount,
    ),
  });
}
