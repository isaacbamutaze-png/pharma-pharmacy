import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Wallet } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, formatDate, uid, now } from "../../lib/utils";
import { addExpense, deleteExpense, periodThreshold, monthStartISO } from "../../lib/finance";
import { todayISO } from "../../lib/stock";
import { useAuthStore } from "../../store/authStore";
import type { ExpenseCategory } from "../../types";

const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "RENT", label: "Rent" },
  { value: "SALARIES", label: "Salaries & Wages" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "SUPPLIES", label: "Supplies & Consumables" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "MARKETING", label: "Marketing" },
  { value: "OTHER", label: "Other" },
];

const CATEGORY_TONES: Record<ExpenseCategory, "slate" | "green" | "red" | "amber" | "blue"> = {
  RENT: "blue",
  SALARIES: "blue",
  UTILITIES: "amber",
  SUPPLIES: "slate",
  EQUIPMENT: "blue",
  MAINTENANCE: "amber",
  TRANSPORT: "green",
  MARKETING: "blue",
  OTHER: "slate",
};

export function ExpensesPage() {
  const user = useAuthStore((s) => s.user);
  const expenses = useLiveQuery(() => pharmaDb.expenses.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [period, setPeriod] = useState("MONTH");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    category: "OTHER" as ExpenseCategory,
    description: "",
    amount: "",
    expenseDate: todayISO(),
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const threshold = periodThreshold(period);
  const filtered = [...expenses]
    .filter((e) => !threshold || e.expenseDateKey >= threshold)
    .sort((a, b) => b.expenseDate - a.expenseDate);

  const periodTotal = filtered.reduce((sum, e) => sum + e.amount, 0);
  const monthTotal = expenses
    .filter((e) => e.expenseDateKey >= monthStartISO())
    .reduce((sum, e) => sum + e.amount, 0);
  const todayTotal = expenses
    .filter((e) => e.expenseDateKey === todayISO())
    .reduce((sum, e) => sum + e.amount, 0);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const openAdd = () => {
    clearMessages();
    setForm({ category: "OTHER", description: "", amount: "", expenseDate: todayISO() });
    setShowAdd(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!form.expenseDate) {
      setError("Date is required.");
      return;
    }
    try {
      await addExpense({
        category: form.category,
        description: form.description,
        amount,
        expenseDate: form.expenseDate,
        recordedBy: user.id,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "EXPENSE_ADD",
        entityType: "expense",
        newValues: { category: form.category, amount, expenseDate: form.expenseDate },
        createdAt: now(),
      });
      setShowAdd(false);
      setSuccess("Expense recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record expense.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!window.confirm("Delete this expense?")) return;
    clearMessages();
    try {
      await deleteExpense(id, user.id);
      setSuccess("Expense deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete expense.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Operating costs for profit calculation"
        actions={
          <Button onClick={openAdd}>
            <Plus size={16} />
            Add Expense
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
          <p className="text-xs font-medium text-slate-500">Today</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {formatMoney(todayTotal, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">This Month</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {formatMoney(monthTotal, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Selected Period</p>
          <p className="mt-1 text-xl font-bold text-pharma-700">
            {formatMoney(periodTotal, currency)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <SelectInput
            label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="lg:w-44"
          >
            <option value="TODAY">Today</option>
            <option value="WEEK">Last 7 days</option>
            <option value="MONTH">This month</option>
            <option value="ALL">All time</option>
          </SelectInput>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No expenses recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 text-slate-600">
                      {formatDate(e.expenseDate)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={CATEGORY_TONES[e.category]}>
                        {e.category.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {e.description || "—"}
                    </td>
                    <td className="px-3 py-3 font-semibold text-red-600">
                      -{formatMoney(e.amount, currency)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete expense"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showAdd && (
        <Modal
          title="Add Expense"
          subtitle="Record an operating cost"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button form="expense-form" type="submit">
                <Wallet size={16} />
                Record Expense
              </Button>
            </>
          }
        >
          <form id="expense-form" onSubmit={handleAdd} className="space-y-4">
            <SelectInput
              label="Category *"
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as ExpenseCategory })
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="e.g. Monthly electricity bill"
            />
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label="Amount *"
                type="number"
                min="0"
                placeholder="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              <TextInput
                label="Date *"
                type="date"
                max={todayISO()}
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
