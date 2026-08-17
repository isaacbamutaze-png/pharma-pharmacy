import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PackagePlus, ShieldAlert, Scale, RotateCcw } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDateTime } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import {
  registerMovement,
  disposeControlled,
  adjustControlled,
  reconcileControlled,
  createControlRequisition,
  completeControlRequisition,
  isControlled,
  registerTypeTone,
} from "../../lib/controlled";
import type {
  ControlRequisition,
} from "../../types";

interface ReceiptForm {
  medicineId: string;
  batchId: string;
  quantity: string;
  reason: string;
}

interface DualAuthForm {
  quantity: string;
  reason: string;
  witnessedBy: string;
  secondAuthorizerId: string;
}

const emptyReceipt: ReceiptForm = {
  medicineId: "",
  batchId: "",
  quantity: "",
  reason: "",
};

const emptyDualAuth: DualAuthForm = {
  quantity: "",
  reason: "",
  witnessedBy: "",
  secondAuthorizerId: "",
};

export function ControlledMedicinesPage() {
  const user = useAuthStore((s) => s.user);
  const medicines =
    useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches =
    useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const registerEntries =
    useLiveQuery(() => pharmaDb.controlledDrugRegister.toArray(), []) ?? [];
  const counts =
    useLiveQuery(() => pharmaDb.controlledDrugCounts.toArray(), []) ?? [];
  const requisitions =
    useLiveQuery(() => pharmaDb.controlRequisitions.toArray(), []) ?? [];
  const users = useLiveQuery(() => pharmaDb.users.toArray(), []) ?? [];

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<boolean>(false);
  const [receipt, setReceipt] = useState<ReceiptForm>(emptyReceipt);
  const [actionTarget, setActionTarget] = useState<{
    medicineId: string;
    batchId: string;
    batchNumber: string;
    action: "DESTROYED" | "ADJUSTMENT" | "RECONCILE";
  } | null>(null);
  const [action, setAction] = useState<DualAuthForm>(emptyDualAuth);
  const [adjustDelta, setAdjustDelta] = useState<string>("0");
  const [countedBalance, setCountedBalance] = useState<string>("");
  const [reconcileNotes, setReconcileNotes] = useState<string>("");
  const [reqTarget, setReqTarget] = useState<boolean>(false);
  const [reqForm, setReqForm] = useState<{
    type: "ISSUE" | "RECEIVE";
    medicineId: string;
    batchId: string;
    quantity: string;
    fromLocation: string;
    toLocation: string;
  }>({
    type: "ISSUE",
    medicineId: "",
    batchId: "",
    quantity: "",
    fromLocation: "",
    toLocation: "",
  });

  const medById = new Map(medicines.map((m) => [m.id, m]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const cdrMeds = medicines.filter(isControlled);

  const sortedEntries = useMemo(
    () =>
      [...registerEntries].sort(
        (a, b) => b.recordedAt - a.recordedAt,
      ),
    [registerEntries],
  );

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...registerEntries].sort(
      (a, b) => a.recordedAt - b.recordedAt,
    );
    for (const e of sorted) map.set(e.batchId, e.balanceAfter);
    return map;
  }, [registerEntries]);

  const cdrBatchRows = batches.filter(
    (b) => isControlled(medById.get(b.medicineId)),
  );

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const openReceipt = () => {
    clearMessages();
    setReceipt(emptyReceipt);
    setReceiptTarget(true);
  };

  const handleReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    try {
      await registerMovement({
        medicineId: receipt.medicineId,
        batchId: receipt.batchId,
        transactionType: "RECEIVED",
        quantity: Number(receipt.quantity),
        pharmacistId: user.id,
        pharmacistName: user.fullName,
        reason: receipt.reason || "Controlled stock receipt",
      });
      setReceiptTarget(false);
      setSuccess("Controlled receipt recorded on the register.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record receipt.");
    }
  };

  const openAction = (
    actionType: "DESTROYED" | "ADJUSTMENT" | "RECONCILE",
    batchId: string,
  ) => {
    clearMessages();
    const batch = batchById.get(batchId);
    setActionTarget({
      medicineId: batch?.medicineId ?? "",
      batchId,
      batchNumber: batch?.batchNumber ?? "",
      action: actionType,
    });
    setAction(emptyDualAuth);
    setAdjustDelta("0");
    setCountedBalance(String(balances.get(batchId) ?? 0));
    setReconcileNotes("");
  };

  const handleDualAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !actionTarget) return;
    clearMessages();
    const second = users.find((u) => u.id === action.secondAuthorizerId);
    try {
      if (actionTarget.action === "DESTROYED") {
        await disposeControlled({
          medicineId: actionTarget.medicineId,
          batchId: actionTarget.batchId,
          quantity: Number(action.quantity),
          reason: action.reason,
          witnessedBy: action.witnessedBy || undefined,
          pharmacistId: user.id,
          pharmacistName: user.fullName,
          secondAuthorizerId: action.secondAuthorizerId,
          secondAuthorizerName: second?.fullName ?? "",
        });
        setSuccess("Controlled disposal recorded (dual authorized).");
      } else if (actionTarget.action === "ADJUSTMENT") {
        await adjustControlled({
          medicineId: actionTarget.medicineId,
          batchId: actionTarget.batchId,
          delta: Number(adjustDelta),
          reason: action.reason,
          pharmacistId: user.id,
          pharmacistName: user.fullName,
          secondAuthorizerId: action.secondAuthorizerId,
          secondAuthorizerName: second?.fullName ?? "",
        });
        setSuccess("Controlled balance adjusted (dual authorized).");
      } else {
        await reconcileControlled({
          medicineId: actionTarget.medicineId,
          batchId: actionTarget.batchId,
          countedBalance: Number(countedBalance),
          countedBy: user.id,
          countedByName: user.fullName,
          notes: reconcileNotes || undefined,
        });
        setSuccess("Reconciliation count recorded.");
      }
      setActionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  };

  const openRequisition = () => {
    clearMessages();
    setReqForm({
      type: "ISSUE",
      medicineId: cdrMeds[0]?.id ?? "",
      batchId: "",
      quantity: "",
      fromLocation: "",
      toLocation: "",
    });
    setReqTarget(true);
  };

  const handleCreateRequisition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    try {
      const r = await createControlRequisition({
        type: reqForm.type,
        medicineId: reqForm.medicineId,
        batchId: reqForm.batchId,
        quantity: Number(reqForm.quantity),
        fromLocation: reqForm.fromLocation || undefined,
        toLocation: reqForm.toLocation || undefined,
        pharmacistId: user.id,
        pharmacistName: user.fullName,
      });
      setReqTarget(false);
      setSuccess(`Requisition ${r.requisitionNumber} created (${r.type}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create requisition.");
    }
  };

  const handleCompleteRequisition = async (r: ControlRequisition) => {
    if (!user) return;
    clearMessages();
    try {
      await completeControlRequisition(r.id, user.id, user.fullName);
      setSuccess(`Requisition ${r.requisitionNumber} completed on the register.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete requisition.");
    }
  };

  const batchOptionsFor = (medicineId: string) =>
    batches.filter((b) => b.medicineId === medicineId);

  return (
    <div>
      <PageHeader
        title="Controlled Medicines"
        subtitle="Restricted drug register & authorization"
        actions={
          <>
            <Button variant="outline" onClick={openRequisition}>
              <RotateCcw size={16} />
              Internal Requisition
            </Button>
            <Button onClick={openReceipt}>
              <PackagePlus size={16} />
              Record Receipt
            </Button>
          </>
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">
            Controlled Medicines
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {cdrMeds.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Register Entries</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {registerEntries.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Open Requisitions</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {requisitions.filter((r) => r.status === "PENDING").length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Counts (variance)</p>
          <p className="mt-1 text-xl font-bold text-red-600">
            {counts.filter((c) => c.status === "VARIANCE").length}
          </p>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert size={16} className="text-pharma-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            Controlled Drug Register — batch balances
          </h2>
        </div>
        {cdrBatchRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No controlled batches yet. Classify a medicine as CDR and record a
            receipt to start the register.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Register Balance
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Inventory Remaining
                  </th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cdrBatchRows.map((b) => {
                  const med = medById.get(b.medicineId);
                  const balance = balances.get(b.id) ?? 0;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {med?.name ?? b.medicineId}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">
                        {b.batchNumber}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Badge
                          tone={balance === 0 ? "slate" : "red"}
                        >
                          {balance}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {b.quantityRemaining}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openAction("DESTROYED", b.id)}
                            className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                            aria-label="Dispose"
                            title="Dispose (dual authorized)"
                          >
                            <PackagePlus size={16} />
                          </button>
                          <button
                            onClick={() => openAction("ADJUSTMENT", b.id)}
                            className="rounded-lg p-2 text-amber-600 hover:bg-amber-50"
                            aria-label="Adjust"
                            title="Adjust balance (dual authorized)"
                          >
                            <ShieldAlert size={16} />
                          </button>
                          <button
                            onClick={() => openAction("RECONCILE", b.id)}
                            className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                            aria-label="Reconcile"
                            title="Count & reconcile"
                          >
                            <Scale size={16} />
                          </button>
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

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Register Ledger
        </h2>
        {sortedEntries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No register movements recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Pharmacist</th>
                  <th className="px-3 py-2 font-medium">2nd Approver</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedEntries.slice(0, 50).map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-pharma-600">
                      {e.entryNumber}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {medById.get(e.medicineId)?.name ?? e.medicineId}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {batchById.get(e.batchId)?.batchNumber ?? e.batchId}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={registerTypeTone(e.transactionType)}>
                        {e.transactionType}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {e.quantity}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {e.balanceAfter}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {e.pharmacistName || userById.get(e.pharmacistId)?.fullName || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {e.secondAuthorizerName || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{e.reason}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDateTime(e.recordedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Internal Requisitions
          </h2>
          <Button variant="secondary" size="sm" onClick={openRequisition}>
            <RotateCcw size={14} />
            New
          </Button>
        </div>
        {requisitions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No internal requisitions yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">From / To</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requisitions.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-pharma-600">
                      {r.requisitionNumber}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.type === "ISSUE" ? "amber" : "green"}>
                        {r.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {medById.get(r.medicineId)?.name ?? r.medicineId}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {r.quantity}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.fromLocation || "—"} → {r.toLocation || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          r.status === "COMPLETED"
                            ? "green"
                            : r.status === "CANCELLED"
                              ? "red"
                              : "amber"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleCompleteRequisition(r)}
                        >
                          Complete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {receiptTarget && (
        <Modal
          title="Record Controlled Receipt"
          subtitle="Registers a RECEIVED movement on the batch running balance"
          onClose={() => setReceiptTarget(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setReceiptTarget(false)}>
                Cancel
              </Button>
              <Button form="receipt-form" type="submit">
                Record
              </Button>
            </>
          }
        >
          <form id="receipt-form" onSubmit={handleReceipt} className="space-y-4">
            <SelectInput
              label="Medicine *"
              value={receipt.medicineId}
              onChange={(e) =>
                setReceipt({ ...receipt, medicineId: e.target.value, batchId: "" })
              }
            >
              <option value="">Select controlled medicine...</option>
              {cdrMeds.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Batch *"
              value={receipt.batchId}
              onChange={(e) =>
                setReceipt({ ...receipt, batchId: e.target.value })
              }
            >
              <option value="">Select batch...</option>
              {batchOptionsFor(receipt.medicineId).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} (remaining {b.quantityRemaining})
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Quantity *"
              type="number"
              min="1"
              value={receipt.quantity}
              onChange={(e) =>
                setReceipt({ ...receipt, quantity: e.target.value })
              }
            />
            <TextArea
              label="Reason"
              rows={2}
              placeholder="e.g. Received into the controlled store"
              value={receipt.reason}
              onChange={(e) =>
                setReceipt({ ...receipt, reason: e.target.value })
              }
            />
          </form>
        </Modal>
      )}

      {actionTarget && (
        <Modal
          title={
            actionTarget.action === "DESTROYED"
              ? `Dispose ${actionTarget.batchNumber}`
              : actionTarget.action === "ADJUSTMENT"
                ? `Adjust ${actionTarget.batchNumber}`
                : `Reconcile ${actionTarget.batchNumber}`
          }
          subtitle={
            actionTarget.action === "DESTROYED"
              ? "Witnessed, dual-authorized disposal"
              : actionTarget.action === "ADJUSTMENT"
                ? "Balance adjustment — never a raw stock edit"
                : "Physical count vs register balance"
          }
          onClose={() => setActionTarget(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setActionTarget(null)}>
                Cancel
              </Button>
              <Button form="dual-auth-form" type="submit">
                {actionTarget.action === "RECONCILE" ? "Record Count" : "Submit"}
              </Button>
            </>
          }
        >
          <form
            id="dual-auth-form"
            onSubmit={handleDualAuthAction}
            className="space-y-4"
          >
            {actionTarget.action === "RECONCILE" ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      Register balance
                    </p>
                    <p className="mt-1 text-xl font-bold text-slate-900">
                      {balances.get(actionTarget.batchId) ?? 0}
                    </p>
                  </div>
                  <TextInput
                    label="Counted balance *"
                    type="number"
                    min="0"
                    value={countedBalance}
                    onChange={(e) => setCountedBalance(e.target.value)}
                  />
                </div>
                <TextArea
                  label="Notes"
                  rows={2}
                  placeholder="Optional notes"
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                />
              </>
            ) : (
              <>
                <TextInput
                  label={
                    actionTarget.action === "DESTROYED"
                      ? "Quantity to dispose *"
                      : "Adjustment delta *"
                  }
                  type="number"
                  min="1"
                  hint={
                    actionTarget.action === "ADJUSTMENT"
                      ? "Positive adds to the balance, negative reduces it."
                      : undefined
                  }
                  value={
                    actionTarget.action === "DESTROYED"
                      ? action.quantity
                      : adjustDelta
                  }
                  onChange={(e) =>
                    actionTarget.action === "DESTROYED"
                      ? setAction({ ...action, quantity: e.target.value })
                      : setAdjustDelta(e.target.value)
                  }
                />
                <TextArea
                  label="Reason *"
                  rows={2}
                  placeholder="Required for the audit trail"
                  value={action.reason}
                  onChange={(e) =>
                    setAction({ ...action, reason: e.target.value })
                  }
                />
                {actionTarget.action === "DESTROYED" && (
                  <TextInput
                    label="Witnessed by"
                    value={action.witnessedBy}
                    onChange={(e) =>
                      setAction({ ...action, witnessedBy: e.target.value })
                    }
                    placeholder="Name of witness"
                  />
                )}
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                    Dual authorization required
                  </p>
                  <SelectInput
                    label="Second authorized approver *"
                    value={action.secondAuthorizerId}
                    onChange={(e) =>
                      setAction({ ...action, secondAuthorizerId: e.target.value })
                    }
                  >
                    <option value="">Select approver...</option>
                    {users
                      .filter((u) => u.id !== user?.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                  </SelectInput>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}

      {reqTarget && (
        <Modal
          title="Internal Controlled Requisition"
          subtitle="Moves controlled stock between the store and counters"
          onClose={() => setReqTarget(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setReqTarget(false)}>
                Cancel
              </Button>
              <Button form="req-form" type="submit">
                Create
              </Button>
            </>
          }
        >
          <form id="req-form" onSubmit={handleCreateRequisition} className="space-y-4">
            <SelectInput
              label="Type *"
              value={reqForm.type}
              onChange={(e) =>
                setReqForm({ ...reqForm, type: e.target.value as "ISSUE" | "RECEIVE" })
              }
            >
              <option value="ISSUE">Issue (store → counter)</option>
              <option value="RECEIVE">Receive (counter → store)</option>
            </SelectInput>
            <SelectInput
              label="Medicine *"
              value={reqForm.medicineId}
              onChange={(e) =>
                setReqForm({ ...reqForm, medicineId: e.target.value, batchId: "" })
              }
            >
              <option value="">Select controlled medicine...</option>
              {cdrMeds.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Batch *"
              value={reqForm.batchId}
              onChange={(e) => setReqForm({ ...reqForm, batchId: e.target.value })}
            >
              <option value="">Select batch...</option>
              {batchOptionsFor(reqForm.medicineId).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} (remaining {b.quantityRemaining})
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Quantity *"
              type="number"
              min="1"
              value={reqForm.quantity}
              onChange={(e) =>
                setReqForm({ ...reqForm, quantity: e.target.value })
              }
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="From location"
                value={reqForm.fromLocation}
                onChange={(e) =>
                  setReqForm({ ...reqForm, fromLocation: e.target.value })
                }
                placeholder="e.g. Controlled store"
              />
              <TextInput
                label="To location"
                value={reqForm.toLocation}
                onChange={(e) =>
                  setReqForm({ ...reqForm, toLocation: e.target.value })
                }
                placeholder="e.g. Counter A"
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
