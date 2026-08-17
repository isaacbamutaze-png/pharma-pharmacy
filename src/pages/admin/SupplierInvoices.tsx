import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Receipt, Wallet, X } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { StatCard } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney } from "../../lib/utils";
import { round2 } from "../../lib/sales";
import { createSupplierInvoice, recordSupplierPayment, setSupplierInvoiceStatus } from "../../lib/procurement";
import { grnTotal } from "../../lib/procurement";
import { PAYMENT_METHODS } from "../../lib/payments/constants";
import { useAuthStore } from "../../store/authStore";
import type { PaymentMethod, SupplierInvoiceStatus } from "../../types";

const STATUS_BADGE: Record<SupplierInvoiceStatus, "slate" | "amber" | "green" | "red" | "blue"> = {
  PENDING: "amber",
  PARTIALLY_PAID: "blue",
  PAID: "green",
  OVERDUE: "red",
  CANCELLED: "slate",
};

export function SupplierInvoicesPage() {
  const user = useAuthStore((s) => s.user);
  const invoices =
    useLiveQuery(() => pharmaDb.supplierInvoices.toArray(), []) ?? [];
  const payments =
    useLiveQuery(() => pharmaDb.supplierPayments.toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const grns = useLiveQuery(() => pharmaDb.grns.toArray(), []) ?? [];
  const grnItems = useLiveQuery(() => pharmaDb.grnItems.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [showInvoice, setShowInvoice] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("CASH");
  const [payRef, setPayRef] = useState("");

  const itemsByGrn = useMemo(() => {
    const map = new Map<string, (typeof grnItems)[number][]>();
    for (const it of grnItems) {
      const list = map.get(it.grnId) ?? [];
      list.push(it);
      map.set(it.grnId, list);
    }
    return map;
  }, [grnItems]);

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, (typeof payments)[number][]>();
    for (const p of payments) {
      if (!p.invoiceId) continue;
      const list = map.get(p.invoiceId) ?? [];
      list.push(p);
      map.set(p.invoiceId, list);
    }
    return map;
  }, [payments]);

  const invoicedGrnIds = useMemo(
    () => new Set(invoices.map((i) => i.grnId).filter(Boolean)),
    [invoices],
  );
  const openGrns = grns.filter((g) => !invoicedGrnIds.has(g.id));

  const outstanding = round2(
    invoices
      .filter((i) => i.status !== "CANCELLED" && i.status !== "PAID")
      .reduce((s, i) => s + i.total, 0),
  );
  const totalPaid = round2(payments.reduce((s, p) => s + p.amount, 0));

  const openNewInvoice = () => {
    setSupplierId(suppliers.find((s) => s.status === "ACTIVE")?.id ?? "");
    setGrnId("");
    setAmount("");
    setTax("");
    setDueDate("");
    setNote("");
    setError(null);
    setShowInvoice(true);
  };

  const openPay = (id: string, remaining: number) => {
    setPayFor(id);
    setPayAmount(String(remaining));
    setPayMethod("CASH");
    setPayRef("");
    setError(null);
  };

  const handleCreateInvoice = async () => {
    setError(null);
    try {
      await createSupplierInvoice({
        supplierId: grnId ? undefined : supplierId,
        grnId: grnId || undefined,
        amount: grnId ? undefined : Number(amount),
        tax: Number(tax || 0),
        dueDate: dueDate || undefined,
        note,
      });
      setShowInvoice(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice.");
    }
  };

  const handlePay = async () => {
    if (!user || !payFor) return;
    setError(null);
    try {
      await recordSupplierPayment({
        supplierId: invoices.find((i) => i.id === payFor)?.supplierId ?? "",
        invoiceId: payFor,
        amount: Number(payAmount),
        method: payMethod,
        reference: payRef || undefined,
        recordedBy: user.id,
        recordedByName: user.fullName,
      });
      setPayFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm("Cancel this supplier invoice?")) return;
    setError(null);
    try {
      await setSupplierInvoiceStatus(id, "CANCELLED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel invoice.");
    }
  };

  const sorted = [...invoices].sort((a, b) => b.createdAt - a.createdAt);
  const payTarget = payFor ? invoices.find((i) => i.id === payFor) : undefined;
  const payPaid = payTarget
    ? round2((paymentsByInvoice.get(payTarget.id) ?? []).reduce((s, p) => s + p.amount, 0))
    : 0;

  return (
    <div>
      <PageHeader
        title="Supplier Invoices"
        subtitle="Supplier liabilities, payments and balances"
        actions={
          <Button onClick={openNewInvoice}>
            <Plus size={16} />
            New Supplier Invoice
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Outstanding Balance"
          value={formatMoney(outstanding, currency)}
          icon={<Receipt size={20} />}
          color="text-red-600 bg-red-50"
        />
        <StatCard
          label="Total Paid to Suppliers"
          value={formatMoney(totalPaid, currency)}
          icon={<Wallet size={20} />}
          color="text-emerald-600 bg-emerald-50"
        />
        <StatCard
          label="Open Invoices"
          value={String(
            invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "PAID").length,
          )}
          icon={<Receipt size={20} />}
        />
      </div>

      <Card>
        {sorted.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No supplier invoices yet. Click 'New Supplier Invoice' to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">GRN</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Tax</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((inv) => {
                  const paid = round2(
                    (paymentsByInvoice.get(inv.id) ?? []).reduce((s, p) => s + p.amount, 0),
                  );
                  const remaining = round2(inv.total - paid);
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">
                        {inv.number}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{inv.supplierName}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">
                        {inv.grnNumber ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(inv.amount, currency)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(inv.tax, currency)}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {formatMoney(inv.total, currency)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(paid, currency)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_BADGE[inv.status]}>{inv.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{inv.dueDate ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {inv.status !== "CANCELLED" && inv.status !== "PAID" && (
                            <Button size="sm" onClick={() => openPay(inv.id, remaining)}>
                              <Wallet size={13} />
                              Record Payment
                            </Button>
                          )}
                          {inv.status === "PENDING" && (
                            <button
                              onClick={() => handleCancel(inv.id)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Cancel invoice"
                            >
                              <X size={15} />
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

      {showInvoice && (
        <Modal
          title="New Supplier Invoice"
          subtitle="Invoice from a GRN or entered manually"
          onClose={() => setShowInvoice(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowInvoice(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateInvoice}>
                <Receipt size={14} />
                Create Invoice
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <SelectInput
              label="Goods Received Note (optional)"
              value={grnId}
              onChange={(e) => {
                setGrnId(e.target.value);
                const grn = grns.find((g) => g.id === e.target.value);
                if (grn) {
                  setSupplierId(grn.supplierId);
                  const items = itemsByGrn.get(grn.id) ?? [];
                  setAmount(String(grnTotal(items)));
                }
              }}
            >
              <option value="">— Enter manually —</option>
              {openGrns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.number} — {g.supplierName}
                </option>
              ))}
            </SelectInput>
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
              <TextInput
                label="Invoice Amount"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <TextInput
                label="Tax"
                type="number"
                min="0"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
              <TextInput
                label="Due Date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <TextArea
              label="Note"
              rows={2}
              placeholder="Invoice reference from the supplier..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
      )}

      {payTarget && (
        <Modal
          title={`Record Payment — ${payTarget.number}`}
          subtitle={`${payTarget.supplierName} · ${formatMoney(payTarget.total, currency)} total`}
          onClose={() => setPayFor(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setPayFor(null)}>
                Cancel
              </Button>
              <Button onClick={handlePay}>
                <Wallet size={14} />
                Record Payment
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="text-slate-500">Already paid: </span>
              <span className="font-semibold text-slate-900">
                {formatMoney(payPaid, currency)}
              </span>
              <span className="text-slate-500"> · Remaining: </span>
              <span className="font-semibold text-slate-900">
                {formatMoney(payTarget.total - payPaid, currency)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput
                label="Amount *"
                type="number"
                min="0.01"
                max={payTarget.total - payPaid}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <SelectInput
                label="Method *"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </SelectInput>
            </div>
            <TextInput
              label="Reference"
              placeholder="e.g. bank ref, mobile money ref"
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Payments reduce the supplier balance. PHARMA never collects
              customer PINs — payment references are recorded for traceability.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
