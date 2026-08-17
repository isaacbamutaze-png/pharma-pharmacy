import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ClipboardList, Plus, Send, Truck, X } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, TextArea, SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, uid } from "../../lib/utils";
import {
  createPurchaseOrder,
  poTotal,
  setPurchaseOrderStatus,
} from "../../lib/procurement";
import {
  MedicineLinesEditor,
  type LineDraft,
} from "../../components/procurement/MedicineLinesEditor";
import { useAuthStore } from "../../store/authStore";
import type { PurchaseOrderStatus } from "../../types";

const STATUS_BADGE: Record<PurchaseOrderStatus, "slate" | "blue" | "green" | "amber" | "red"> = {
  DRAFT: "slate",
  SENT: "blue",
  CONFIRMED: "amber",
  PARTIALLY_RECEIVED: "amber",
  RECEIVED: "green",
  CANCELLED: "red",
};

export function PurchaseOrdersPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prParam = searchParams.get("pr");

  const orders = useLiveQuery(() => pharmaDb.purchaseOrders.toArray(), []) ?? [];
  const orderItems =
    useLiveQuery(() => pharmaDb.purchaseOrderItems.toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const units = useLiveQuery(() => pharmaDb.medicineUnits.toArray(), []) ?? [];
  const requests =
    useLiveQuery(() => pharmaDb.purchaseRequests.toArray(), []) ?? [];
  const requestItems =
    useLiveQuery(() => pharmaDb.purchaseRequestItems.toArray(), []) ?? [];

  const [showModal, setShowModal] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving] = useState(false);

  const unitsByMedicine = useMemo(() => {
    const map = new Map<string, (typeof units)[number][]>();
    for (const u of units) {
      const list = map.get(u.medicineId) ?? [];
      list.push(u);
      map.set(u.medicineId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [units]);

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, (typeof orderItems)[number][]>();
    for (const it of orderItems) {
      const list = map.get(it.purchaseOrderId) ?? [];
      list.push(it);
      map.set(it.purchaseOrderId, list);
    }
    return map;
  }, [orderItems]);

  const requestMap = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);
  const itemsByRequest = useMemo(() => {
    const map = new Map<string, (typeof requestItems)[number][]>();
    for (const it of requestItems) {
      const list = map.get(it.purchaseRequestId) ?? [];
      list.push(it);
      map.set(it.purchaseRequestId, list);
    }
    return map;
  }, [requestItems]);

  useEffect(() => {
    if (!prParam || !showModal) return;
    const items = itemsByRequest.get(prParam) ?? [];
    if (items.length === 0) return;
    setLines(
      items.map((it) => ({
        key: uid(),
        medicineId: it.medicineId,
        unitId: "",
        unitName: it.unitName ?? "",
        unitConversion: it.unitConversion ?? 1,
        qty: String(it.requestedQty),
        cost: "",
      })),
    );
    const pr = requestMap.get(prParam);
    if (pr) setNote(`From purchase request ${pr.number}`);
  }, [prParam, showModal, itemsByRequest, requestMap]);

  const openCreate = () => {
    setSupplierId(suppliers.find((s) => s.status === "ACTIVE")?.id ?? "");
    setExpectedDate("");
    setTerms("");
    setError(null);
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!user) return;
    setError(null);
    try {
      await createPurchaseOrder({
        supplierId,
        lines: lines.map((l) => ({
          medicineId: l.medicineId,
          unitId: l.unitId || undefined,
          unitName: l.unitName || undefined,
          unitConversion: l.unitConversion || undefined,
          qtyOrdered: Number(l.qty),
          unitCost: Number(l.cost ?? 0),
        })),
        purchaseRequestId: prParam || undefined,
        expectedDate: expectedDate || undefined,
        terms,
        note,
        createdBy: user.id,
        createdByName: user.fullName,
      });
      setShowModal(false);
      if (prParam) navigate("/admin/purchase-orders", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order.");
    }
  };

  const act = async (
    id: string,
    status: PurchaseOrderStatus,
    label: string,
  ) => {
    if (!user) return;
    setError(null);
    try {
      await setPurchaseOrderStatus(id, status, user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${label}.`);
    }
  };

  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Orders sent to suppliers for approval and delivery"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            New Purchase Order
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
            No purchase orders yet. Click 'New Purchase Order' to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Expected</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((po) => {
                  const items = itemsByOrder.get(po.id) ?? [];
                  const total = poTotal(items);
                  const ordered = items.reduce((s, i) => s + i.qtyOrdered, 0);
                  const received = items.reduce((s, i) => s + i.qtyReceived, 0);
                  return (
                    <tr key={po.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">
                        {po.number}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{po.supplierName}</td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_BADGE[po.status]}>{po.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {po.expectedDate ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {formatMoney(total, "UGX")}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {received} / {ordered}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {po.status === "DRAFT" && (
                            <>
                              <Button size="sm" onClick={() => act(po.id, "SENT", "send")}>
                                <Send size={13} />
                                Send
                              </Button>
                              <button
                                onClick={() => act(po.id, "CANCELLED", "cancel")}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Cancel order"
                              >
                                <X size={15} />
                              </button>
                            </>
                          )}
                          {po.status === "SENT" && (
                            <Button size="sm" onClick={() => act(po.id, "CONFIRMED", "confirm")}>
                              <Check size={13} />
                              Confirm
                            </Button>
                          )}
                          {(po.status === "DRAFT" ||
                            po.status === "SENT" ||
                            po.status === "CONFIRMED" ||
                            po.status === "PARTIALLY_RECEIVED") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/admin/grns?po=${po.id}`)}
                            >
                              <Truck size={13} />
                              Receive
                            </Button>
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

      {showModal && (
        <Modal
          title="New Purchase Order"
          subtitle={prParam ? "Created from an approved purchase request" : "Order stock from a supplier"}
          onClose={() => setShowModal(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                <ClipboardList size={14} />
                Create Order
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              <TextInput
                label="Expected Delivery"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
              <TextInput
                label="Payment Terms"
                placeholder="e.g. Net 30"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
            <MedicineLinesEditor
              lines={lines}
              onChange={setLines}
              medicines={medicines}
              unitsByMedicine={unitsByMedicine}
              showCost
            />
            <TextArea
              label="Note"
              rows={2}
              placeholder="Delivery instructions, remarks..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
