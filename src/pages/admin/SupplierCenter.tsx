import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChevronRight,
  LineChart,
  Star,
  TrendingUp,
  Truck,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDate, formatMoney } from "../../lib/utils";
import {
  supplierFinance,
  priceIncreaseAlerts,
  setPreferredSupplier,
} from "../../lib/procurement";
import { useAuthStore } from "../../store/authStore";
import type {
  SupplierPriceHistory,
  SupplierProduct,
} from "../../types";

function Rating({ value }: { value?: number }) {
  const v = value ?? 0;
  return (
    <span className="text-xs font-semibold text-amber-600">
      {v.toFixed(1)} ★
    </span>
  );
}

export function SupplierCenterPage() {
  const user = useAuthStore((s) => s.user);
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const products =
    useLiveQuery(() => pharmaDb.supplierProducts.toArray(), []) ?? [];
  const history =
    useLiveQuery(() => pharmaDb.supplierPriceHistory.toArray(), []) ?? [];
  const performance =
    useLiveQuery(() => pharmaDb.supplierPerformance.toArray(), []) ?? [];
  const invoices =
    useLiveQuery(() => pharmaDb.supplierInvoices.toArray(), []) ?? [];
  const payments =
    useLiveQuery(() => pharmaDb.supplierPayments.toArray(), []) ?? [];
  const returns =
    useLiveQuery(() => pharmaDb.purchaseReturns.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";
  const [detailId, setDetailId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const medicineMap = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );
  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
  );
  const perfMap = useMemo(
    () => new Map(performance.map((p) => [p.supplierId, p])),
    [performance],
  );
  const productsBySupplier = useMemo(() => {
    const map = new Map<string, SupplierProduct[]>();
    for (const p of products) {
      const list = map.get(p.supplierId) ?? [];
      list.push(p);
      map.set(p.supplierId, list);
    }
    return map;
  }, [products]);
  const historyBySupplier = useMemo(() => {
    const map = new Map<string, SupplierPriceHistory[]>();
    for (const h of history) {
      const list = map.get(h.supplierId) ?? [];
      list.push(h);
      map.set(h.supplierId, list);
    }
    return map;
  }, [history]);

  const increaseAlerts = useMemo(() => priceIncreaseAlerts(history), [history]);
  const alertsBySupplier = useMemo(() => {
    const map = new Map<string, typeof increaseAlerts>();
    for (const a of increaseAlerts) {
      const list = map.get(a.supplierId) ?? [];
      list.push(a);
      map.set(a.supplierId, list);
    }
    return map;
  }, [increaseAlerts]);

  const financeFor = (supplierId: string) =>
    supplierFinance(
      invoices.filter((i) => i.supplierId === supplierId),
      payments.filter((p) => p.supplierId === supplierId),
      returns.filter((r) => r.supplierId === supplierId),
    );

  const outstandingTotal = suppliers.reduce(
    (sum, s) => sum + financeFor(s.id).balance,
    0,
  );
  const preferredCount = products.filter((p) => p.isPreferred).length;

  const matrixRows = useMemo(() => {
    const byMedicine = new Map<string, SupplierProduct[]>();
    for (const p of products) {
      const list = byMedicine.get(p.medicineId) ?? [];
      list.push(p);
      byMedicine.set(p.medicineId, list);
    }
    return [...byMedicine.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([medicineId, list]) => ({
        medicineId,
        medicineName: medicineMap.get(medicineId)?.name ?? "Unknown",
        entries: list
          .map((p) => ({
            supplierId: p.supplierId,
            supplierName: supplierMap.get(p.supplierId)?.name ?? "?",
            cost: p.latestUnitCost,
            preferred: p.isPreferred ?? false,
          }))
          .sort((a, b) => a.cost - b.cost),
        best: Math.min(...list.map((p) => p.latestUnitCost)),
      }))
      .sort((a, b) => a.medicineName.localeCompare(b.medicineName));
  }, [products, medicineMap, supplierMap]);

  const detail = detailId
    ? {
        supplier: supplierMap.get(detailId)!,
        perf: perfMap.get(detailId),
        products: productsBySupplier.get(detailId) ?? [],
        history: historyBySupplier.get(detailId) ?? [],
        alerts: alertsBySupplier.get(detailId) ?? [],
        finance: financeFor(detailId),
      }
    : null;

  const togglePreferred = async (
    supplierId: string,
    medicineId: string,
    preferred: boolean,
  ) => {
    if (!user) return;
    try {
      await setPreferredSupplier(supplierId, medicineId, preferred);
      setMsg(preferred ? "Preferred supplier set." : "Preferred supplier removed.");
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to update supplier.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Supplier Center"
        subtitle="Supplier products, price history, performance and balances"
      />

      {msg && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setMsg(null)}>
            {msg}
          </Alert>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Suppliers"
          value={String(suppliers.length)}
          icon={<Truck size={20} />}
        />
        <StatCard
          label="Outstanding Payables"
          value={formatMoney(outstandingTotal, currency)}
          icon={<TrendingUp size={20} />}
          color="text-red-600 bg-red-50"
        />
        <StatCard
          label="Preferred Products"
          value={String(preferredCount)}
          icon={<Star size={20} />}
          color="text-amber-600 bg-amber-50"
        />
      </div>

      {suppliers.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-slate-400">
            No suppliers yet. Add suppliers from the Suppliers page, then receive
            stock to build price history.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => {
            const finance = financeFor(s.id);
            const perf = perfMap.get(s.id);
            const alerts = alertsBySupplier.get(s.id) ?? [];
            const productCount = (productsBySupplier.get(s.id) ?? []).length;
            return (
              <button
                key={s.id}
                onClick={() => setDetailId(s.id)}
                className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-pharma-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.contactPerson ?? "—"} · {s.phone ?? "—"}
                    </p>
                  </div>
                  <ChevronRight size={16} className="mt-1 text-slate-300" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Balance
                    </p>
                    <p
                      className={`mt-0.5 text-sm font-semibold ${
                        finance.balance > 0 ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {formatMoney(finance.balance, currency)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Products
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-800">
                      {productCount}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Rating
                    </p>
                    <Rating value={perf?.rating} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {perf ? (
                    <>
                      <Badge tone={perf.lateDeliveries > 0 ? "amber" : "green"}>
                        {perf.onTimeDeliveries} on-time / {perf.lateDeliveries} late
                      </Badge>
                      {perf.returnsCount > 0 && (
                        <Badge tone="red">{perf.returnsCount} returns</Badge>
                      )}
                    </>
                  ) : (
                    <Badge>No deliveries yet</Badge>
                  )}
                  {alerts.length > 0 && (
                    <Badge tone="amber">
                      {alerts.length} price increase{alerts.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {matrixRows.length > 0 && (
        <Card
          title="Price Comparison"
          subtitle="Best unit cost across suppliers per medicine"
          className="mt-6"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Suppliers (cheapest first)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrixRows.map((row) => (
                  <tr key={row.medicineId} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {row.medicineName}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.entries.map((e) => (
                          <span
                            key={e.supplierId}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ${
                              e.cost === row.best
                                ? "bg-emerald-50 font-semibold text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {e.supplierName}: {formatMoney(e.cost, currency)}
                            {e.preferred && <Star size={11} className="text-amber-500" />}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detail && (
        <Modal
          title={detail.supplier.name}
          subtitle="Supplier performance and product history"
          onClose={() => setDetailId(null)}
          size="lg"
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Balance
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {formatMoney(detail.finance.balance, currency)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Invoiced
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {formatMoney(detail.finance.invoiced, currency)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Paid
                </p>
                <p className="mt-1 text-sm font-semibold text-emerald-600">
                  {formatMoney(detail.finance.paid, currency)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-400">
                  Credits
                </p>
                <p className="mt-1 text-sm font-semibold text-red-600">
                  {formatMoney(detail.finance.credited, currency)}
                </p>
              </div>
            </div>

            {detail.perf && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Rating value={detail.perf.rating} />
                <Badge tone={detail.perf.lateDeliveries > 0 ? "amber" : "green"}>
                  {detail.perf.onTimeDeliveries} on-time / {detail.perf.lateDeliveries} late
                </Badge>
                <Badge tone={detail.perf.returnsCount > 0 ? "red" : "slate"}>
                  {detail.perf.returnsCount} returns
                </Badge>
                {detail.perf.lastOrderAt && (
                  <span className="text-xs text-slate-400">
                    Last order {formatDate(detail.perf.lastOrderAt)}
                  </span>
                )}
              </div>
            )}

            {detail.alerts.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-700">
                  <TrendingUp size={15} />
                  Price increases detected
                </p>
                <div className="space-y-1">
                  {detail.alerts.map((a) => (
                    <p key={`${a.medicineId}`} className="text-xs text-slate-600">
                      {medicineMap.get(a.medicineId)?.name}:{" "}
                      <span className="text-red-600">
                        {formatMoney(a.toPrice, currency)}
                      </span>{" "}
                      (was {formatMoney(a.fromPrice, currency)}, +{a.pct}%)
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <LineChart size={15} />
                Products supplied
              </p>
              {detail.products.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No purchase history yet — receive goods from this supplier to
                  populate it.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {detail.products
                    .sort((a, b) => a.medicineId.localeCompare(b.medicineId))
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm text-slate-800">
                            {medicineMap.get(p.medicineId)?.name ?? "Unknown"}
                          </p>
                          <p className="text-xs text-slate-400">
                            Latest cost:{" "}
                            {formatMoney(p.latestUnitCost, currency)}
                            {p.leadTimeDays ? ` · lead ${p.leadTimeDays}d` : ""}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            togglePreferred(detail.supplier.id, p.medicineId, !(p.isPreferred ?? false))
                          }
                          className={`rounded-lg p-1.5 ${
                            p.isPreferred
                              ? "text-amber-500"
                              : "text-slate-300 hover:text-amber-400"
                          }`}
                          title={p.isPreferred ? "Remove preferred" : "Mark preferred"}
                        >
                          <Star size={16} fill={p.isPreferred ? "currentColor" : "none"} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {detail.history.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Price history</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-medium">Medicine</th>
                        <th className="px-3 py-2 font-medium">Price</th>
                        <th className="px-3 py-2 font-medium">Effective</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...detail.history]
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((h) => (
                          <tr key={h.id}>
                            <td className="px-3 py-2 text-slate-700">
                              {medicineMap.get(h.medicineId)?.name ?? "Unknown"}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {formatMoney(h.price, currency)}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {formatDate(h.effectiveFrom)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
