import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PackagePlus, ScanLine, Search, Settings2, Trash2 } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, uid, now } from "../../lib/utils";
import {
  receiveStock,
  adjustBatch,
  writeOffExpired,
  todayISO,
  formatISO,
  batchDisplayStatus,
  isExpired,
} from "../../lib/stock";
import { useAuthStore } from "../../store/authStore";
import type { MedicineUnit, MovementType } from "../../types";

const MOVEMENT_TYPES: Array<{ value: MovementType; label: string }> = [
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "DAMAGE", label: "Damaged Stock" },
  { value: "EXPIRY", label: "Expired Stock" },
];

interface ReceiveForm {
  medicineId: string;
  supplierId: string;
  batchNumber: string;
  serialNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  unitId: string;
  quantity: string;
  purchasePrice: string;
  sellingPrice: string;
}

interface AdjustForm {
  type: MovementType;
  quantity: string;
  direction: "ADD" | "REMOVE";
  reason: string;
}

export function BatchesPage() {
  const user = useAuthStore((s) => s.user);
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const units = useLiveQuery(() => pharmaDb.medicineUnits.toArray(), []) ?? [];
  const barcodes =
    useLiveQuery(() => pharmaDb.medicineBarcodes.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ?? "60",
  );
  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [search, setSearch] = useState("");
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustBatchId, setAdjustBatchId] = useState<string | null>(null);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
    medicineId: "",
    supplierId: "",
    batchNumber: "",
    serialNumber: "",
    manufacturingDate: "",
    expiryDate: "",
    unitId: "",
    quantity: "",
    purchasePrice: "",
    sellingPrice: "",
  });
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({
    type: "ADJUSTMENT",
    quantity: "",
    direction: "REMOVE",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scan, setScan] = useState("");

  const barcodeToMedicine = useMemo(() => {
    const map = new Map<string, { medicineId: string; unitId?: string }>();
    for (const b of barcodes) {
      map.set(b.barcode, { medicineId: b.medicineId, unitId: b.unitId });
    }
    return map;
  }, [barcodes]);

  const handleScan = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const hit = barcodeToMedicine.get(trimmed);
    if (!hit) {
      setError(`Barcode "${trimmed}" is not linked to any medicine.`);
      setScan("");
      return;
    }
    const m = medicineMap.get(hit.medicineId);
    const unit = hit.unitId
      ? unitById(hit.medicineId, hit.unitId)
      : defaultUnit(hit.medicineId);
    setReceiveForm({
      ...receiveForm,
      medicineId: hit.medicineId,
      unitId: unit?.id ?? "",
      sellingPrice: unit
        ? String(unit.sellingPrice)
        : m
          ? String(m.sellingPrice)
          : receiveForm.sellingPrice,
    });
    setScan("");
    setError(null);
  };

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const unitsByMedicine = useMemo(
    () => {
      const map = new Map<string, MedicineUnit[]>();
      for (const u of units) {
        const list = map.get(u.medicineId) ?? [];
        list.push(u);
        map.set(u.medicineId, list);
      }
      for (const list of map.values()) {
        list.sort((a, b) => a.sortOrder - b.sortOrder);
      }
      return map;
    },
    [units],
  );

  const unitsFor = (medicineId: string): MedicineUnit[] =>
    unitsByMedicine.get(medicineId) ?? [];
  const unitById = (medicineId: string, unitId: string): MedicineUnit | undefined =>
    unitsFor(medicineId).find((u) => u.id === unitId);
  const defaultUnit = (medicineId: string): MedicineUnit | undefined =>
    unitsFor(medicineId).find((u) => u.isDefault) ??
    unitsFor(medicineId).find((u) => u.isBase) ??
    unitsFor(medicineId)[0];

  const sortedBatches = [...batches].sort((a, b) =>
    a.expiryDate.localeCompare(b.expiryDate),
  );

  const filtered = sortedBatches.filter((b) => {
    const m = medicineMap.get(b.medicineId);
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (m?.name ?? "").toLowerCase().includes(q) ||
      b.batchNumber.toLowerCase().includes(q) ||
      b.expiryDate.includes(q)
    );
  });

  const expiredCount = batches.filter(isExpired).length;
  const expiringCount = batches.filter(
    (b) => batchDisplayStatus(b, warningDays) === "EXPIRING",
  ).length;

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const openReceive = () => {
    clearMessages();
    const first = medicines[0];
    const firstUnit = first ? defaultUnit(first.id) : undefined;
    setReceiveForm({
      medicineId: first?.id ?? "",
      supplierId: "",
      batchNumber: "",
      serialNumber: "",
      manufacturingDate: "",
      expiryDate: "",
      unitId: firstUnit?.id ?? "",
      quantity: "",
      purchasePrice: "",
      sellingPrice: firstUnit ? String(firstUnit.sellingPrice) : first ? String(first.sellingPrice) : "",
    });
    setShowReceive(true);
  };

  const openAdjust = (batchId: string) => {
    clearMessages();
    setAdjustBatchId(batchId);
    setAdjustForm({
      type: "ADJUSTMENT",
      quantity: "",
      direction: "REMOVE",
      reason: "",
    });
    setShowAdjust(true);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();

    if (!receiveForm.medicineId) {
      setError("Please select a medicine.");
      return;
    }
    if (!receiveForm.batchNumber.trim()) {
      setError("Batch number is required.");
      return;
    }
    if (!receiveForm.expiryDate) {
      setError("Expiry date is required.");
      return;
    }
    if (receiveForm.expiryDate < todayISO()) {
      setError("Expiry date cannot be in the past.");
      return;
    }
    const quantity = Number(receiveForm.quantity);
    const purchasePrice = Number(receiveForm.purchasePrice);
    const sellingPrice = Number(receiveForm.sellingPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      setError("Purchase price must be 0 or greater.");
      return;
    }
    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      setError("Selling price must be greater than 0.");
      return;
    }

    const unit = unitById(
      receiveForm.medicineId,
      receiveForm.unitId || defaultUnit(receiveForm.medicineId)?.id || "",
    );

    try {
      await receiveStock({
        medicineId: receiveForm.medicineId,
        supplierId: receiveForm.supplierId || undefined,
        batchNumber: receiveForm.batchNumber.trim(),
        serialNumber: receiveForm.serialNumber.trim() || undefined,
        manufacturingDate: receiveForm.manufacturingDate || undefined,
        expiryDate: receiveForm.expiryDate,
        quantity,
        purchasePrice,
        sellingPrice,
        unitId: unit?.id,
        unitName: unit?.unitName,
        unitConversion: unit?.conversionToBase,
        performedBy: user.id,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "RECEIVE_STOCK",
        entityType: "medicine_batch",
        newValues: { medicineId: receiveForm.medicineId, batchNumber: receiveForm.batchNumber, quantity, unitName: unit?.unitName ?? "base" },
        createdAt: now(),
      });
      setShowReceive(false);
      setSuccess(`Stock received for ${medicineMap.get(receiveForm.medicineId)?.name ?? "medicine"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive stock.");
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !adjustBatchId) return;
    clearMessages();

    const batch = batches.find((b) => b.id === adjustBatchId);
    if (!batch) return;

    const quantity = Number(adjustForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    if (adjustForm.type === "ADJUSTMENT" && !adjustForm.reason.trim()) {
      setError("A reason is required for adjustments.");
      return;
    }

    try {
      await adjustBatch(
        batch,
        adjustForm.type,
        quantity,
        adjustForm.type === "ADJUSTMENT" ? adjustForm.direction : "REMOVE",
        user.id,
        adjustForm.type === "EXPIRY"
          ? `Expired on ${batch.expiryDate}`
          : adjustForm.reason.trim(),
        batch.unitConversion,
      );
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "STOCK_ADJUST",
        entityType: "medicine_batch",
        entityId: batch.id,
        oldValues: { quantityRemaining: batch.quantityRemaining },
        newValues: { quantity, type: adjustForm.type, direction: adjustForm.type === "ADJUSTMENT" ? adjustForm.direction : "REMOVE" },
        createdAt: now(),
      });
      setShowAdjust(false);
      setSuccess("Stock adjusted successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adjust stock.");
    }
  };

  const handleWriteOff = async () => {
    if (!user) return;
    if (!window.confirm(`Write off all expired batches (${expiredCount}) from inventory?`)) return;
    clearMessages();
    const count = await writeOffExpired(user.id);
    setSuccess(`${count} expired batch(es) written off.`);
  };

  const adjustBatchObj = batches.find((b) => b.id === adjustBatchId);

  return (
    <div>
      <PageHeader
        title="Batches & Stock Receiving"
        subtitle="Batch-level inventory with expiry tracking"
        actions={
          <div className="flex flex-wrap gap-2">
            {expiredCount > 0 && (
              <Button variant="danger" onClick={handleWriteOff}>
                <Trash2 size={16} />
                Write Off Expired ({expiredCount})
              </Button>
            )}
            <Button onClick={openReceive}>
              <PackagePlus size={16} />
              Receive Stock
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Expired Batches</p>
          <p className="mt-1 text-xl font-bold text-red-600">{expiredCount}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Expiring Soon (≤{warningDays}d)</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{expiringCount}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Total Batches</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{batches.length}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search by medicine, batch number, or expiry..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {batches.length === 0
              ? "No batches yet. Click 'Receive Stock' to add your first batch."
              : "No batches match your search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Expiry</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Remaining</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => {
                  const m = medicineMap.get(b.medicineId);
                  const status = batchDisplayStatus(b, warningDays);
                  const statusBadge =
                    status === "EXPIRED" ? (
                      <Badge tone="red">Expired</Badge>
                    ) : status === "EXPIRING" ? (
                      <Badge tone="amber">Expiring</Badge>
                    ) : status === "DEPLETED" ? (
                      <Badge>Depleted</Badge>
                    ) : (
                      <Badge tone="green">In Stock</Badge>
                    );
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">
                          {m?.name ?? "Unknown"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m?.strength ? `Strength: ${m.strength}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-700">
                        {b.batchNumber}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {b.supplierId
                          ? supplierMap.get(b.supplierId)?.name ?? "—"
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            b.expiryDate < todayISO() ? "text-red-600" : ""
                          }
                        >
                          {formatISO(b.expiryDate)}
                        </span>
                        {!isExpired(b) && b.expiryDate >= todayISO() && (
                          <p className="text-[10px] text-slate-400">
                            {Math.max(0, Math.round((new Date(b.expiryDate).getTime() - Date.now()) / 86400000))}d left
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(b.purchasePrice, currency)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(b.sellingPrice, currency)}
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-slate-900">
                          {b.unitConversion
                            ? Math.round((b.quantityRemaining / b.unitConversion) * 10) / 10
                            : b.quantityRemaining}
                        </span>
                        {b.unitName && (
                          <span className="text-xs text-slate-400">
                            {" "}
                            {b.unitName}
                          </span>
                        )}
                        <span className="text-xs text-slate-400">
                          {" "}
                          /{" "}
                          {b.unitConversion
                            ? Math.round((b.quantityReceived / b.unitConversion) * 10) / 10
                            : b.quantityReceived}
                        </span>
                      </td>
                      <td className="px-3 py-3">{statusBadge}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end">
                          {b.quantityRemaining > 0 && b.expiryDate >= todayISO() && (
                            <button
                              onClick={() => openAdjust(b.id)}
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                              aria-label={`Adjust ${b.batchNumber}`}
                              title="Adjust stock"
                            >
                              <Settings2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showReceive && (
        <Modal
          title="Receive Stock"
          subtitle="Create or add to a batch"
          onClose={() => setShowReceive(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowReceive(false)}>
                Cancel
              </Button>
              <Button form="receive-form" type="submit">
                Receive Stock
              </Button>
            </>
          }
        >
          <form id="receive-form" onSubmit={handleReceive} className="space-y-4">
            <div className="flex gap-2 rounded-lg border border-pharma-200 bg-pharma-50 p-2">
              <ScanLine className="mt-2.5 shrink-0 text-pharma-500" size={18} />
              <TextInput
                label="Scan Barcode"
                placeholder="Scan or type a barcode then press Enter..."
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan(scan);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectInput
                label="Medicine *"
                value={receiveForm.medicineId}
                onChange={(e) => {
                  const m = medicineMap.get(e.target.value);
                  const defUnit = defaultUnit(e.target.value);
                  setReceiveForm({
                    ...receiveForm,
                    medicineId: e.target.value,
                    unitId: defUnit?.id ?? "",
                    sellingPrice: defUnit
                      ? String(defUnit.sellingPrice)
                      : m
                        ? String(m.sellingPrice)
                        : receiveForm.sellingPrice,
                  });
                }}
              >
                {medicines
                  .filter((m) => m.status === "ACTIVE")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.strength ? ` (${m.strength})` : ""}
                    </option>
                  ))}
              </SelectInput>
              {receiveForm.medicineId && unitsFor(receiveForm.medicineId).length > 0 && (
                <SelectInput
                  label="Receive Unit *"
                  value={receiveForm.unitId}
                  onChange={(e) => {
                    const u = unitById(receiveForm.medicineId, e.target.value);
                    setReceiveForm({
                      ...receiveForm,
                      unitId: e.target.value,
                      sellingPrice: u ? String(u.sellingPrice) : receiveForm.sellingPrice,
                    });
                  }}
                >
                  {unitsFor(receiveForm.medicineId).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unitName}
                      {u.conversionToBase !== 1
                        ? ` (1 ${u.unitName} = ${u.conversionToBase} base)`
                        : ""}
                    </option>
                  ))}
                </SelectInput>
              )}
              <SelectInput
                label="Supplier"
                value={receiveForm.supplierId}
                onChange={(e) =>
                  setReceiveForm({ ...receiveForm, supplierId: e.target.value })
                }
              >
                <option value="">— None —</option>
                {suppliers
                  .filter((s) => s.status === "ACTIVE")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </SelectInput>
              <TextInput
                label="Batch Number *"
                placeholder="e.g. A001"
                value={receiveForm.batchNumber}
                onChange={(e) =>
                  setReceiveForm({ ...receiveForm, batchNumber: e.target.value })
                }
              />
              <TextInput
                label="Serial Number"
                placeholder="Optional"
                value={receiveForm.serialNumber}
                onChange={(e) =>
                  setReceiveForm({ ...receiveForm, serialNumber: e.target.value })
                }
              />
              <TextInput
                label="Manufacturing Date"
                type="date"
                max={todayISO()}
                value={receiveForm.manufacturingDate}
                onChange={(e) =>
                  setReceiveForm({
                    ...receiveForm,
                    manufacturingDate: e.target.value,
                  })
                }
              />
              <TextInput
                label="Expiry Date *"
                type="date"
                min={todayISO()}
                value={receiveForm.expiryDate}
                onChange={(e) =>
                  setReceiveForm({ ...receiveForm, expiryDate: e.target.value })
                }
              />
              <TextInput
                label="Quantity *"
                type="number"
                min="1"
                placeholder="0"
                value={receiveForm.quantity}
                onChange={(e) =>
                  setReceiveForm({ ...receiveForm, quantity: e.target.value })
                }
              />
              <TextInput
                label="Purchase Price (Cost) *"
                type="number"
                min="0"
                placeholder="0"
                value={receiveForm.purchasePrice}
                onChange={(e) =>
                  setReceiveForm({
                    ...receiveForm,
                    purchasePrice: e.target.value,
                  })
                }
              />
              <TextInput
                label="Selling Price *"
                type="number"
                min="0"
                placeholder="0"
                value={receiveForm.sellingPrice}
                onChange={(e) =>
                  setReceiveForm({
                    ...receiveForm,
                    sellingPrice: e.target.value,
                  })
                }
              />
            </div>
            <p className="text-xs text-slate-500">
              Expiry alert threshold: {warningDays} days. FEFO (first-expiry,
              first-out) applies automatically during sales. Quantities are
              stored in base units regardless of the receive unit chosen.
            </p>
          </form>
        </Modal>
      )}

      {showAdjust && adjustBatchObj && (
        <Modal
          title={`Adjust Batch ${adjustBatchObj.batchNumber}`}
          subtitle={medicineMap.get(adjustBatchObj.medicineId)?.name}
          onClose={() => setShowAdjust(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowAdjust(false)}>
                Cancel
              </Button>
              <Button form="adjust-form" type="submit">
                Apply Adjustment
              </Button>
            </>
          }
        >
          <form id="adjust-form" onSubmit={handleAdjust} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="text-slate-500">Current remaining: </span>
              <span className="font-semibold text-slate-900">
                {adjustBatchObj.unitConversion
                  ? Math.round((adjustBatchObj.quantityRemaining / adjustBatchObj.unitConversion) * 10) / 10
                  : adjustBatchObj.quantityRemaining}
              </span>
              <span className="text-slate-500">
                {" "}
                {adjustBatchObj.unitName ?? "base units"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectInput
                label="Type *"
                value={adjustForm.type}
                onChange={(e) =>
                  setAdjustForm({
                    ...adjustForm,
                    type: e.target.value as MovementType,
                  })
                }
              >
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Quantity *"
                type="number"
                min="1"
                placeholder="0"
                value={adjustForm.quantity}
                onChange={(e) =>
                  setAdjustForm({ ...adjustForm, quantity: e.target.value })
                }
              />
              {adjustForm.type === "ADJUSTMENT" && (
                <SelectInput
                  label="Direction *"
                  value={adjustForm.direction}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      direction: e.target.value as "ADD" | "REMOVE",
                    })
                  }
                >
                  <option value="REMOVE">Remove (stock out)</option>
                  <option value="ADD">Add (stock in)</option>
                </SelectInput>
              )}
            </div>
            <TextInput
              label="Reason"
              placeholder={
                adjustForm.type === "ADJUSTMENT"
                  ? "Required for adjustments"
                  : "Optional"
              }
              value={adjustForm.reason}
              onChange={(e) =>
                setAdjustForm({ ...adjustForm, reason: e.target.value })
              }
            />
            {adjustForm.type === "DAMAGE" && (
              <p className="text-xs text-amber-600">
                Damaged stock will be removed from inventory.
              </p>
            )}
            {adjustForm.type === "EXPIRY" && (
              <p className="text-xs text-red-600">
                Expired stock will be written off and removed from inventory.
              </p>
            )}
            {adjustBatchObj.unitConversion &&
              adjustBatchObj.unitConversion !== 1 && (
                <p className="text-xs text-slate-500">
                  Quantity is entered in {adjustBatchObj.unitName} (1{" "}
                  {adjustBatchObj.unitName} = {adjustBatchObj.unitConversion}{" "}
                  base units).
                </p>
              )}
          </form>
        </Modal>
      )}
    </div>
  );
}
