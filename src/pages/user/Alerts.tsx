import { useLiveQuery } from "dexie-react-hooks";
import { Bell, Info } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  todayISO,
  addDaysISO,
  formatISO,
  daysUntil,
} from "../../lib/stock";

export function UserAlertsPage() {
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ?? "60",
  );
  const today = todayISO();
  const warningUntil = addDaysISO(warningDays);

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));
  const stockByMedicine = new Map<string, number>();
  for (const b of batches) {
    if (b.quantityRemaining > 0 && b.expiryDate >= today) {
      stockByMedicine.set(
        b.medicineId,
        (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
      );
    }
  }

  const lowStock = medicines
    .filter((m) => m.status === "ACTIVE" && m.reorderLevel > 0)
    .map((m) => ({
      medicine: m,
      qty: stockByMedicine.get(m.id) ?? 0,
    }))
    .filter((r) => r.qty <= r.medicine.reorderLevel);

  const outOfStock = lowStock.filter((r) => r.qty === 0);
  const runningLow = lowStock.filter((r) => r.qty > 0);

  const expiredBatches = batches
    .filter((b) => b.quantityRemaining > 0 && b.expiryDate < today)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const expiringBatches = batches
    .filter(
      (b) =>
        b.quantityRemaining > 0 &&
        b.expiryDate >= today &&
        b.expiryDate <= warningUntil,
    )
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const rxRequired = medicines.filter(
    (m) => m.status === "ACTIVE" && m.prescriptionRequired,
  );

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Stock and expiry notifications"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Out of Stock</p>
          <p className="mt-1 text-xl font-bold text-red-600">
            {outOfStock.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Running Low</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {runningLow.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Expired Batches</p>
          <p className="mt-1 text-xl font-bold text-red-600">
            {expiredBatches.length}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Low Stock Alerts" subtitle="Medicines at or below reorder level">
          {lowStock.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Info size={16} />
              No low-stock alerts right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStock.map(({ medicine, qty }) => (
                <li
                  key={medicine.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {medicine.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      Reorder level: {medicine.reorderLevel}
                    </p>
                  </div>
                  <Badge tone={qty === 0 ? "red" : "amber"}>
                    {qty === 0 ? "Out of Stock" : `${qty} left`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Expiry Alerts"
          subtitle={`Expired and expiring within ${warningDays} days`}
        >
          {expiredBatches.length === 0 && expiringBatches.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Info size={16} />
              No expiry alerts right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {expiredBatches.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {medicineMap.get(b.medicineId)?.name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Batch {b.batchNumber} • {b.quantityRemaining} units
                    </p>
                  </div>
                  <Badge tone="red">Expired {formatISO(b.expiryDate)}</Badge>
                </li>
              ))}
              {expiringBatches.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {medicineMap.get(b.medicineId)?.name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Batch {b.batchNumber} • {b.quantityRemaining} units
                    </p>
                  </div>
                  <Badge tone="amber">
                    {formatISO(b.expiryDate)} ({Math.max(0, daysUntil(b.expiryDate))}d)
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Other Notices" subtitle="Information for staff" className="lg:col-span-2">
          <div className="flex items-center justify-between rounded-lg border border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Bell size={20} className="text-blue-600" />
              </span>
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Prescription-required medicines
                </p>
                <p className="text-xs text-slate-500">
                  Confirm prescription before selling
                </p>
              </div>
            </div>
            <Badge tone="blue">{rxRequired.length}</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}
