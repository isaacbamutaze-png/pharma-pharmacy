import { pharmaDb } from "../db";
import { round2 } from "./sales";
import { uid, now } from "./utils";
import type { CashDrawerMovement, DrawerMovementType, Shift } from "../types";

/**
 * Cashier shifts and the cash drawer (blueprint 5.19).
 * Expected cash is DERIVED from recorded payments, never typed in:
 *   opening + cash sales (minus change given) - cash refunds
 *           + deposits - withdrawals - cash expenses
 */

export interface ShiftFigures {
  cashSales: number;
  cashRefunds: number;
  deposits: number;
  withdrawals: number;
  expenses: number;
  expectedCash: number;
  salesCount: number;
  /** Non-cash takings in the period, for the cashier's information. */
  otherSales: Record<string, number>;
}

export async function getOpenShift(cashierId: string): Promise<Shift | undefined> {
  return pharmaDb.shifts
    .where("cashierId")
    .equals(cashierId)
    .filter((s) => s.status === "OPEN")
    .first();
}

export async function openShift(
  cashierId: string,
  cashierName: string,
  openingCash: number,
): Promise<Shift> {
  if (!(openingCash >= 0) || !Number.isFinite(openingCash)) {
    throw new Error("Enter the opening cash in the drawer (zero or more).");
  }
  if (await getOpenShift(cashierId)) {
    throw new Error("You already have an open shift. Close it first.");
  }
  const total = await pharmaDb.shifts.count();
  const shift: Shift = {
    id: uid(),
    shiftNumber: `SH-${new Date().getFullYear()}-${String(total + 1).padStart(4, "0")}`,
    cashierId,
    cashierName,
    status: "OPEN",
    openedAt: now(),
    openingCash: round2(openingCash),
  };
  await pharmaDb.shifts.add(shift);
  return shift;
}

export async function computeShiftFigures(shift: Shift): Promise<ShiftFigures> {
  const to = shift.closedAt ?? now();
  const payments = await pharmaDb.payments
    .where("createdAt")
    .between(shift.openedAt, to, true, true)
    .filter((p) => p.status === "SUCCESS")
    .toArray();

  const saleIds = [...new Set(payments.map((p) => p.saleId))];
  const sales = (await pharmaDb.sales.bulkGet(saleIds)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );
  const saleById = new Map(sales.map((s) => [s.id, s] as const));

  let cashIn = 0;
  let cashRefunds = 0;
  const otherSales: Record<string, number> = {};
  const cashSaleIds = new Set<string>();

  for (const p of payments) {
    const sale = saleById.get(p.saleId);
    const owner = p.recordedBy ?? sale?.cashierId;
    if (owner !== shift.cashierId) continue;
    if (sale?.status === "VOIDED") continue; // cash handed back when a sale is voided
    if (p.method === "CASH") {
      if (p.amount >= 0) {
        cashIn += p.amount;
        cashSaleIds.add(p.saleId);
      } else {
        cashRefunds += -p.amount;
      }
    } else if (p.amount > 0) {
      otherSales[p.method] = round2((otherSales[p.method] ?? 0) + p.amount);
    }
  }
  // Payment rows hold the amount handed over; change given back left the drawer.
  let change = 0;
  for (const id of cashSaleIds) {
    const s = saleById.get(id);
    if (s) change += s.changeDue ?? 0;
  }
  const cashSales = round2(Math.max(0, cashIn - change));

  const moves = await pharmaDb.cashDrawerMovements.where("shiftId").equals(shift.id).toArray();
  const sum = (t: DrawerMovementType) =>
    round2(moves.filter((m) => m.type === t).reduce((n, m) => n + m.amount, 0));
  const deposits = sum("DEPOSIT");
  const withdrawals = sum("WITHDRAWAL");
  const expenses = sum("EXPENSE");

  return {
    cashSales,
    cashRefunds: round2(cashRefunds),
    deposits,
    withdrawals,
    expenses,
    salesCount: cashSaleIds.size,
    otherSales,
    expectedCash: round2(
      shift.openingCash + cashSales - cashRefunds + deposits - withdrawals - expenses,
    ),
  };
}

export async function addDrawerMovement(
  shiftId: string,
  type: DrawerMovementType,
  amount: number,
  reason: string,
  performedBy: string,
): Promise<CashDrawerMovement> {
  const shift = await pharmaDb.shifts.get(shiftId);
  if (!shift || shift.status !== "OPEN") throw new Error("This shift is closed.");
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero.");
  if (!reason.trim()) throw new Error("A reason is required for every cash movement.");
  const move: CashDrawerMovement = {
    id: uid(),
    shiftId,
    type,
    amount: round2(amount),
    reason: reason.trim(),
    performedBy,
    createdAt: now(),
  };
  await pharmaDb.cashDrawerMovements.add(move);
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: performedBy,
    action: `CASH_${type}`,
    entityType: "cashDrawer",
    entityId: shiftId,
    newValues: { amount: move.amount, reason: move.reason, shift: shift.shiftNumber },
    createdAt: now(),
  });
  return move;
}

export async function closeShift(
  shiftId: string,
  countedCash: number,
  closedBy: string,
  note?: string,
): Promise<Shift> {
  if (!(countedCash >= 0) || !Number.isFinite(countedCash)) {
    throw new Error("Enter the cash you counted in the drawer.");
  }
  const shift = await pharmaDb.shifts.get(shiftId);
  if (!shift || shift.status !== "OPEN") throw new Error("This shift is already closed.");
  const figures = await computeShiftFigures(shift);
  const variance = round2(countedCash - figures.expectedCash);
  if (variance !== 0 && !note?.trim()) {
    throw new Error("The count does not match. Add a note explaining the difference.");
  }
  const closed: Shift = {
    ...shift,
    status: "CLOSED",
    closedAt: now(),
    closedBy,
    expectedCash: figures.expectedCash,
    countedCash: round2(countedCash),
    variance,
    note: note?.trim() || undefined,
  };
  await pharmaDb.transaction("rw", [pharmaDb.shifts, pharmaDb.auditLogs], async () => {
    await pharmaDb.shifts.put(closed);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: closedBy,
      action: variance === 0 ? "SHIFT_CLOSE" : "SHIFT_CLOSE_VARIANCE",
      entityType: "shifts",
      entityId: shiftId,
      oldValues: { expectedCash: figures.expectedCash },
      newValues: { countedCash: closed.countedCash, variance, note: closed.note },
      createdAt: now(),
    });
  });
  return closed;
}
