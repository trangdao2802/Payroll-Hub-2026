import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_APP_DATA } from '../src/app/constants/initial-data';
import { cacheActiveTransactionMonth, syncReportingMonthReconciliation } from '../src/app/lib/utils/reconciliation-sync';
import { applyTransactionDraftCellEdit, saveTransactionDraft } from '../src/app/lib/utils/transaction-draft';
import { clearMasterPageData, clearMasterTableData } from '../src/app/lib/utils/data-clear-scopes';
import {
  findMismatchedTransactionHistoryPeriods,
  getSavedLocalTransactionSnapshots,
  replaceTransactionSnapshotsInAppData,
} from '../src/app/lib/utils/transaction-snapshot';

function editedMonth() {
  const app = structuredClone(INITIAL_APP_DATA);
  app.globalMonth = '08.2026';
  app.Bank_North_AE.data = ['08.2026', '09.2026'].map(month => ({
    'Tháng báo cáo': month, 'ID Number': 'OLD-ID', 'Full name': 'NGUYEN VAN AN',
    'Bank Account Number': '0012345678', 'TOTAL PAYMENT': 100_000,
  }));
  const generated = syncReportingMonthReconciliation(app, '08.2026');
  const rows = generated.BankExport.data;
  let draft = applyTransactionDraftCellEdit(rows, null, rows[0], 'Document ID', 'SAVED-ID')!;
  draft = applyTransactionDraftCellEdit(rows, draft, draft.rows[0], 'Beneficiary Account No.', '0099887766')!;
  draft = applyTransactionDraftCellEdit(rows, draft, draft.rows[0], 'Payment Amount', 120_000)!;
  return saveTransactionDraft(generated, draft)!;
}

test('automatic month reconciliation cannot replace a saved Transaction with the Bank AE source', () => {
  const saved = editedMonth();
  const reopened = syncReportingMonthReconciliation(structuredClone(saved), '08.2026');
  assert.deepEqual(reopened.BankExport.data, saved.BankExport.data);
  assert.deepEqual(reopened.TransactionActivity, saved.TransactionActivity);
});

test('changing month and returning restores the exact saved rows, identities, amounts and activity', () => {
  const saved = editedMonth();
  const september = syncReportingMonthReconciliation({...saved, globalMonth: '09.2026'}, '09.2026');
  assert.equal(september.BankExport.data[0]['Tháng báo cáo'], '09.2026');
  const returned = syncReportingMonthReconciliation({...september, globalMonth: '08.2026'}, '08.2026');
  assert.deepEqual(returned.BankExport.data, saved.BankExport.data);
  assert.deepEqual(returned.TransactionActivity, saved.TransactionActivity);
});

test('an intentionally emptied Transaction month does not restore deleted rows when revisited', () => {
  const saved = editedMonth();
  const emptied = {...saved, BankExport: {...saved.BankExport, data: []}};
  const september = syncReportingMonthReconciliation(emptied, '09.2026');
  const returned = syncReportingMonthReconciliation(september, '08.2026');
  assert.deepEqual(returned.BankExport.data, []);
});

test('a month without Bank AE source cannot display the previous month and preserves it on return', () => {
  const saved = editedMonth();
  const october = syncReportingMonthReconciliation(saved, '10.2026');
  assert.equal(october.globalMonth, '10.2026');
  assert.deepEqual(october.BankExport.data, []);
  assert.deepEqual(syncReportingMonthReconciliation(october, '08.2026').BankExport.data, saved.BankExport.data);
});

test('explicit Transaction and Master clears discard retained month snapshots', () => {
  const saved = syncReportingMonthReconciliation(editedMonth(), '09.2026');
  assert.equal(clearMasterTableData(saved, 'BankExport').TransactionMonthCache, undefined);
  assert.equal(clearMasterPageData(saved).TransactionMonthCache, undefined);
});

test('an untouched generated month can still refresh from updated Bank AE source', () => {
  const app = structuredClone(INITIAL_APP_DATA);
  app.Bank_North_AE.data = [{'Tháng báo cáo': '08.2026', 'Bank Account Number': '0012345678', 'TOTAL PAYMENT': 100_000}];
  const generated = syncReportingMonthReconciliation(app, '08.2026');
  generated.Bank_North_AE.data = [{'Tháng báo cáo': '08.2026', 'Bank Account Number': '0099887766', 'TOTAL PAYMENT': 120_000}];
  const refreshed = syncReportingMonthReconciliation(generated, '08.2026');
  assert.equal(refreshed.BankExport.data[0]['Beneficiary Account No.'], '0099887766');
  assert.equal(refreshed.BankExport.data[0]['Payment Amount'], 120_000);
});


test('saved local history must match the latest Supabase snapshot before Check STK & ID', () => {
  const saved = editedMonth();
  const september = syncReportingMonthReconciliation({...saved, globalMonth: '09.2026'}, '09.2026');
  const localHistory = getSavedLocalTransactionSnapshots(september, '09.2026');
  assert.deepEqual(localHistory.map(snapshot => snapshot.period), ['2026-08']);

  const staleCloud = localHistory.map(snapshot => ({
    period: `${snapshot.period}-01`,
    rows: snapshot.rows.map(row => ({...row, 'Document ID': 'OLD-CLOUD-ID'})),
  }));
  assert.deepEqual(
    findMismatchedTransactionHistoryPeriods(localHistory, staleCloud, '09.2026'),
    ['2026-08'],
  );
  assert.deepEqual(
    findMismatchedTransactionHistoryPeriods(
      localHistory,
      localHistory.map(snapshot => ({period: `${snapshot.period}-01`, rows: snapshot.rows})),
      '09.2026',
    ),
    [],
  );
});

test('verified history sync updates every matching local month cache and the active Transaction', () => {
  const saved = editedMonth();
  const september = syncReportingMonthReconciliation({...saved, globalMonth: '09.2026'}, '09.2026');
  const august = getSavedLocalTransactionSnapshots(september, '09.2026')[0];
  assert.ok(august);

  const nextAugust = august.rows.map(row => ({...row, 'Document ID': 'SYNCED-AUG-ID'}));
  const nextSeptember = september.BankExport.data.map(row => ({...row, 'Document ID': 'SYNCED-SEP-ID'}));
  const synced = replaceTransactionSnapshotsInAppData(september, [
    {period: '2026-08-01', rows: nextAugust},
    {period: '2026-09-01', rows: nextSeptember},
  ], '2026-09-25T03:00:00.000Z');

  assert.equal(synced.TransactionMonthCache?.months['2026-08'].table.data[0]['Document ID'], 'SYNCED-AUG-ID');
  assert.equal(synced.BankExport.data[0]['Document ID'], 'SYNCED-SEP-ID');
  assert.equal(synced.TransactionActivity?.lastAction, 'saved');
  const returned = syncReportingMonthReconciliation({...synced, globalMonth: '08.2026'}, '08.2026');
  assert.equal(returned.BankExport.data[0]['Document ID'], 'SYNCED-AUG-ID');
});

test('generated Batch Payment is cached immediately for its reporting month', () => {
  const app = structuredClone(INITIAL_APP_DATA);
  app.globalMonth = '08.2026';
  app.BankExport.data = [{
    'Tháng báo cáo': '08.2026',
    'Document ID': 'ID-08',
    'Beneficiary Account No.': '0012345678',
    'Payment Amount': 100_000,
  }];
  app.TransactionActivity = {
    generatedAt: '2026-09-01T00:00:00.000Z',
    editCount: 0,
    saveVersion: 0,
    lastAction: 'generated',
  };

  const cached = cacheActiveTransactionMonth(app);
  assert.equal(cached.TransactionMonthCache?.activePeriod, '2026-08');
  assert.deepEqual(
    cached.TransactionMonthCache?.months['2026-08'].table.data,
    app.BankExport.data,
  );
});

test('cached generated historical Batch Payment survives when Bank North source month is missing', () => {
  const app = structuredClone(INITIAL_APP_DATA);
  app.Bank_North_AE.data = [{
    'Tháng báo cáo': '08.2026',
    'ID Number': 'ID-08',
    'Full name': 'NGUYEN VAN A',
    'Bank Account Number': '0012345678',
    'TOTAL PAYMENT': 100_000,
  }];

  const generated = syncReportingMonthReconciliation(app, '08.2026');
  assert.equal(generated.BankExport.data.length, 1);

  const sourceLost = {
    ...generated,
    Bank_North_AE: { ...generated.Bank_North_AE, data: [] },
  };
  const reopened = syncReportingMonthReconciliation(sourceLost, '08.2026');

  assert.deepEqual(reopened.BankExport.data, generated.BankExport.data);
  assert.deepEqual(
    reopened.TransactionMonthCache?.months['2026-08'].table.data,
    generated.BankExport.data,
  );
});
