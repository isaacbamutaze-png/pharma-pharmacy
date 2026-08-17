import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ClipboardList,
  FileText,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDate, uid } from "../../lib/utils";
import {
  createPurchaseRequest,
  setPurchaseRequestStatus,
} from "../../lib/procurement";
import {
  MedicineLinesEditor,
  type LineDraft,
} from "../../components/procurement/MedicineLinesEditor";
import { useAuthStore } from "../../store/authStore";
import type { PurchaseRequestStatus } from "../../types";

const STATUS_BADGE: Record<PurchaseRequestStatus, "slate" | "blue" | "green" | "red" | "amber"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  ORDERED: "blue",
  CANCELLED: "slate",
};

export function PurchaseRequestsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const requests =
    useLiveQuery(() => pharmaDb.purchaseRequests.toArray(), []) ?? [];
  const requestItems =
    useLiveQuery(() => pharmaDb.purchaseRequestItems.toArray(), []) ?? [];
  const medicines =
    useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const units =
    useLiveQuery(() => pharmaDb.medicineUnits.toArray(), []) ?? [];

  const [showModal, setShowModal] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving] = useState(false);

  const unitsByMedicine = new Map<string, (typeof units)[number][]>();
  for (const u of units) {
    const list = unitsByMedicine.get(u.medicineId) ?? [];
    list.push(u);
    unitsByMedicine.set(u.medicineId, list);
  }
  for (const list of unitsByMedicine.values())
    list.sort((a, b) => a.sortOrder - b.sortOrder);

  const itemsByRequest = new Map<string, (typeof requestItems)[number][]>();
  for (const it of requestItems) {
    const list = itemsByRequest.get(it.purchaseRequestId) ?? [];
    list.push(it);
    itemsByRequest.set(it.purchaseRequestId, list);
  }

  const sorted = [...requests].sort((a, b) => b.createdAt - a.createdAt);

  const openCreate = () => {
    setLines([]);
    setNote("");
    setError(null);
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!user) return;
    setError(null);
    const parsed = lines.map((l) => ({
      medicineId: l.medicineId,
      requestedQty: Number(l.qty),
      unitId: l.unitId || undefined,
      unitName: l.unitName || undefined,
      unitConversion: l.unitConversion || undefined,
    }));
    try {
      await createPurchaseRequest({
        lines: parsed,
        note,
        requestedBy: user.id,
        requestedByName: user.fullName,
      });
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create request.");
    }
  };

  const act = async (
    id: string,
    status: PurchaseRequestStatus,
    label: string,
  ) => {
    if (!user) return;
    setError(null);
    try {
      await setPurchaseRequestStatus(id, status, user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${label}.`);
    }
  };

  const newLine = (): LineDraft => {
    const first = medicines[0];
    const u = first
      ? (unitsByMedicine.get(first.id) ?? [])[0]
      : undefined;
    return {
      key: uid(),
      medicineId: first?.id ?? "",
      unitId: u?.id ?? "",
      unitName: u?.unitName ?? "",
      unitConversion: u?.conversionToBase ?? 1,
      qty: "1",
    };
  };

  return (
    <div>
      <PageHeader
        title="Purchase Requests"
        subtitle="Internal requests for stock that become purchase orders"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            New Purchase Request
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
            No purchase requests yet. Click 'New Purchase Request' to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Items</th>
                  <th className="px-3 py-2 font-medium">Requested By</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((pr) => {
                  const items = itemsByRequest.get(pr.id) ?? [];
                  return (
                    <tr key={pr.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">
                        {pr.number}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_BADGE[pr.status]}>{pr.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {items.length} line(s)
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {pr.requestedByName ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDate(pr.createdAt)}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-slate-500">
                        {pr.note ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {pr.status === "PENDING" && (
                            <>
                              <button
                                onClick={() => act(pr.id, "APPROVED", "approve")}
                                className="rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                                title="Approve request"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                onClick={() => act(pr.id, "REJECTED", "reject")}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Reject request"
                              >
                                <X size={15} />
                              </button>
                              <button
                                onClick={() => act(pr.id, "CANCELLED", "cancel")}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                                title="Cancel request"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                          {pr.status === "APPROVED" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                navigate(`/admin/purchase-orders?pr=${pr.id}`)
                              }
                            >
                              <ClipboardList size={14} />
                              Create PO
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
          title="New Purchase Request"
          subtitle="Add the medicines your pharmacy needs"
          onClose={() => setShowModal(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                <FileText size={14} />
                Create Request
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <MedicineLinesEditor
              lines={lines}
              onChange={setLines}
              medicines={medicines}
              unitsByMedicine={unitsByMedicine}
              addLine={newLine}
            />
            <TextArea
              label="Note"
              rows={2}
              placeholder="Why is this stock needed?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
