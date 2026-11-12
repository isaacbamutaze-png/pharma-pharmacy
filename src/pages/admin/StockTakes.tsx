import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Plus, Send, XCircle } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { pharmaDb } from "../../db";
import { useAuthStore } from "../../store/authStore";
import { formatDateTime } from "../../lib/utils";
import { formatISO } from "../../lib/stock";
import {
  approveStockTake,
  createStockTake,
  rejectStockTake,
  saveCount,
  submitStockTake,
  takeProgress,
} from "../../lib/stockTake";
import type { StockTake, StockTakeStatus } from "../../types";

const REASONS = ["Counting error", "Damaged", "Expired", "Lost", "Theft", "Supplier shortage", "Other"];

const TONE: Record<StockTakeStatus, "blue" | "amber" | "green" | "red"> = {
  COUNTING: "blue",
  SUBMITTED: "amber",
  APPROVED: "green",
  REJECTED: "red",
};

export function StockTakesPage() {
  const user = useAuthStore((s) => s.user);
  const takes = useLiveQuery(() => pharmaDb.stockTakes.orderBy("createdAt").reverse().toArray(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const start = async () => {
    setError(null);
    try {
      const t = await createStockTake(user?.id ?? "system", note);
      setNote("");
      setOpenId(t.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the stock take.");
    }
  };

  if (openId) {
    return <TakeDetail takeId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div>
      <PageHeader
        title="Stock Taking"
        subtitle="Count the shelves, compare with the system, and approve the differences. Nothing changes until an admin approves."
      />
      <Card title="Start a new stock take" subtitle="Takes a snapshot of every batch currently in stock (controlled drugs are counted in their own register).">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly count, shelf A-C" />
          </div>
          <Button onClick={start}>
            <Plus size={16} />
            Start stock take
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      <Card title="History" className="mt-4">
        <div className="divide-y divide-slate-100">
          {(takes ?? []).map((t: StockTake) => (
            <button
              key={t.id}
              onClick={() => setOpenId(t.id)}
              className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-slate-50"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {t.takeNumber}
                  {t.note && <span className="ml-2 font-normal text-slate-500">{t.note}</span>}
                </p>
                <p className="text-xs text-slate-500">Started {formatDateTime(t.createdAt)}</p>
              </div>
              <Badge tone={TONE[t.status]}>{t.status}</Badge>
            </button>
          ))}
          {takes && takes.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No stock takes yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function TakeDetail({ takeId, onBack }: { takeId: string; onBack: () => void }) {
  const user = useAuthStore((s) => s.user);
  const take = useLiveQuery(() => pharmaDb.stockTakes.get(takeId), [takeId]);
  const items = useLiveQuery(
    () => pharmaDb.stockTakeItems.where("stockTakeId").equals(takeId).toArray(),
    [takeId],
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);

  if (!take || !items) return <p className="text-sm text-slate-500">Loading...</p>;

  const p = takeProgress(items);
  const editable = take.status === "COUNTING";
  const needle = filter.trim().toLowerCase();
  const rows = items.filter(
    (i) =>
      (!needle || `${i.medicineName} ${i.batchNumber}`.toLowerCase().includes(needle)) &&
      (!onlyUncounted || i.physicalQty === undefined),
  );

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (ok) setInfo(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div>
      <PageHeader
        title={`Stock take ${take.takeNumber}`}
        subtitle={take.note}
        actions={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={TONE[take.status]}>{take.status}</Badge>
            <span>{p.counted} of {p.total} counted</span>
            <span className={p.withVariance ? "font-semibold text-amber-700" : "text-slate-500"}>
              {p.withVariance} difference{p.withVariance === 1 ? "" : "s"} (net {p.netVariance > 0 ? "+" : ""}{p.netVariance} units)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button onClick={() => run(() => submitStockTake(takeId), "Submitted for approval.")}>
                <Send size={16} />
                Submit for approval
              </Button>
            )}
            {take.status === "SUBMITTED" && (
              <>
                <Button
                  onClick={() => {
                    if (!window.confirm(`Apply ${p.withVariance} stock adjustment(s)? This changes stock quantities.`)) return;
                    void run(async () => {
                      const r = await approveStockTake(takeId, user?.id ?? "system");
                      setInfo(`Approved. ${r.adjusted} adjustment(s) applied.`);
                    });
                  }}
                >
                  <CheckCircle2 size={16} />
                  Approve & apply
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const why = window.prompt("Reason for rejecting this count?");
                    if (why === null) return;
                    void run(() => rejectStockTake(takeId, user?.id ?? "system", why), "Rejected. No stock was changed.");
                  }}
                >
                  <XCircle size={16} />
                  Reject
                </Button>
              </>
            )}
            {editable && (
              <Button
                variant="outline"
                onClick={() => {
                  if (!window.confirm("Cancel this stock take? Counts will be discarded and no stock changes.")) return;
                  void run(async () => {
                    await rejectStockTake(takeId, user?.id ?? "system", "Cancelled");
                    onBack();
                  });
                }}
              >
                Cancel take
              </Button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {info && <p className="mt-3 text-sm text-emerald-700">{info}</p>}
        {take.rejectedReason && <p className="mt-3 text-sm text-slate-600">Reason: {take.rejectedReason}</p>}
      </Card>

      <Card className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <TextInput placeholder="Search medicine or batch..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} />
            Only not yet counted
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Medicine / batch</th>
                <th className="px-3 py-2">Expiry</th>
                <th className="px-3 py-2 text-right">System</th>
                <th className="px-3 py-2">Counted</th>
                <th className="px-3 py-2 text-right">Diff</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b border-slate-50">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">{i.medicineName}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{i.batchNumber}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatISO(i.expiryDate)}</td>
                  <td className="px-3 py-2 text-right">{i.systemQty}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        defaultValue={i.physicalQty ?? ""}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          void run(() => saveCount(i.id, v === "" ? undefined : Number(v), i.reason));
                        }}
                      />
                    ) : (
                      (i.physicalQty ?? "-")
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${(i.variance ?? 0) < 0 ? "text-red-600" : (i.variance ?? 0) > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                    {i.variance === undefined ? "" : i.variance > 0 ? `+${i.variance}` : i.variance}
                  </td>
                  <td className="px-3 py-2">
                    {(i.variance ?? 0) !== 0 &&
                      (editable ? (
                        <SelectInput
                          value={i.reason ?? ""}
                          onChange={(e) => void run(() => saveCount(i.id, i.physicalQty, e.target.value))}
                        >
                          <option value="">Choose reason...</option>
                          {REASONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </SelectInput>
                      ) : (
                        i.reason
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
          <ClipboardCheck size={14} /> Differences are applied as the change since the count started, so sales made while counting are not overwritten.
        </p>
      </Card>
    </div>
  );
}
