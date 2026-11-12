import { pharmaDb } from "../db";
import { getSetting, setSetting } from "./setup";
import { PAYMENTS_SETTING_KEYS } from "./payments/remote";
import { downloadFile } from "./csv";
import { now } from "./utils";

/**
 * Full-database backup / restore. All PHARMA data lives in this device's
 * IndexedDB, so a cleared browser, a lost phone or a reinstall would otherwise
 * mean total data loss. Backups are plain JSON files the owner keeps safe.
 */

export const BACKUP_FORMAT = "PHARMA_BACKUP";
export const LAST_BACKUP_KEY = "last_backup_at";

/** Settings that must never leave the device inside a backup file. */
const EXCLUDED_SETTINGS = new Set<string>([PAYMENTS_SETTING_KEYS.key]);

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  exportedAt: number;
  dbVersion: number;
  tables: Record<string, unknown[]>;
}

export async function createBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const table of pharmaDb.tables) {
    let rows = (await table.toArray()) as unknown[];
    if (table.name === "systemSettings") {
      rows = (rows as Array<{ settingKey: string }>).filter(
        (r) => !EXCLUDED_SETTINGS.has(r.settingKey),
      );
    }
    tables[table.name] = rows;
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    exportedAt: now(),
    dbVersion: pharmaDb.verno,
    tables,
  };
}

export async function downloadBackup(actorId?: string): Promise<{ file: string; rows: number }> {
  const backup = await createBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = `PHARMA-backup-${stamp}.json`;
  downloadFile(file, JSON.stringify(backup), "application/json");
  await setSetting(LAST_BACKUP_KEY, String(backup.exportedAt), actorId);
  const rows = Object.values(backup.tables).reduce((n, t) => n + t.length, 0);
  return { file, rows };
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not a valid PHARMA backup (not readable).");
  }
  const b = data as Partial<BackupFile>;
  if (
    !b ||
    b.format !== BACKUP_FORMAT ||
    typeof b.tables !== "object" ||
    b.tables === null
  ) {
    throw new Error("This file is not a PHARMA backup.");
  }
  if ((b.dbVersion ?? 0) > pharmaDb.verno) {
    throw new Error(
      "This backup was made by a newer version of PHARMA. Update the app first.",
    );
  }
  return b as BackupFile;
}

/**
 * Replaces ALL data on this device with the backup. Runs in one transaction,
 * so a bad file leaves the existing data untouched.
 */
export async function restoreBackup(backup: BackupFile): Promise<{ rows: number }> {
  const known = new Map(pharmaDb.tables.map((t) => [t.name, t] as const));
  const names = Object.keys(backup.tables).filter((n) => known.has(n));
  if (names.length === 0) throw new Error("The backup contains no data.");

  // Keep this device's own payments-server connection.
  const keep = (await pharmaDb.systemSettings.toArray()).filter((r) =>
    EXCLUDED_SETTINGS.has(r.settingKey),
  );

  let rows = 0;
  await pharmaDb.transaction(
    "rw",
    pharmaDb.tables,
    async () => {
      for (const table of pharmaDb.tables) await table.clear();
      for (const name of names) {
        const list = backup.tables[name];
        if (Array.isArray(list) && list.length) {
          await known.get(name)!.bulkAdd(list);
          rows += list.length;
        }
      }
      if (keep.length) await pharmaDb.systemSettings.bulkPut(keep);
    },
  );
  return { rows };
}

export async function getLastBackupAt(): Promise<number | null> {
  const v = await getSetting(LAST_BACKUP_KEY);
  const n = Number(v);
  return v && Number.isFinite(n) ? n : null;
}

/** Ask the browser not to evict our database under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* unsupported */
  }
  return false;
}
