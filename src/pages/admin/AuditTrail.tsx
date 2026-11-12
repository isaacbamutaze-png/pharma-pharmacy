import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { pharmaDb } from "../../db";
import { formatDateTime } from "../../lib/utils";
import { downloadCsv } from "../../lib/csv";

const PAGE = 100;

function summarize(v?: Record<string, unknown>): string {
  if (!v) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export function AuditTrailPage() {
  const logs = useLiveQuery(
    () => pharmaDb.auditLogs.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const users = useLiveQuery(() => pharmaDb.users.toArray(), []);
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shown, setShown] = useState(PAGE);

  const userName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users ?? []) m.set(u.id, u.fullName || u.username);
    return m;
  }, [users]);

  const entities = useMemo(
    () => [...new Set((logs ?? []).map((l) => l.entityType))].sort(),
    [logs],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : 0;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : Infinity;
    return (logs ?? []).filter((l) => {
      if (entity && l.entityType !== entity) return false;
      if (l.createdAt < fromTs || l.createdAt > toTs) return false;
      if (!needle) return true;
      const hay = `${l.action} ${l.entityType} ${l.entityId ?? ""} ${userName.get(l.userId) ?? l.userId} ${summarize(l.oldValues)} ${summarize(l.newValues)}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [logs, q, entity, from, to, userName]);

  const exportCsv = () =>
    downloadCsv(`PHARMA-audit-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["When", "Who", "Action", "Entity", "Entity ID", "Old value", "New value"],
      ...filtered.map((l) => [
        new Date(l.createdAt).toISOString(),
        userName.get(l.userId) ?? l.userId,
        l.action,
        l.entityType,
        l.entityId,
        summarize(l.oldValues),
        summarize(l.newValues),
      ]),
    ]);

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="Who did what, and when. Stock changes, refunds, overrides, payments and settings."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
            <Download size={16} />
            Export CSV
          </Button>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <TextInput label="Search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="user, action, id, value..." />
          <SelectInput label="Area" value={entity} onChange={(e) => { setEntity(e.target.value); setShown(PAGE); }}>
            <option value="">All</option>
            {entities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </SelectInput>
          <TextInput label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setShown(PAGE); }} />
          <TextInput label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setShown(PAGE); }} />
        </div>
      </Card>

      <Card className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-500">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Area</th>
                <th className="px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((l) => (
                <tr key={l.id} className="border-b border-slate-50 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDateTime(l.createdAt)}</td>
                  <td className="px-3 py-2">{userName.get(l.userId) ?? l.userId}</td>
                  <td className="px-3 py-2"><Badge tone="slate">{l.action}</Badge></td>
                  <td className="px-3 py-2 text-slate-600">
                    {l.entityType}
                    {l.entityId && <span className="block font-mono text-[11px] text-slate-400">{l.entityId.slice(0, 8)}</span>}
                  </td>
                  <td className="max-w-md px-3 py-2 font-mono text-[11px] text-slate-500">
                    {l.oldValues && <div className="truncate" title={summarize(l.oldValues)}>was: {summarize(l.oldValues)}</div>}
                    {l.newValues && <div className="truncate" title={summarize(l.newValues)}>now: {summarize(l.newValues)}</div>}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    {logs ? "No matching activity." : "Loading..."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > shown && (
          <div className="mt-3 text-center">
            <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({filtered.length - shown} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
