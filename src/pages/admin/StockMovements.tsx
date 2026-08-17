import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDateTime } from "../../lib/utils";

const MOVEMENT_TONES: Record<string, "green" | "red" | "amber" | "blue" | "slate"> = {
  PURCHASE: "green",
  SALE: "blue",
  RETURN: "amber",
  ADJUSTMENT: "slate",
  DAMAGE: "red",
  EXPIRY: "red",
  TRANSFER: "slate",
};

export function StockMovementsPage() {
  const movements =
    useLiveQuery(
      () =>
        pharmaDb.stockMovements
          .orderBy("createdAt")
          .reverse()
          .limit(500)
          .toArray(),
      [],
    ) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const users = useLiveQuery(() => pharmaDb.users.toArray(), []) ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  const types = Array.from(new Set(movements.map((m) => m.movementType))).sort();

  const filtered = movements.filter((mv) => {
    const m = medicineMap.get(mv.medicineId);
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (m?.name ?? "").toLowerCase().includes(q) ||
      (mv.reason ?? "").toLowerCase().includes(q);
    const matchesType = typeFilter === "ALL" || mv.movementType === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div>
      <PageHeader
        title="Stock Movements"
        subtitle="Complete inventory history / audit trail"
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search by medicine or reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="ALL">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No stock movements yet. Receive stock or make adjustments to build
            your history.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((mv) => {
                  const qty = mv.quantity;
                  return (
                    <tr key={mv.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 text-slate-500">
                        {formatDateTime(mv.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={MOVEMENT_TONES[mv.movementType] ?? "slate"}>
                          {mv.movementType}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {medicineMap.get(mv.medicineId)?.name ?? "Unknown"}
                      </td>
                      <td
                        className={`px-3 py-3 font-semibold ${
                          qty > 0 ? "text-pharma-700" : "text-red-600"
                        }`}
                      >
                        {qty > 0 ? `+${qty}` : qty}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {mv.reason ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {mv.performedBy
                          ? userMap.get(mv.performedBy)?.fullName ?? "—"
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
