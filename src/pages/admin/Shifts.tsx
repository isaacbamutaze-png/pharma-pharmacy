import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Play, Wallet } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { pharmaDb } from "../../db";
import { useAuthStore, isAdmin } from "../../store/authStore";
import { formatDateTime, formatMoney } from "../../lib/utils";
import {
  addDrawerMovement,
  closeShift,
  computeShiftFigures,
  openShift,
  type ShiftFigures,
} from "../../lib/shifts";
import type { DrawerMovementType, Shift } from "../../types";

export function ShiftsPage() {
  const user = useAuthStore((s) => s.user);
  const admin = isAdmin(user);
  const shifts = useLiveQuery(() => pharmaDb.shifts.orderBy("openedAt").reverse().toArray(), []);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState("");

  const mine = (shifts ?? []).find((s) => s.cashierId === user?.id && s.status === "OPEN");
  const others = (shifts ?? []).filter((s) => s.id !== mine?.id);
  const visible = admin ? others : others.filter((s) => s.cashierId === user?.id);

  const start = async () => {
    setError(null);
    try {
      await openShift(user?.id ?? "system", user?.fullName ?? "Cashier", Number(opening || 0));
      setOpening("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the shift.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Shifts & Cash Drawer"
        subtitle="Open a shift with your starting cash, log cash going in or out, and count the drawer at the end."
      />

      {mine ? (
        <ActiveShift shift={mine} userId={user?.id ?? "system"} />
      ) : (
        <Card title="Start your shift" subtitle="Count the cash in the drawer and enter it as the opening cash.">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <TextInput label="Opening cash" type="number" min={0} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            </div>
            <Button onClick={start}>
              <Play size={16} />
              Open shift
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Card>
      )}

      <Card title={admin ? "All shifts" : "My shifts"} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Shift</th>
                <th className="px-3 py-2">Cashier</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Closed</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{s.shiftNumber}</td>
                  <td className="px-3 py-2">{s.cashierName}</td>
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(s.openedAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{s.closedAt ? formatDateTime(s.closedAt) : <Badge tone="blue">OPEN</Badge>}</td>
                  <td className="px-3 py-2 text-right">{s.expectedCash === undefined ? "-" : formatMoney(s.expectedCash)}</td>
                  <td className="px-3 py-2 text-right">{s.countedCash === undefined ? "-" : formatMoney(s.countedCash)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${(s.variance ?? 0) < 0 ? "text-red-600" : (s.variance ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {s.variance === undefined ? "" : s.variance === 0 ? "Balanced" : formatMoney(s.variance)}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">No other shifts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ActiveShift({ shift, userId }: { shift: Shift; userId: string }) {
  const [figures, setFigures] = useState<ShiftFigures | null>(null);
  const moves = useLiveQuery(
    () => pharmaDb.cashDrawerMovements.where("shiftId").equals(shift.id).reverse().sortBy("createdAt"),
    [shift.id],
  );
  const salesTick = useLiveQuery(() => pharmaDb.payments.count(), []);
  const [type, setType] = useState<DrawerMovementType>("WITHDRAWAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    void computeShiftFigures(shift).then(setFigures);
  }, [shift, moves?.length, salesTick]);

  const log = async () => {
    setError(null);
    try {
      await addDrawerMovement(shift.id, type, Number(amount), reason, userId);
      setAmount("");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the movement.");
    }
  };

  const close = async () => {
    setError(null);
    try {
      if (counted.trim() === "") throw new Error("Count the drawer and enter the total cash.");
      await closeShift(shift.id, Number(counted), userId, note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close the shift.");
    }
  };

  const expected = figures?.expectedCash ?? 0;
  const diff = counted.trim() === "" ? null : Number(counted) - expected;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card
        title={`Shift ${shift.shiftNumber}`}
        subtitle={`Opened ${formatDateTime(shift.openedAt)}`}
        action={<Badge tone="green">OPEN</Badge>}
      >
        <dl className="space-y-1.5 text-sm">
          <Row label="Opening cash" value={formatMoney(shift.openingCash)} />
          <Row label={`Cash sales (${figures?.salesCount ?? 0})`} value={`+ ${formatMoney(figures?.cashSales ?? 0)}`} />
          <Row label="Cash refunds" value={`- ${formatMoney(figures?.cashRefunds ?? 0)}`} />
          <Row label="Deposits" value={`+ ${formatMoney(figures?.deposits ?? 0)}`} />
          <Row label="Withdrawals" value={`- ${formatMoney(figures?.withdrawals ?? 0)}`} />
          <Row label="Cash expenses" value={`- ${formatMoney(figures?.expenses ?? 0)}`} />
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
            <dt>Expected in drawer</dt>
            <dd>{formatMoney(expected)}</dd>
          </div>
        </dl>
        {figures && Object.keys(figures.otherSales).length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Not in the drawer: {Object.entries(figures.otherSales).map(([m, v]) => `${m.replace("_", " ").toLowerCase()} ${formatMoney(Number(v))}`).join(", ")}
          </p>
        )}
      </Card>

      <Card title="Cash in / out" subtitle="Log every time cash enters or leaves the drawer apart from sales.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectInput label="Type" value={type} onChange={(e) => setType(e.target.value as DrawerMovementType)}>
            <option value="WITHDRAWAL">Withdrawal (to safe / bank)</option>
            <option value="EXPENSE">Cash expense (paid from drawer)</option>
            <option value="DEPOSIT">Deposit (extra float added)</option>
          </SelectInput>
          <TextInput label="Amount" type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="mt-3">
          <TextInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Banked at 2pm, bought cleaning supplies" />
        </div>
        <Button className="mt-3" variant="outline" onClick={log}>
          {type === "DEPOSIT" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
          Record
        </Button>
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600">
          {(moves ?? []).map((m) => (
            <li key={m.id} className="flex justify-between gap-2">
              <span>{formatDateTime(m.createdAt)} · {m.type.toLowerCase()} · {m.reason}</span>
              <span className="font-semibold">{m.type === "DEPOSIT" ? "+" : "-"} {formatMoney(m.amount)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Close shift" subtitle="Count all the cash in the drawer now." className="lg:col-span-2">
        {!closing ? (
          <Button onClick={() => setClosing(true)}>
            <Wallet size={16} />
            Count & close shift
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput label="Cash counted in drawer" type="number" min={0} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
              <TextInput label="Note (required if there is a difference)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {diff !== null && (
              <p className={`text-sm font-semibold ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                {diff === 0 ? "Balanced." : diff < 0 ? `Short by ${formatMoney(-diff)}` : `Over by ${formatMoney(diff)}`}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={close}>
                <Lock size={16} />
                Close shift
              </Button>
              <Button variant="outline" onClick={() => setClosing(false)}>Back</Button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
