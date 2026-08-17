import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PackageX, Plus, RotateCcw } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDate, formatMoney, uid } from "../../lib/utils";
import { createPurchaseReturn } from "../../lib/procurement";
import { todayISO, formatISO } from "../../lib/stock";
import { useAuthStore } from "../../store/authStore";
import type { MedicineBatch } from "../../types";

interface ReturnLine {
  key: string;
  medicineId: string;
  batchId: string;
  batchNumber: string;
  qty: string;
  cost: string;
  available: number;
}

export function PurchaseReturnsPage() {
  const user = useAuthStore((s) => s.user);
  const returns =
    useLiveQuery(() => pharmaDb.purchaseReturns.toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const grns = useLiveQuery(() => pharmaDb.grns.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches =
    useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [showModal, setShowModal] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving] = useState(false);

  const medicineMap = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );
  const today = todayISO();

  const activeBatches = useMemo(
    () =>
      batches.filter(
        (b) => b.quantityRemaining > 0 && b.expiryDate >= today,
      ),
    [batches, today],
  );

  const batchesForMedicine = (medicineId: string): MedicineBatch[] =>
    activeBatches
      .filter((b) => b.medicineId === medicineId)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const inUnits = (b: MedicineBatch): number =>
    Math.round((b.quantityRemaining / (b.unitConversion ?? 1)) * 10) / 10;

  const addLine = () => {
    const firstMed = medicines[0];
    const firstBatch = firstMed
      ? batchesForMedicine(firstMed.id)[0]
      : undefined;
    setLines((prev) => [
      ...prev,
      {
        key: uid(),
        medicineId: firstMed?.id ?? "",
        batchId: firstBatch?.id ?? "",
        batchNumber: firstBatch?.batchNumber ?? "",
        qty: "1",
        cost: firstBatch ? String(firstBatch.purchasePrice) : "",
        available: firstBatch ? inUnits(firstBatch) : 0,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<ReturnLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const openCreate = () => {
    setSupplierId(suppliers.find((s) => s.status === "ACTIVE")?.id ?? "");
    setGrnId("");
    setReason("");
    setLines([]);
    setError(null);
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!user) return;
    setError(null);
    try {
      await createPurchaseReturn({
        supplierId,
        grnId: grnId || undefined,
        reason,
        lines: lines.map((l) => ({
          medicineId: l.medicineId,
          batchId: l.batchId || undefined,
          batchNumber: l.batchNumber,
          qty: Number(l.qty),
          unitConversion: batches.find((b) => b.id === l.batchId)?.unitConversion,
          unitCost: Number(l.cost),
        })),
        recordedBy: user.id,
        recordedByName: user.fullName,
      });
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create return.");
    }
  };

  const sorted = [...returns].sort((a, b) => b.createdAt - a.createdAt);
  const totalReturned = returns
    .filter((r) => r.status === "COMPLETED")
    .reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <PageHeader
        title="Purchase Returns"
        subtitle="Return stock to suppliers and issue credit notes"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            New Purchase Return
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      <Card>
        {sorted.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No purchase returns yet. Click 'New Purchase Return' to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">GRN</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Credit Note</th>
                  <th className="px-3 py-2 font-medium">Recorded By</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((r) => {
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">
                        {r.number}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{r.supplierName}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">
                        {r.grnNumber ?? "—"}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-3 text-slate-600">
                        {r.reason}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {formatMoney(r.total, currency)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-emerald-700">
                        {r.creditNoteRef ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {r.recordedByName ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDate(r.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showModal && (
        <Modal
          title="New Purchase Return"
          subtitle="Stock is removed and a credit note is issued"
          onClose={() => setShowModal(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                <PackageX size={14} />
                Complete Return
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectInput
                label="Supplier *"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {suppliers
                  .filter((s) => s.status === "ACTIVE")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </SelectInput>
              <SelectInput
                label="Goods Received Note (optional)"
                value={grnId}
                onChange={(e) => setGrnId(e.target.value)}
              >
                <option value="">— None —</option>
                {grns
                  .filter((g) => g.supplierId === supplierId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.number}
                    </option>
                  ))}
              </SelectInput>
            </div>

            <div className="space-y-2">
              {lines.map((l) => {
                const med = medicineMap.get(l.medicineId);
                return (
                  <div
                    key={l.key}
                    className="grid grid-cols-12 items-end gap-2 rounded-lg border border-slate-200 p-2"
                  >
                    <div className="col-span-12 sm:col-span-4">
                      <SelectInput
                        label="Medicine"
                        value={l.medicineId}
                        onChange={(e) => {
                          const first = batchesForMedicine(e.target.value)[0];
                          updateLine(l.key, {
                            medicineId: e.target.value,
                            batchId: first?.id ?? "",
                            batchNumber: first?.batchNumber ?? "",
                            cost: first ? String(first.purchasePrice) : "",
                            available: first ? inUnits(first) : 0,
                          });
                        }}
                      >
                        {medicines
                          .filter((m) => m.status === "ACTIVE")
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </SelectInput>
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <SelectInput
                        label="Batch"
                        value={l.batchId}
                        onChange={(e) => {
                          const b = batches.find((x) => x.id === e.target.value);
                          updateLine(l.key, {
                            batchId: e.target.value,
                            batchNumber: b?.batchNumber ?? "",
                            cost: b ? String(b.purchasePrice) : l.cost,
                            available: b ? inUnits(b) : 0,
                          });
                        }}
                      >
                        {batchesForMedicine(l.medicineId).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.batchNumber} · exp {formatISO(b.expiryDate)} ·{" "}
                            {inUnits(b)} available
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                    <div className="col-span-6 sm:col-span-2">
                      <TextInput
                        label="Qty"
                        type="number"
                        min="1"
                        max={l.available}
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-2">
                      <TextInput
                        label="Unit Cost"
                        type="number"
                        min="0"
                        value={l.cost}
                        onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                      />
                    </div>
                    <div className="col-span-12 flex justify-end sm:col-span-1">
                      <button
                        onClick={() =>
                          setLines((prev) => prev.filter((x) => x.key !== l.key))
                        }
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Remove line"
                      >
                        <RotateCcw size={14} className="rotate-90" />
                      </button>
                    </div>
                    {med && l.available > 0 && (
                      <p className="col-span-12 text-[11px] text-slate-400">
                        {med.name} · available: {l.available} unit(s)
                      </p>
                    )}
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus size={14} />
                Add Line
              </Button>
            </div>

            <TextArea
              label="Reason *"
              rows={2}
              placeholder="Damaged in transit, near expiry, wrong items..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Completed returns remove stock (RETURN movement) and generate a
              credit note that reduces the supplier balance. Total credited so
              far: {formatMoney(totalReturned, currency)}.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
