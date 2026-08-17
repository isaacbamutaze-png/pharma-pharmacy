import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import { PackageCheck } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDateTime, formatMoney, uid } from "../../lib/utils";
import { receiveGoods, grnTotal } from "../../lib/procurement";
import { todayISO, formatISO } from "../../lib/stock";
import { useAuthStore } from "../../store/authStore";
import type { MedicineUnit } from "../../types";

interface ReceiveLine {
  key: string;
  poItemId: string;
  medicineId: string;
  medicineName: string;
  unitName?: string;
  unitConversion?: number;
  qtyOrdered: number;
  qtyReceived: number;
  qty: string;
  batch: string;
  expiry: string;
  cost: string;
  sell: string;
}

export function GrnsPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const poParam = searchParams.get("po");

  const grns = useLiveQuery(() => pharmaDb.grns.toArray(), []) ?? [];
  const grnItems = useLiveQuery(() => pharmaDb.grnItems.toArray(), []) ?? [];
  const orders = useLiveQuery(() => pharmaDb.purchaseOrders.toArray(), []) ?? [];
  const orderItems =
    useLiveQuery(() => pharmaDb.purchaseOrderItems.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const units = useLiveQuery(() => pharmaDb.medicineUnits.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [showModal, setShowModal] = useState(false);
  const [poId, setPoId] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving] = useState(false);

  const unitsByMedicine = useMemo(() => {
    const map = new Map<string, MedicineUnit[]>();
    for (const u of units) {
      const list = map.get(u.medicineId) ?? [];
      list.push(u);
      map.set(u.medicineId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [units]);

  const defaultSell = (medicineId: string): number => {
    const unitsFor = unitsByMedicine.get(medicineId) ?? [];
    const def =
      unitsFor.find((u) => u.isDefault) ??
      unitsFor.find((u) => u.isBase) ??
      unitsFor[0];
    if (def) return def.sellingPrice;
    return medicines.find((m) => m.id === medicineId)?.sellingPrice ?? 0;
  };

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, (typeof orderItems)[number][]>();
    for (const it of orderItems) {
      const list = map.get(it.purchaseOrderId) ?? [];
      list.push(it);
      map.set(it.purchaseOrderId, list);
    }
    return map;
  }, [orderItems]);

  const receivableOrders = orders.filter(
    (po) =>
      po.status !== "CANCELLED" &&
      po.status !== "RECEIVED" &&
      (itemsByOrder.get(po.id) ?? []).some(
        (i) => i.qtyReceived < i.qtyOrdered,
      ),
  );

  useEffect(() => {
    if (!showModal) return;
    if (!poId) return;
    const items = itemsByOrder.get(poId) ?? [];
    setLines(
      items
        .filter((i) => i.qtyReceived < i.qtyOrdered)
        .map((i) => ({
          key: uid(),
          poItemId: i.id,
          medicineId: i.medicineId,
          medicineName: i.medicineName,
          unitName: i.unitName,
          unitConversion: i.unitConversion,
          qtyOrdered: i.qtyOrdered,
          qtyReceived: i.qtyReceived,
          qty: String(i.qtyOrdered - i.qtyReceived),
          batch: "",
          expiry: "",
          cost: String(i.unitCost),
          sell: String(defaultSell(i.medicineId)),
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, showModal, itemsByOrder]);

  const openReceive = () => {
    const prefill = poParam && receivableOrders.some((po) => po.id === poParam)
      ? poParam
      : receivableOrders[0]?.id ?? "";
    setPoId(prefill);
    setNote("");
    setError(null);
    setShowModal(true);
  };

  const updateLine = (key: string, patch: Partial<ReceiveLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const handleReceive = async () => {
    if (!user) return;
    setError(null);
    try {
      await receiveGoods({
        poId,
        receivedBy: user.id,
        receivedByName: user.fullName,
        note,
        lines: lines.map((l) => ({
          poItemId: l.poItemId,
          medicineId: l.medicineId,
          batchNumber: l.batch.trim(),
          expiryDate: l.expiry,
          qtyReceived: Number(l.qty),
          sellingPrice: Number(l.sell),
          unitId: undefined,
          unitName: l.unitName,
          unitConversion: l.unitConversion,
          unitCost: Number(l.cost),
        })),
      });
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive goods.");
    }
  };

  const itemsByGrn = useMemo(() => {
    const map = new Map<string, (typeof grnItems)[number][]>();
    for (const it of grnItems) {
      const list = map.get(it.grnId) ?? [];
      list.push(it);
      map.set(it.grnId, list);
    }
    return map;
  }, [grnItems]);

  const sorted = [...grns].sort((a, b) => b.receivedAt - a.receivedAt);
  const today = todayISO();

  return (
    <div>
      <PageHeader
        title="Goods Received Notes"
        subtitle="Stock enters inventory only through a GRN"
        actions={
          <Button onClick={openReceive}>
            <PackageCheck size={16} />
            Receive Goods
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
            No goods received yet. Click 'Receive Goods' to record a delivery.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">GRN</th>
                  <th className="px-3 py-2 font-medium">PO</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Received At</th>
                  <th className="px-3 py-2 font-medium">Lines</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Received By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((grn) => {
                  const items = itemsByGrn.get(grn.id) ?? [];
                  return (
                    <tr key={grn.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">
                        {grn.number}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">
                        {grn.poNumber ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{grn.supplierName}</td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDateTime(grn.receivedAt)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{items.length}</td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {formatMoney(grnTotal(items), currency)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {grn.receivedByName ?? "—"}
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
          title="Receive Goods"
          subtitle="Verify batch numbers and expiry dates for every line"
          onClose={() => setShowModal(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleReceive} disabled={saving || lines.length === 0}>
                <PackageCheck size={14} />
                Confirm Receipt
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <SelectInput
              label="Purchase Order *"
              value={poId}
              onChange={(e) => setPoId(e.target.value)}
            >
              {receivableOrders.map((po) => {
                const items = itemsByOrder.get(po.id) ?? [];
                const received = items.reduce((s, i) => s + i.qtyReceived, 0);
                const ordered = items.reduce((s, i) => s + i.qtyOrdered, 0);
                return (
                  <option key={po.id} value={po.id}>
                    {po.number} — {po.supplierName} ({received}/{ordered} received)
                  </option>
                );
              })}
            </SelectInput>

            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.key}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">
                      {l.medicineName}
                    </p>
                    <Badge tone="blue">
                      {l.qtyReceived}/{l.qtyOrdered} already received
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <TextInput
                      label="Qty Received *"
                      type="number"
                      min="1"
                      max={l.qtyOrdered - l.qtyReceived}
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                    />
                    <TextInput
                      label="Batch Number *"
                      placeholder="e.g. A001"
                      value={l.batch}
                      onChange={(e) => updateLine(l.key, { batch: e.target.value })}
                    />
                    <TextInput
                      label="Expiry Date *"
                      type="date"
                      min={today}
                      value={l.expiry}
                      onChange={(e) => updateLine(l.key, { expiry: e.target.value })}
                    />
                    <TextInput
                      label="Unit Cost *"
                      type="number"
                      min="0"
                      value={l.cost}
                      onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                    />
                    <div className="col-span-2 sm:col-span-4">
                      <TextInput
                        label="Selling Price"
                        type="number"
                        min="0"
                        value={l.sell}
                        onChange={(e) => updateLine(l.key, { sell: e.target.value })}
                      />
                    </div>
                  </div>
                  {l.unitName && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Quantities in {l.unitName}
                      {l.unitConversion && l.unitConversion !== 1
                        ? ` (1 = ${l.unitConversion} base)`
                        : ""}. Expiry must be today or later (FEFO applies).
                    </p>
                  )}
                </div>
              ))}
            </div>

            <TextArea
              label="Note"
              rows={2}
              placeholder="Delivery note, variances..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Receiving creates stock batches and records supplier price history
              automatically. {formatISO(today)} — {lines.length} line(s).
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
