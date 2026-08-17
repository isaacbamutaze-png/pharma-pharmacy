import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { UserPlus, Eye, HandCoins, Pencil, Search } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, formatDateTime, uid, now } from "../../lib/utils";
import {
  getCustomerBalance,
  getCustomerPurchases,
  recordCustomerPayment,
} from "../../lib/finance";
import { useAuthStore } from "../../store/authStore";
import { PAYMENT_METHODS } from "../../lib/payments/constants";
import type { Customer, PaymentMethod } from "../../types";

interface CustomerForm {
  name: string;
  phone: string;
  email: string;
}

interface PaymentForm {
  amount: string;
  paymentMethod: PaymentMethod;
  note: string;
}

export function CustomersPage() {
  const user = useAuthStore((s) => s.user);
  const customers = useLiveQuery(() => pharmaDb.customers.toArray(), []) ?? [];
  const sales = useLiveQuery(() => pharmaDb.sales.toArray(), []) ?? [];
  const payments = useLiveQuery(() => pharmaDb.customerPayments.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>({
    name: "",
    phone: "",
    email: "",
  });
  const [payingCustomer, setPayingCustomer] = useState<Customer | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    amount: "",
    paymentMethod: "CASH",
    note: "",
  });
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });

  const totalReceivables = customers.reduce(
    (sum, c) => sum + getCustomerBalance(c.id, sales, payments),
    0,
  );
  const customersWithDebt = customers.filter(
    (c) => getCustomerBalance(c.id, sales, payments) > 0,
  );

  const openAdd = () => {
    clearMessages();
    setEditing(null);
    setForm({ name: "", phone: "", email: "" });
    setShowForm(true);
  };

  const openEdit = (customer: Customer) => {
    clearMessages();
    setEditing(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
    });
    setShowForm(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    if (!form.name.trim()) {
      setError("Customer name is required.");
      return;
    }
    const timestamp = now();
    if (editing) {
      await pharmaDb.customers.update(editing.id, {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        updatedAt: timestamp,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "UPDATE",
        entityType: "customer",
        entityId: editing.id,
        newValues: { ...form },
        createdAt: timestamp,
      });
    } else {
      const existing = await pharmaDb.customers
        .where("name")
        .equals(form.name.trim())
        .first();
      if (existing) {
        setError("A customer with this name already exists.");
        return;
      }
      await pharmaDb.customers.add({
        id: uid(),
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "CREATE",
        entityType: "customer",
        newValues: { ...form },
        createdAt: timestamp,
      });
    }
    setShowForm(false);
    setSuccess("Customer saved successfully.");
  };

  const openPay = (customer: Customer) => {
    clearMessages();
    setPayingCustomer(customer);
    setPaymentForm({ amount: "", paymentMethod: "CASH", note: "" });
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payingCustomer) return;
    clearMessages();
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    try {
      await recordCustomerPayment({
        customerId: payingCustomer.id,
        amount,
        paymentMethod: paymentForm.paymentMethod,
        note: paymentForm.note.trim() || undefined,
        recordedBy: user.id,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "CUSTOMER_PAYMENT",
        entityType: "customer_payment",
        newValues: { customerId: payingCustomer.id, amount, method: paymentForm.paymentMethod },
        createdAt: now(),
      });
      setPayingCustomer(null);
      setSuccess(
        `Payment of ${formatMoney(amount, currency)} recorded for ${payingCustomer.name}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    }
  };

  const viewingSales = viewingCustomer
    ? sales
        .filter(
          (s) =>
            s.customerId === viewingCustomer.id &&
            s.status === "COMPLETED" &&
            s.balanceDue > 0,
        )
        .sort((a, b) => b.saleDate - a.saleDate)
    : [];
  const viewingPayments = viewingCustomer
    ? payments
        .filter((p) => p.customerId === viewingCustomer.id)
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];
  const viewingBalance = viewingCustomer
    ? getCustomerBalance(viewingCustomer.id, sales, payments)
    : 0;

  return (
    <div>
      <PageHeader
        title="Customers & Credit"
        subtitle="Customer accounts and outstanding balances"
        actions={
          <Button onClick={openAdd}>
            <UserPlus size={16} />
            Add Customer
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
      {success && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Total Customers</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {customers.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Outstanding Receivables</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {formatMoney(totalReceivables, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Customers With Debt</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {customersWithDebt.length}
          </p>
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
              placeholder="Search by name, phone, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No customers found. Add your first customer or make a sale to a named
            customer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Total Purchases</th>
                  <th className="px-3 py-2 font-medium">Balance</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const balance = getCustomerBalance(c.id, sales, payments);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">{c.name}</p>
                        {c.email && (
                          <p className="text-xs text-slate-500">{c.email}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{c.phone || "—"}</td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatMoney(getCustomerPurchases(c.id, sales), currency)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={balance > 0 ? "amber" : "green"}>
                          {formatMoney(balance, currency)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setViewingCustomer(c)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label="View transactions"
                            title="Transactions"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => openEdit(c)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label="Edit customer"
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => openPay(c)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-amber-50 hover:text-amber-600"
                            aria-label="Receive payment"
                            title="Receive payment"
                          >
                            <HandCoins size={16} />
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

      {showForm && (
        <Modal
          title={editing ? "Edit Customer" : "Add Customer"}
          subtitle={editing ? editing.name : "New customer account"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button form="customer-form" type="submit">
                Save Customer
              </Button>
            </>
          }
        >
          <form id="customer-form" onSubmit={handleSaveCustomer} className="space-y-4">
            <TextInput
              label="Name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Customer name"
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="e.g. +256 700 000000"
            />
            <TextInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Optional"
            />
          </form>
        </Modal>
      )}

      {payingCustomer && (
        <Modal
          title="Receive Payment"
          subtitle={payingCustomer.name}
          onClose={() => setPayingCustomer(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setPayingCustomer(null)}>
                Cancel
              </Button>
              <Button form="payment-form" type="submit">
                Record Payment
              </Button>
            </>
          }
        >
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="text-slate-500">Outstanding balance: </span>
            <span className="font-semibold text-amber-600">
              {formatMoney(
                getCustomerBalance(payingCustomer.id, sales, payments),
                currency,
              )}
            </span>
          </div>
          <form id="payment-form" onSubmit={handlePayment} className="space-y-4">
            <TextInput
              label="Amount *"
              type="number"
              min="0"
              placeholder="0"
              value={paymentForm.amount}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, amount: e.target.value })
              }
            />
            <SelectInput
              label="Payment method"
              value={paymentForm.paymentMethod}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  paymentMethod: e.target.value as PaymentMethod,
                })
              }
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm.value} value={pm.value}>
                  {pm.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Note"
              value={paymentForm.note}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, note: e.target.value })
              }
              placeholder="Optional"
            />
          </form>
        </Modal>
      )}

      {viewingCustomer && (
        <Modal
          title={viewingCustomer.name}
          subtitle="Credit and payment history"
          onClose={() => setViewingCustomer(null)}
          size="lg"
        >
          <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-50 px-4 py-3">
            <span className="text-sm text-amber-700">Current balance</span>
            <span className="text-lg font-bold text-amber-700">
              {formatMoney(viewingBalance, currency)}
            </span>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Credit Sales
          </p>
          {viewingSales.length === 0 ? (
            <p className="mb-4 text-sm text-slate-400">No outstanding credit sales.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-100">
              {viewingSales.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <p className="font-mono text-xs text-slate-700">
                      {s.invoiceNumber}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(s.saleDate)}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-amber-600">
                    {formatMoney(s.balanceDue, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payments Received
          </p>
          {viewingPayments.length === 0 ? (
            <p className="text-sm text-slate-400">No payments received yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {viewingPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-slate-700">
                      {formatMoney(p.amount, currency)}{" "}
                      <span className="text-xs text-slate-400">
                        ({p.paymentMethod})
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(p.createdAt)}
                      {p.note ? ` • ${p.note}` : ""}
                    </p>
                  </div>
                  <Badge tone="green">Received</Badge>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}
