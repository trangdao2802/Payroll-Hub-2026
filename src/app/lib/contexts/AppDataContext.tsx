/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, @typescript-eslint/no-unused-vars, react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { DEFAULT_CENTERS } from "../../constants";
import localforage from "localforage";
import { toast } from "sonner";
import { AppData } from "../../types";
import { INITIAL_APP_DATA } from "../../constants/initial-data";
import { trackTableOriginals, type OriginalField } from '../utils/table-originals';
import { parseMoneyToNumber } from "../utils/data-utils";
import { fillMissingHoldBankAccounts } from "../utils/bank-account-resolver";
import { dedupeTimesheetRosterRowsInChunks } from "../utils/timesheet-roster-utils";
import { applyExtraSummerInstructorBonus } from "../utils/gross-pay";
import { normalizeGrossPaySpecialCenters } from "../utils/master-special-centers";
import { reconcileHoldTransactionRows } from "../utils/hold-carryover";
import { createDeductionsRowProjector, getDeductionsHeaders } from "../utils/deductions-view";
import {
  hasRequiredDeductionsFields,
} from "../utils/deductions-row-validation";
import {
  detectAndRecordAppDataChanges,
  recordDataChange,
} from "../utils/data-change-tracker";
import { saveSnapshot } from "../utils/snapshot-manager";
import { createLatestTaskQueue } from "../utils/latest-task-queue";

// Configure localforage
localforage.config({
  name: "PayrollApp",
  storeName: "app_data",
});

const STORAGE_KEY = "PayrollApp_Data";
const STORAGE_META_KEY = `${STORAGE_KEY}:meta`;
const SPLIT_STORAGE_FIELDS = [
  "TableOriginals",
  "Timesheet_Roster",
  "Master_Roster",
  "Q_Staff",
  "Q_Salary_Scale",
  "Q_Cache",
  "Timesheets",
  "Q_CheckTAs",
  "Q_TeacherHours",
  "Q_BonusData",
  "Timesheet_RosterEditHistory",
  "TA_Employee_Summary",
  "TA_Center_Summary",
] as const satisfies readonly (keyof AppData)[];

const getSplitStorageKey = (field: keyof AppData) =>
  `${STORAGE_KEY}:data:${field}`;

// ─── Split into 2 contexts to avoid re-rendering data consumers on meta changes ───

interface AppDataCtx {
  appData: AppData;
  isLoading: boolean;
}

interface AppActionsCtx {
  updateAppData: (
    updater: ((prev: AppData) => AppData) | Partial<AppData>,
    saveToHistory?: boolean,
    persistImmediately?: boolean,
    sourceFields?: readonly OriginalField[],
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isSyncing: boolean;
}

const AppDataContext = createContext<AppDataCtx | undefined>(undefined);
const AppActionsContext = createContext<AppActionsCtx | undefined>(undefined);

interface HistoryState {
  past: AppData[];
  present: AppData;
  future: AppData[];
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HistoryState>({
    past: [],
    present: INITIAL_APP_DATA,
    future: [],
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isStorageHydrating, setIsStorageHydrating] = useState(true);
  const [activePathname, setActivePathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  const persistedSplitRefs = useRef(
    new Map<keyof AppData, AppData[keyof AppData]>(),
  );
  const immediatePersistRequestedRef = useRef(false);
  const persistenceQueueRef = useRef(createLatestTaskQueue());
  const lastAutoSnapshotTimeRef = useRef<number>(0);

  useEffect(() => {
    const syncActivePathname = () => setActivePathname(window.location.pathname);
    window.addEventListener("app-route-changed", syncActivePathname);
    window.addEventListener("popstate", syncActivePathname);
    return () => {
      window.removeEventListener("app-route-changed", syncActivePathname);
      window.removeEventListener("popstate", syncActivePathname);
    };
  }, []);

  const needsHoldDerivedData =
    activePathname.startsWith("/master-ae") ||
    activePathname.startsWith("/hold-dashboard") ||
    activePathname.startsWith("/payment") ||
    activePathname.startsWith("/pivot");

  // ── Load from storage on mount ──
  useEffect(() => {
    const loadData = async () => {
      try {
        // The shell must remain interactive even when IndexedDB contains a very
        // large Timesheet snapshot. Release the global blocking loader first;
        // storage hydration continues safely in the background.
        setIsLoading(false);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

        const hydratedSplitFields = new Set<keyof AppData>();
        const savedMetadata =
          await localforage.getItem<Partial<AppData>>(STORAGE_META_KEY);
        let saved: AppData | null = null;

        // The old monolithic snapshot can contain hundreds of thousands of
        // rows. Reading it before the split metadata duplicates all large
        // collections during F5 and can block the page on the loading screen.
        // Prefer the lightweight metadata snapshot and touch the legacy value
        // only for a one-time migration.
        if (!savedMetadata) {
          saved = await localforage.getItem<AppData>(STORAGE_KEY);
          if (!saved) {
            const legacySaved = localStorage.getItem(STORAGE_KEY);
            if (legacySaved) {
              try {
                saved = JSON.parse(legacySaved);
              } catch (e) {
                console.error("Failed to parse legacy data", e);
              }
            }
          }
        }

        if (saved || savedMetadata) {
          saved = {
            ...INITIAL_APP_DATA,
            ...(saved || {}),
            ...(savedMetadata || {}),
          } as AppData;

          const splitValues: Array<AppData[keyof AppData] | null> = [];
          for (const field of SPLIT_STORAGE_FIELDS) {
            splitValues.push(
              await localforage.getItem<AppData[typeof field]>(
                getSplitStorageKey(field),
              ),
            );
            // Do not deserialize every large IndexedDB value concurrently.
            // Yield between tables so navigation/clicks remain responsive for
            // users with a large persisted Timesheet dataset.
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }

          // Early split-storage releases could write metadata while still
          // keeping the large arrays only in the legacy snapshot. Recover
          // those missing fields once, then the next save migrates them into
          // their dedicated keys and deletes the obsolete full snapshot.
          let legacySplitFallback: AppData | null = null;
          if (
            savedMetadata &&
            splitValues.some((value) => value === null || value === undefined)
          ) {
            legacySplitFallback = await localforage.getItem<AppData>(STORAGE_KEY);
            if (!legacySplitFallback) {
              const localFallback = localStorage.getItem(STORAGE_KEY);
              if (localFallback) {
                try {
                  legacySplitFallback = JSON.parse(localFallback);
                } catch (e) {
                  console.error("Failed to parse split-storage fallback", e);
                }
              }
            }
          }

          SPLIT_STORAGE_FIELDS.forEach((field, index) => {
            const splitValue = splitValues[index];
            if (splitValue !== null && splitValue !== undefined) {
              (saved as any)[field] = splitValue;
              hydratedSplitFields.add(field);
            } else if (legacySplitFallback?.[field] !== undefined) {
              (saved as any)[field] = legacySplitFallback[field];
            }
          });
        }

        if (saved) {
          // Split the legacy shared roster into page-owned namespaces. Older
          // versions let Master and Timesheet overwrite the same Q_Roster
          // array, so migrate once and never read that shared key again.
          const legacySaved = saved as AppData & {
            Q_Roster?: any[];
            Q_RosterFileName?: string;
            Q_RosterEditHistory?: any[];
          };
          const legacyRoster = Array.isArray(legacySaved.Q_Roster)
            ? legacySaved.Q_Roster
            : [];
          const normalizeSourceName = (value: unknown) =>
            String(value || "").trim().toUpperCase();
          const masterSourceNames = new Set(
            (saved.Ae_Global_Inputs || [])
              .flatMap((row: any) => [row?.name, row?.fileName])
              .map(normalizeSourceName)
              .filter(Boolean),
          );
          const timesheetSourceNames = new Set(
            (saved.Timesheet_InputList || [])
              .flatMap((row: any) => [row?.name, row?.fileName])
              .map(normalizeSourceName)
              .filter(Boolean),
          );
          const rowsForSources = (sources: Set<string>) =>
            legacyRoster.filter((row: any) =>
              sources.has(normalizeSourceName(row?._sourceFile)),
            );

          if (!Array.isArray(saved.Master_Roster)) {
            const matchedMasterRows = rowsForSources(masterSourceNames);
            saved.Master_Roster = matchedMasterRows.length > 0
              ? matchedMasterRows
              : masterSourceNames.size > 0
                ? legacyRoster
                : [];
          }
          if (!Array.isArray(saved.Timesheet_Roster)) {
            const matchedTimesheetRows = rowsForSources(timesheetSourceNames);
            const hasTimesheetData =
              (saved.Q_Staff || []).length > 0 ||
              (saved.Q_Salary_Scale || []).length > 0 ||
              timesheetSourceNames.size > 0;
            saved.Timesheet_Roster = matchedTimesheetRows.length > 0
              ? matchedTimesheetRows
              : hasTimesheetData
                ? legacyRoster
                : [];
          }
          if (!saved.Timesheet_RosterFileName && legacySaved.Q_RosterFileName) {
            saved.Timesheet_RosterFileName = legacySaved.Q_RosterFileName;
          }
          if (
            !saved.Timesheet_RosterEditHistory &&
            Array.isArray(legacySaved.Q_RosterEditHistory)
          ) {
            saved.Timesheet_RosterEditHistory =
              legacySaved.Q_RosterEditHistory;
          }
          delete legacySaved.Q_Roster;
          delete legacySaved.Q_RosterFileName;
          delete legacySaved.Q_RosterEditHistory;

          if (Array.isArray(saved.Timesheet_Roster)) {
            const uniqueRoster = await dedupeTimesheetRosterRowsInChunks(
              saved.Timesheet_Roster,
            );
            if (uniqueRoster.length !== saved.Timesheet_Roster.length) {
              saved = { ...saved, Timesheet_Roster: uniqueRoster };
              await localforage.setItem(
                getSplitStorageKey("Timesheet_Roster"),
                uniqueRoster,
              );
            }
          }

          SPLIT_STORAGE_FIELDS.forEach((field) => {
            if (hydratedSplitFields.has(field)) {
              persistedSplitRefs.current.set(field, saved?.[field]);
            } else {
              persistedSplitRefs.current.delete(field);
            }
          });

          // --- MIGRATION FOR HOLD_AE ---
          if (saved.Hold_AE) {
            let h = saved.Hold_AE.headers;
            if (
              h.includes("LOẠI CK") ||
              h.includes("CENTER NOTE") ||
              h.includes("No") ||
              h.includes("STT")
            ) {
              saved.Hold_AE.headers = h
                .filter((x) => x !== "LOẠI CK")
                .map((x) =>
                  x === "CENTER NOTE" ? "Mã ae" : (x === "No" || x === "STT") ? "No." : x,
                );
              h = saved.Hold_AE.headers;
              saved.Hold_AE.data = saved.Hold_AE.data.map((row) => {
                const newRow = { ...row };
                delete newRow["LOẠI CK"];
                if ("CENTER NOTE" in newRow) {
                  newRow["Mã ae"] = newRow["CENTER NOTE"];
                  delete newRow["CENTER NOTE"];
                }
                if ("No" in newRow) {
                  newRow["No."] = newRow["No"];
                  delete newRow["No"];
                }
                if ("STT" in newRow) {
                  newRow["No."] = newRow["STT"];
                  delete newRow["STT"];
                }
                return newRow;
              });
            }

            // Migrate STT/No to No. on all datasets for consistency
            const keysToMigrate: ("Hold_AE" | "Sheet1_AE" | "Bank_North_AE" | "SoSanh_AE")[] = [
              "Hold_AE",
              "Sheet1_AE",
              "Bank_North_AE",
              "SoSanh_AE",
            ];
            const dataForMigration = saved;
            keysToMigrate.forEach((k) => {
              if (dataForMigration[k]) {
                const headers = dataForMigration[k].headers || [];
                if (headers.includes("STT") || headers.includes("No")) {
                  dataForMigration[k].headers = headers.map((x: string) =>
                    x === "STT" || x === "No" ? "No." : x
                  );
                  if (dataForMigration[k].data && Array.isArray(dataForMigration[k].data)) {
                    dataForMigration[k].data = dataForMigration[k].data.map((row: any) => {
                      const newRow = { ...row };
                      if ("STT" in newRow) {
                        newRow["No."] = newRow["STT"];
                        delete newRow["STT"];
                      }
                      if ("No" in newRow) {
                        newRow["No."] = newRow["No"];
                        delete newRow["No"];
                      }
                      return newRow;
                    });
                  }
                }
              }
            });
            const holdRows = saved.Hold_AE.data;
            if (
              Array.isArray(holdRows) &&
              holdRows.some((row: any) => row && !row["Sheet Source"])
            ) {
              saved.Hold_AE = {
                ...saved.Hold_AE,
                data: holdRows.map((row: any) =>
                  row && !row["Sheet Source"]
                    ? { ...row, "Sheet Source": "Unknown" }
                    : row,
                ),
              };
            }

            // Repair legacy duplicates on hydration. A CANCEL/ADD that already
            // resolved a HOLD remains the single canonical transaction, and
            // stale copies in later report months are discarded.
            if (Array.isArray(saved.Hold_AE.data)) {
              saved.Hold_AE = {
                ...saved.Hold_AE,
                data: reconcileHoldTransactionRows(
                  saved.Hold_AE.data.filter(hasRequiredDeductionsFields),
                ),
              };
            }
          }

          // --- MIGRATION FOR BONUS -> GROSS PAY (EXTRA SUMMER INSTRUCTORS) ---
          if (saved.Sheet1_AE) {
            if (!saved.Sheet1_AE.headers.includes("Extra Summer Instructors")) {
              const tpIdx = saved.Sheet1_AE.headers.indexOf("TOTAL PAYMENT");
              if (tpIdx !== -1) {
                saved.Sheet1_AE.headers.splice(tpIdx, 0, "Extra Summer Instructors");
              } else {
                saved.Sheet1_AE.headers.push("Extra Summer Instructors");
              }
            }
          }

          if (saved.Hold_AE && Array.isArray(saved.Hold_AE.data) && saved.Hold_AE.data.length > 0) {
            const remainingHold: any[] = [];
            const sheet1Rows = saved.Sheet1_AE?.data ? [...saved.Sheet1_AE.data] : [];
            const reportingMonth = saved.globalMonth || "03.2026";

            saved.Hold_AE.data.forEach((row: any) => {
              if (!row) return;
              const nv = String(row["Nghiệp vụ"] || "").toUpperCase().trim();
              const ss = String(row["Sheet Source"] || "").toUpperCase().trim();
              const note = String(row["Note"] || row["Ghi chú"] || "").toUpperCase().trim();
              const isBonus = nv === "BONUS" || nv === "B" || nv.includes("BONUS") || nv === "⏩" || nv === "⏯" ||
                              ss.includes("BONUS") || ss.includes("SUMMER INSTRUCTORS") || note.includes("SUMMER BONUS");

              if (isBonus) {
                const bonusAmt = Math.abs(parseMoneyToNumber(row["TOTAL PAYMENT"] || row["Extra Summer Instructors"] || row["BONUS"] || 0));
                if (bonusAmt > 0) {
                  const idVal = String(row["ID Number"] || "").trim();
                  const nameVal = String(row["Full name"] || "").trim();
                  const mVal = String(row["Tháng báo cáo"] || row["_fileMonth"] || reportingMonth).trim();
                  const l07Val = String(row["L07"] || row["Mã ae"] || row["Center"] || "").trim();
                  const buVal = String(row["BU"] || row["Business"] || "").trim();

                  // Check if already in Sheet1_AE
                  const existingIdx = sheet1Rows.findIndex(
                    (s: any) =>
                      String(s["ID Number"] || "").trim().toUpperCase() === idVal.toUpperCase() &&
                      String(s["Tháng báo cáo"] || s["_fileMonth"] || "").trim() === mVal &&
                      String(s["L07"] || "").trim().toUpperCase() === l07Val.toUpperCase()
                  );

                  if (existingIdx !== -1) {
                    sheet1Rows[existingIdx] = applyExtraSummerInstructorBonus(
                      sheet1Rows[existingIdx],
                      bonusAmt,
                    );
                  } else {
                    sheet1Rows.push({
                      "No.": sheet1Rows.length + 1,
                      "Tháng báo cáo": mVal,
                      "L07": l07Val,
                      "Business": buVal,
                      "ID Number": idVal,
                      "Full name": nameVal,
                      "Bank Account Number": row["Bank Account Number"] || "",
                      "Extra Summer Instructors": bonusAmt,
                      "CHARGE TO EXTRA SUMMER INSTRUCTORS": bonusAmt,
                      "TOTAL PAYMENT": bonusAmt,
                      "TÊN FILE": row["TÊN FILE"] || row["Sheet Source"] || "",
                      "Center": row["Mã ae"] || row["Center"] || l07Val,
                      "Note": row["Note"] || "Extra Summer Instructors",
                      _fileMonth: mVal,
                    });
                  }
                }
              } else {
                remainingHold.push(row);
              }
            });

            saved.Hold_AE.data = remainingHold;
            if (saved.Sheet1_AE) {
              saved.Sheet1_AE.data = sheet1Rows;
            }
          }
          // ------------------------------

          // Ensure BankExport and other structures are structurally populated to prevent legacy TypeError crashes
          if (!saved.BankExport) {
            saved.BankExport = { ...INITIAL_APP_DATA.BankExport };
          }
          if (!saved.CustomReport) {
            saved.CustomReport = { ...INITIAL_APP_DATA.CustomReport };
          }

          // Ensure PivotConfig and critical fields are structurally populated to prevent legacy TypeError crashes
          if (!saved.PivotConfig) {
            saved.PivotConfig = { ...INITIAL_APP_DATA.PivotConfig };
          } else {
            saved.PivotConfig = {
              headers: {
                ...INITIAL_APP_DATA.PivotConfig?.headers,
                ...saved.PivotConfig.headers,
              },
              chargeCols: (() => {
                const baseCols = [...(INITIAL_APP_DATA.PivotConfig?.chargeCols || [])];
                const savedCols = saved.PivotConfig.chargeCols && saved.PivotConfig.chargeCols.length > 0
                  ? [...saved.PivotConfig.chargeCols]
                  : [];

                // Reconstruct to maintain correct order and ensure all default columns exist,
                // while preserving user edits (custom label, code) for any column keys that match.
                const finalCols = baseCols.map((baseCol) => {
                  const matchingSaved = savedCols.find((sc: any) => sc.key === baseCol.key);
                  if (matchingSaved) {
                    // Fix any old label mapping where Charge MKT Local was mislabeled as CHARGE OTHER
                    if (matchingSaved.key === "Charge MKT Local" && matchingSaved.label === "CHARGE OTHER") {
                      return { key: "Charge MKT Local", label: "CHARGE MKT LOCAL", code: "E1" };
                    }
                    return matchingSaved;
                  }
                  return baseCol;
                });

                // Also append any extra custom columns that the user inserted manually using "Insert Column"
                savedCols.forEach((sc: any) => {
                  if (!finalCols.some((fc: any) => fc.key === sc.key)) {
                    finalCols.push(sc);
                  }
                });

                return finalCols;
              })(),
            };
          }

          setState((prev) => ({
            ...prev,
            present: {
              ...normalizeGrossPaySpecialCenters(saved as AppData),
            },
          }));
        } else {
          SPLIT_STORAGE_FIELDS.forEach((field) => {
            persistedSplitRefs.current.set(field, INITIAL_APP_DATA[field]);
          });
        }
      } catch (e) {
        console.error("Failed to load app data from storage", e);
        toast.error("Không thể tải dữ liệu đã lưu.");
      } finally {
        setIsStorageHydrating(false);
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // ── Debounced sync to storage (1.5s) ──
  useEffect(() => {
    if (isLoading || isStorageHydrating) return;

    const saveData = async () => {
      setIsSyncing(true);
      try {
        const dataToSave: Partial<AppData> = { ...state.present };
        const stripFileObj = (item: any) => {
          const { fileObj, _file, ...rest } = item;
          return rest;
        };
        if (dataToSave.Timesheet_InputList)
          dataToSave.Timesheet_InputList =
            dataToSave.Timesheet_InputList.map(stripFileObj);
        if (dataToSave.Ae_Global_Inputs)
          dataToSave.Ae_Global_Inputs =
            dataToSave.Ae_Global_Inputs.map(stripFileObj);

        // Persist large collections only when their reference changed. A
        // metadata-only update (tab, date, UI setting, input status) must not
        // structured-clone hundreds of thousands of rows on the main thread.
        for (const field of SPLIT_STORAGE_FIELDS) {
          const value = state.present[field];
          if (persistedSplitRefs.current.get(field) !== value) {
            await localforage.setItem(getSplitStorageKey(field), value);
            persistedSplitRefs.current.set(field, value);
          }
          delete (dataToSave as any)[field];
        }
        await localforage.setItem(STORAGE_META_KEY, dataToSave);

        // The split snapshot is now complete, so retaining the legacy full
        // object only makes every future reload clone the same large data a
        // second time. Remove it after the new snapshot is safely persisted.
        await localforage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.error("Failed to save app data to storage", e);
        try {
          const minimalData = {
            ...state.present,
            TableOriginals: {},
            Q_Staff: [],
            Q_Salary_Scale: [],
            Timesheet_Roster: [],
            Master_Roster: [],
            Q_Cache: [],
            Timesheets: [],
            Q_CheckTAs: [],
            Q_TeacherHours: [],
            Q_BonusData: [],
            Timesheet_RosterEditHistory: [],
            TA_Employee_Summary: { headers: [], data: [] },
            TA_Center_Summary: { headers: [], data: [] },
          };
          const stripFileObj = (item: any) => {
            const { fileObj, _file, ...rest } = item;
            return rest;
          };
          if (minimalData.Timesheet_InputList)
            minimalData.Timesheet_InputList =
              minimalData.Timesheet_InputList.map(stripFileObj);
          if (minimalData.Ae_Global_Inputs)
            minimalData.Ae_Global_Inputs =
              minimalData.Ae_Global_Inputs.map(stripFileObj);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(minimalData));
        } catch (lsError) {
          console.error("LocalStorage also failed", lsError);
          toast.error("Không thể lưu dữ liệu: Bộ nhớ trình duyệt đã đầy.");
        }
      } finally {
        setIsSyncing(false);
      }
    };

    const persistImmediately = immediatePersistRequestedRef.current;
    const id = setTimeout(() => {
      immediatePersistRequestedRef.current = false;
      void persistenceQueueRef.current.enqueue(saveData);
    }, persistImmediately ? 0 : 3000);
    return () => clearTimeout(id);
  }, [state.present, isLoading, isStorageHydrating]);

  // ── Default center seeding ──
  useEffect(() => {
    if (isLoading) return;
    setState((prev) => {
      const nextPresent = { ...prev.present };
      let changed = false;
      if (
        !prev.present.Timesheet_InputList ||
        prev.present.Timesheet_InputList.length === 0
      ) {
        nextPresent.Timesheet_InputList = DEFAULT_CENTERS.map((item, idx) => ({
          ...item,
          id: `ts-default-${idx}`,
          status: "ready",
        }));
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, present: nextPresent };
    });
  }, [isLoading]);

  // ── Actions (stable references — never cause re-render) ──
  const updateAppData = useCallback(
    (
      updater: ((prev: AppData) => AppData) | Partial<AppData>,
      saveToHistory: boolean = true,
      persistImmediately: boolean = false,
      sourceFields: readonly OriginalField[] = [],
    ) => {
      // React may defer or replay a state updater. Request durable storage
      // before setState rather than relying on it having run synchronously.
      // All table edits (history writes) use the immediate persistence path.
      if (persistImmediately || saveToHistory) immediatePersistRequestedRef.current = true;
      let oldPresentForTelemetry: AppData | null = null;
      let nextPresentForTelemetry: AppData | null = null;

      setState((prev) => {
        const updated =
          typeof updater === "function"
            ? (updater as (p: AppData) => AppData)(prev.present)
            : { ...prev.present, ...updater };
        const normalized = updated.Sheet1_AE?.data !== prev.present.Sheet1_AE?.data
          ? normalizeGrossPaySpecialCenters(updated) : updated;
        const nextPresent = trackTableOriginals(prev.present, normalized, saveToHistory, sourceFields);
        if (nextPresent === prev.present) return prev;

        oldPresentForTelemetry = prev.present;
        nextPresentForTelemetry = nextPresent;

        return {
          past: saveToHistory
            ? [...prev.past, prev.present].slice(-3)
            : prev.past,
          present: nextPresent,
          future: saveToHistory ? [] : prev.future,
        };
      });

      if (nextPresentForTelemetry && oldPresentForTelemetry) {
        const nextPresent = nextPresentForTelemetry as AppData;
        const oldPresent = oldPresentForTelemetry as AppData;
        if (persistImmediately) {
          const now = Date.now();
          if (now - lastAutoSnapshotTimeRef.current > 30000) {
            lastAutoSnapshotTimeRef.current = now;
            saveSnapshot(nextPresent, {
              trigger: "import",
              title: "Tự động lưu sau khi nạp / cập nhật dữ liệu",
            }).catch(() => {});
          }
        }
        try {
          // A link/import update is not a user cell edit. Otherwise the audit
          // tracker saves another complete pre-edit snapshot for every center.
          const telemetrySources = !saveToHistory && sourceFields.length === 0 &&
            oldPresent.Timesheet_Roster !== nextPresent.Timesheet_Roster
            ? ["Timesheet_Roster"] : sourceFields;
          detectAndRecordAppDataChanges(oldPresent, nextPresent, telemetrySources);
        } catch {
          // Ignore telemetry errors
        }
      }
    },
    [],
  );

  const undo = useCallback(() => {
    let didUndo = false;
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      didUndo = true;
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
      };
    });
    if (didUndo) {
      try {
        recordDataChange({
          actionType: "restore",
          entity: "Hoàn tác",
          summary: "Hoàn tác thao tác chỉnh sửa (Undo)",
          details: "Khôi phục lại trạng thái dữ liệu trước đó",
        });
      } catch {
        // Ignore
      }
    }
  }, []);

  const redo = useCallback(() => {
    let didRedo = false;
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      didRedo = true;
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: prev.future.slice(1),
      };
    });
    if (didRedo) {
      try {
        recordDataChange({
          actionType: "sync",
          entity: "Làm lại",
          summary: "Làm lại thao tác chỉnh sửa (Redo)",
          details: "Áp dụng lại trạng thái kế tiếp",
        });
      } catch {
        // Ignore
      }
    }
  }, []);

  // ── Memoized context values — only re-create when actual data changes ──
  const { Hold_AE, globalMonth } = state.present;

  // Persist missing Hold AE bank accounts as soon as the matching source data
  // is available. This keeps the lookup result across report-month changes and
  // future uploads where a source file may be omitted.
  useEffect(() => {
    if (isLoading || !needsHoldDerivedData) return;

    setState((prev) => {
      const holdRows = prev.present.Hold_AE?.data || [];
      const { rows, updatedCount } = fillMissingHoldBankAccounts({
        holdRows,
        grossPayRows: prev.present.Sheet1_AE?.data || [],
        transactionRows: [
          ...(prev.present.BankExport?.data || []),
          ...(prev.present.Bank_North_AE?.data || []),
        ],
        reportMonth: prev.present.globalMonth,
      });

      if (updatedCount === 0) return prev;
      return {
        ...prev,
        present: {
          ...prev.present,
          Hold_AE: {
            ...prev.present.Hold_AE,
            data: rows,
          },
        },
      };
    });
  }, [
    isLoading,
    needsHoldDerivedData,
    state.present.Hold_AE?.data,
    state.present.Sheet1_AE?.data,
    state.present.BankExport?.data,
    state.present.Bank_North_AE?.data,
    state.present.globalMonth,
  ]);

  const projectDeductionsRows = useMemo(
    () => createDeductionsRowProjector(globalMonth || "03.2026"),
    [globalMonth],
  );
  const computedHoldHeaders = useMemo(
    () => getDeductionsHeaders(Hold_AE?.headers || []),
    [Hold_AE?.headers],
  );
  const computedHoldAE = useMemo(() => {
    if (!needsHoldDerivedData || !Hold_AE?.data) return Hold_AE;
    return {
      ...Hold_AE,
      headers: computedHoldHeaders,
      data: projectDeductionsRows(Hold_AE.data),
    };
  }, [Hold_AE, computedHoldHeaders, projectDeductionsRows, needsHoldDerivedData]);

  const computedPresent = useMemo(() => {
    if (!state.present.Hold_AE || state.present.Hold_AE === computedHoldAE) {
      return state.present;
    }
    return {
      ...state.present,
      Hold_AE: computedHoldAE,
    };
  }, [state.present, computedHoldAE]);

  const dataValue = useMemo<AppDataCtx>(
    () => ({ appData: computedPresent, isLoading }),
    [computedPresent, isLoading],
  );

  const actionsValue = useMemo<AppActionsCtx>(
    () => ({
      updateAppData,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      isSyncing,
    }),
    [
      updateAppData,
      undo,
      redo,
      state.past.length,
      state.future.length,
      isSyncing,
    ],
  );

  return (
    <AppDataContext.Provider value={dataValue}>
      <AppActionsContext.Provider value={actionsValue}>
        {children}
      </AppActionsContext.Provider>
    </AppDataContext.Provider>
  );
}

// ── Hooks ──

export function useAppData() {
  const dataCtx = useContext(AppDataContext);
  const actionsCtx = useContext(AppActionsContext);
  if (!dataCtx || !actionsCtx)
    throw new Error("useAppData must be used within AppDataProvider");
  // Merge để backward compatible — giữ nguyên API cũ
  return {
    appData: dataCtx.appData,
    isLoading: dataCtx.isLoading,
    updateAppData: actionsCtx.updateAppData,
    undo: actionsCtx.undo,
    redo: actionsCtx.redo,
    canUndo: actionsCtx.canUndo,
    canRedo: actionsCtx.canRedo,
    isSyncing: actionsCtx.isSyncing,
  };
}

/** Chỉ subscribe data — không re-render khi isSyncing/canUndo/canRedo thay đổi */
export function useAppDataOnly() {
  const ctx = useContext(AppDataContext);
  if (!ctx)
    throw new Error("useAppDataOnly must be used within AppDataProvider");
  return ctx;
}

/** Chỉ subscribe actions — không re-render khi data thay đổi */
export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx)
    throw new Error("useAppActions must be used within AppDataProvider");
  return ctx;
}
