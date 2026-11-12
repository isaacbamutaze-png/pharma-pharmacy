import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download, ShieldCheck, Upload } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import {
  downloadBackup,
  getLastBackupAt,
  parseBackup,
  requestPersistentStorage,
  restoreBackup,
} from "../../lib/backup";
import { formatDateTime } from "../../lib/utils";

export function BackupCard({ actorId }: { actorId?: string }) {
  const [last, setLast] = useState<number | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getLastBackupAt().then(setLast);
    void requestPersistentStorage().then(setPersistent);
  }, []);

  const backup = async () => {
    setBusy(true);
    try {
      const r = await downloadBackup(actorId);
      setLast(Date.now());
      setMsg({ ok: true, text: `Backup saved as ${r.file} (${r.rows} records). Keep it somewhere safe, such as Google Drive or a flash disk.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Backup failed." });
    }
    setBusy(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    try {
      const backupFile = parseBackup(await file.text());
      const when = new Date(backupFile.exportedAt).toLocaleString();
      const ok = window.confirm(
        `Restore the backup made on ${when}?\n\nThis REPLACES all current data on this device (sales, stock, patients, users). Download a backup of the current data first if you are unsure.`,
      );
      if (!ok) return;
      setBusy(true);
      const r = await restoreBackup(backupFile);
      setMsg({ ok: true, text: `Restored ${r.rows} records. Reloading...` });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Restore failed." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const stale = !last || Date.now() - last > 7 * 86_400_000;

  return (
    <Card
      title="Backup & Restore"
      subtitle="All data is stored on this device. A backup file protects you from phone loss, a cleared browser or a reinstall."
      className="lg:col-span-2"
      action={
        <Badge tone={stale ? "amber" : "green"}>
          {last ? `Last backup ${formatDateTime(last)}` : "Never backed up"}
        </Badge>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={backup} disabled={busy}>
          <Download size={16} />
          Download backup
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={16} />
          Restore from file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <span className="ml-1 flex items-center gap-1 text-xs text-slate-500">
          {persistent ? (
            <>
              <ShieldCheck size={14} className="text-emerald-600" />
              Storage protected from automatic cleanup
            </>
          ) : (
            <>
              <DatabaseBackup size={14} className="text-amber-600" />
              Browser may clear data under low storage. Back up often.
            </>
          )}
        </span>
      </div>
      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        The file contains patient and sales data and staff password hashes. Treat it as confidential.
        The payments-server key is never included.
      </p>
    </Card>
  );
}
