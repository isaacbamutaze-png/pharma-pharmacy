import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { todayISO, addDaysISO } from "./stock";
import { round2 } from "./sales";
import { emptyMethodTotals } from "./payments/constants";
import type {
  CustomerPayment,
  Expense,
  ExpenseCategory,
  PaymentMethod,
  Refund,
  RefundItem,
  Sale,
  SaleItem,
} from "../types";

export function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function periodThreshold(period: string): string {
  if (period === "TODAY") return todayISO();
  if (period === "WEEK") return addDaysISO(-7);
  if (period === "MONTH") return monthStartISO();
  return "";
}

export function getCustomerBalance(
  customerId: string,
  sales: Sale[],
  payments: CustomerPayment[],
): number {
  let owed = 0;
  for (const s of sales) {
    if (s.customerId === customerId && s.status === "COMPLETED") {
      owed += s.balanceDue;
    }
  }
  let paid = 0;
  for (const p of payments) {
    if (p.customerId === customerId) paid += p.amount;
  }
  return round2(Math.max(0, owed - paid));
}

export function getCustomerPurchases(customerId: string, sales: Sale[]): number {
  return round2(
    sales
      .filter(
        (s) => s.customerId === customerId && s.status === "COMPLETED",
      )
      .reduce((sum, s) => sum + s.total, 0),
  );
}

export interface RecordPaymentInput {
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  note?: string;
  recordedBy?: string;
}

export async function recordCustomerPayment(
  input: RecordPaymentInput,
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  const customer = await pharmaDb.customers.get(input.customerId);
  if (!customer) throw new Error("Customer not found.");

  const sales = await pharmaDb.sales
    .filter(
      (s) => s.customerId === input.customerId && s.status === "COMPLETED",
    )
    .toArray();
  const payments = await pharmaDb.customerPayments
    .where("customerId")
    .equals(input.customerId)
    .toArray();
  const balance = getCustomerBalance(input.customerId, sales, payments);
  if (input.amount > balance) {
    throw new Error(
      `Amount exceeds the outstanding balance of ${balance}.`,
    );
  }

  await pharmaDb.customerPayments.add({
    id: uid(),
    customerId: input.customerId,
    amount: round2(input.amount),
    paymentMethod: input.paymentMethod,
    note: input.note?.trim() || undefined,
    recordedBy: input.recordedBy,
    createdAt: now(),
  });
}

export interface AddExpenseInput {
  category: ExpenseCategory;
  description?: string;
  amount: number;
  expenseDate: string;
  recordedBy?: string;
}

export async function addExpense(input: AddExpenseInput): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  if (!input.expenseDate) throw new Error("Date is required.");
  const ts = new Date(`${input.expenseDate}T00:00:00`).getTime();
  await pharmaDb.expenses.add({
    id: uid(),
    category: input.category,
    description: input.description?.trim() || undefined,
    amount: round2(input.amount),
    expenseDate: Number.isFinite(ts) ? ts : now(),
    expenseDateKey: input.expenseDate,
    recordedBy: input.recordedBy,
    createdAt: now(),
  });
}

export async function deleteExpense(
  id: string,
  performedBy: string,
): Promise<void> {
  const expense = await pharmaDb.expenses.get(id);
  if (!expense) throw new Error("Expense not found.");
  await pharmaDb.expenses.delete(id);
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: performedBy,
    action: "DELETE",
    entityType: "expense",
    entityId: id,
    oldValues: { ...expense },
    createdAt: now(),
  });
}

export interface PeriodStats {
  saleCount: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  avgSale: number;
  revenueByMethod: Record<PaymentMethod, number>;
}

export function computePeriodStats(
  sales: Sale[],
  saleItems: SaleItem[],
  expenses: Expense[],
  refunds: Refund[],
  refundItems: RefundItem[],
  threshold: string,
): PeriodStats {
  const inPeriod = sales.filter(
    (s) => !threshold || s.saleDateKey >= threshold,
  );
  const completed = inPeriod.filter((s) => s.status === "COMPLETED");

  const itemsBySale = new Map<string, SaleItem[]>();
  for (const item of saleItems) {
    const list = itemsBySale.get(item.saleId);
    if (list) list.push(item);
    else itemsBySale.set(item.saleId, [item]);
  }

  let revenue = 0;
  let cogs = 0;
  let count = 0;
  const revenueByMethod = emptyMethodTotals();

  for (const s of completed) {
    revenue += s.total;
    count += 1;
    revenueByMethod[s.paymentMethod] += s.total;
    const items = itemsBySale.get(s.id) ?? [];
    for (const item of items) {
      cogs += item.costPrice * item.quantity;
    }
  }

  const refundsInPeriod = refunds.filter(
    (r) => !threshold || r.saleDateKey >= threshold,
  );
  const refundIdsInPeriod = new Set(refundsInPeriod.map((r) => r.id));
  let refundTotal = 0;
  let refundCogs = 0;
  for (const r of refundsInPeriod) {
    refundTotal += r.amount;
    revenueByMethod[r.refundMethod] -= r.amount;
  }
  for (const ri of refundItems) {
    if (refundIdsInPeriod.has(ri.refundId)) {
      refundCogs += ri.costPrice * ri.quantity;
    }
  }

  revenue = round2(revenue - refundTotal);
  cogs = round2(cogs - refundCogs);
  const expensesTotal = round2(
    expenses
      .filter((e) => !threshold || e.expenseDateKey >= threshold)
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const grossProfit = round2(revenue - cogs);
  const netProfit = round2(grossProfit - expensesTotal);

  return {
    saleCount: count,
    revenue,
    cogs,
    grossProfit,
    expenses: expensesTotal,
    netProfit,
    avgSale: count > 0 ? round2(revenue / count) : 0,
    revenueByMethod,
  };
}
