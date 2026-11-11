import { pharmaDb } from "../db";
import { formatMoney, formatDate, formatDateTime, now } from "./utils";
import { round2 } from "./sales";
import { loadPaymentsServerConfig, remote } from "./payments/remote";
import { todayISO, addDaysISO, daysUntil, formatISO } from "./stock";
import { PAYMENT_METHODS, emptyMethodTotals } from "./payments/constants";
import { buildReorderSuggestions } from "./ai/inventory";
import { buildExpiryIntelligence } from "./ai/expiry";
import { buildForecast } from "./ai/forecast";
import { buildFinanceAnalysis } from "./ai/finance";
import { buildPaymentIntelligence } from "./ai/payments";
import { buildAnomalyDetection } from "./ai/anomaly";
import { buildSafetyIntelligence } from "./ai/safety";
import { buildManagementReport } from "./ai/report";
import { findMedicineProfile } from "./ai/knowledge";
import { findPatientSummary } from "./ai/patient";
import type {
  AnomalyItem,
  AssistantIntent,
  AssistantPayload,
  AssistantSource,
  AttentionSection,
  AuditLog,
  ControlRequisition,
  ControlledDrugCount,
  ControlledDrugRegisterEntry,
  Customer,
  CustomerPayment,
  DispensingRecord,
  DrugInteraction,
  Expense,
  FinanceAnalysis,
  ForecastOutcome,
  ManagementReport,
  Medicine,
  MedicineBarcode,
  MedicineBatch,
  MedicineKnowledgeProfile,
  MedicineWarning,
  Patient,
  PatientAllergy,
  PatientMedicalHistory,
  PatientSummary,
  Payment,
  PaymentConfirmation,
  PaymentIntelligence,
  PaymentMethod,
  PaymentTransaction,
  Prescription,
  PrescriptionItem,
  PurchaseOrder,
  PurchaseOrderItem,
  Refund,
  RefundItem,
  SafetyAlertCheck,
  SafetyIntelligence,
  Sale,
  SaleItem,
  StockMovement,
  Supplier,
  UserRecord,
} from "../types";

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface AssistantContext {
  currency: string;
  warningDays: number;
  medicines: Medicine[];
  batches: MedicineBatch[];
  suppliers: Supplier[];
  sales: Sale[];
  saleItems: SaleItem[];
  expenses: Expense[];
  patients: Patient[];
  prescriptions: Prescription[];
  dispensingRecords: DispensingRecord[];
  controlledDrugRegister: ControlledDrugRegisterEntry[];
  controlRequisitions: ControlRequisition[];
  controlledDrugCounts: ControlledDrugCount[];
  safetyAlertChecks: SafetyAlertCheck[];
  drugInteractions: DrugInteraction[];
  medicineWarnings: MedicineWarning[];
  refunds: Refund[];
  refundItems: RefundItem[];
  stockMovements: StockMovement[];
  auditLogs: AuditLog[];
  payments: Payment[];
  paymentTransactions: PaymentTransaction[];
  paymentConfirmations: PaymentConfirmation[];
  patientAllergies: PatientAllergy[];
  patientMedicalHistory: PatientMedicalHistory[];
  prescriptionItems: PrescriptionItem[];
  medicineBarcodes: MedicineBarcode[];
  users: UserRecord[];
  customers: Customer[];
  customerPayments: CustomerPayment[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderItems: PurchaseOrderItem[];
}

export async function loadAssistantContext(): Promise<AssistantContext> {
  const [
    settings,
    medicines,
    batches,
    suppliers,
    sales,
    saleItems,
    expenses,
    patients,
    prescriptions,
    dispensingRecords,
    controlledDrugRegister,
    controlRequisitions,
    controlledDrugCounts,
    safetyAlertChecks,
    drugInteractions,
    medicineWarnings,
    refunds,
    refundItems,
    stockMovements,
    auditLogs,
    payments,
    paymentTransactions,
    paymentConfirmations,
    patientAllergies,
    patientMedicalHistory,
    prescriptionItems,
    medicineBarcodes,
    users,
    customers,
    customerPayments,
    purchaseOrders,
    purchaseOrderItems,
  ] = await Promise.all([
    pharmaDb.systemSettings.toArray(),
    pharmaDb.medicines.toArray(),
    pharmaDb.medicineBatches.toArray(),
    pharmaDb.suppliers.toArray(),
    pharmaDb.sales.toArray(),
    pharmaDb.saleItems.toArray(),
    pharmaDb.expenses.toArray(),
    pharmaDb.patients.toArray(),
    pharmaDb.prescriptions.toArray(),
    pharmaDb.dispensingRecords.toArray(),
    pharmaDb.controlledDrugRegister.toArray(),
    pharmaDb.controlRequisitions.toArray(),
    pharmaDb.controlledDrugCounts.toArray(),
    pharmaDb.safetyAlertChecks.toArray(),
    pharmaDb.drugInteractions.toArray(),
    pharmaDb.medicineWarnings.toArray(),
    pharmaDb.refunds.toArray(),
    pharmaDb.refundItems.toArray(),
    pharmaDb.stockMovements.toArray(),
    pharmaDb.auditLogs.toArray(),
    pharmaDb.payments.toArray(),
    pharmaDb.paymentTransactions.toArray(),
    pharmaDb.paymentConfirmations.toArray(),
    pharmaDb.patientAllergies.toArray(),
    pharmaDb.patientMedicalHistory.toArray(),
    pharmaDb.prescriptionItems.toArray(),
    pharmaDb.medicineBarcodes.toArray(),
    pharmaDb.users.toArray(),
    pharmaDb.customers.toArray(),
    pharmaDb.customerPayments.toArray(),
    pharmaDb.purchaseOrders.toArray(),
    pharmaDb.purchaseOrderItems.toArray(),
  ]);
  const getSetting = (key: string) =>
    settings.find((s) => s.settingKey === key)?.settingValue;
  return {
    currency: getSetting("currency") ?? "UGX",
    warningDays: Number(getSetting("expiry_warning_days") ?? "60"),
    medicines,
    batches,
    suppliers,
    sales,
    saleItems,
    expenses,
    patients,
    prescriptions,
    dispensingRecords,
    controlledDrugRegister,
    controlRequisitions,
    controlledDrugCounts,
    safetyAlertChecks,
    drugInteractions,
    medicineWarnings,
    refunds,
    refundItems,
    stockMovements,
    auditLogs,
    payments,
    paymentTransactions,
    paymentConfirmations,
    patientAllergies,
    patientMedicalHistory,
    prescriptionItems,
    medicineBarcodes,
    users,
    customers,
    customerPayments,
    purchaseOrders,
    purchaseOrderItems,
  };
}

/* ------------------------------------------------------------------ */
/* Online (LLM) settings + orchestration                              */
/* ------------------------------------------------------------------ */

export const ASSISTANT_SETTING_KEYS = {
  apiUrl: "assistant_api_url",
  apiKey: "assistant_api_key",
  model: "assistant_model",
} as const;

export interface AssistantSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export async function loadAssistantSettings(): Promise<AssistantSettings> {
  const rows = await pharmaDb.systemSettings.toArray();
  const get = (k: string) =>
    rows.find((r) => r.settingKey === k)?.settingValue ?? "";
  return {
    apiUrl: get(ASSISTANT_SETTING_KEYS.apiUrl),
    apiKey: get(ASSISTANT_SETTING_KEYS.apiKey),
    model: get(ASSISTANT_SETTING_KEYS.model),
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantResponse {
  text: string;
  source: AssistantSource;
  intent?: AssistantIntent;
  payload?: AssistantPayload;
}

export async function askAssistant(
  question: string,
  ctx: AssistantContext,
  history: ChatTurn[],
): Promise<AssistantResponse> {
  // The UI appends the new question to the history; drop it so it is not sent twice.
  const last = history[history.length - 1];
  if (last && last.role === "user" && last.content === question) {
    history = history.slice(0, -1);
  }
  const offline = (): AssistantResponse => {
    const answer = answerQuestion(question, ctx);
    return {
      text: renderAnswer(answer),
      source: "OFFLINE",
      intent: answer.intent !== "FALLBACK" ? answer.intent : undefined,
      payload: answer.payload,
    };
  };

  // Offline engine is the always-on baseline: it runs on-device from local data.
  const connected = typeof navigator === "undefined" || navigator.onLine;
  if (!connected) return offline();

  // 1) Preferred online path: the PHARMA server holds the AI key (never in the app).
  const server = await loadPaymentsServerConfig();
  if (server) {
    try {
      const { text } = await remote.assistant(server, {
        question,
        snapshot: buildSummary(ctx),
        history: history.slice(-8),
      });
      if (text.trim()) return { text: text.trim(), source: "LLM" };
    } catch {
      /* AI not configured on server, or unreachable: fall through */
    }
  }

  // 2) Legacy: OpenAI-compatible endpoint configured directly in Settings.
  const settings = await loadAssistantSettings();
  if (settings.apiKey.trim().length > 0) {
    try {
      const text = await callLLM(question, ctx, history, settings);
      return { text, source: "LLM" };
    } catch {
      /* fall through */
    }
  }
  return offline();
}

async function callLLM(
  question: string,
  ctx: AssistantContext,
  history: ChatTurn[],
  settings: AssistantSettings,
): Promise<string> {
  const baseUrl = (
    settings.apiUrl.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const summary = buildSummary(ctx);
  const messages = [
    {
      role: "system",
      content:
        "You are the AI assistant for PHARMA, a pharmacy management system. " +
        "Answer the manager in clear, concise natural language. Base your answer " +
        "ONLY on the business snapshot provided and the conversation history. " +
        "Do not invent numbers that are not in the snapshot. If the answer is not " +
        "in the snapshot, say so and suggest what the manager could ask instead. " +
        "Use the local currency shown. Prefer short paragraphs and simple bullets " +
        "where helpful.\n\n" +
        summary,
    },
    ...history.slice(-8),
    { role: "user", content: question },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: settings.model.trim() || "gpt-4o-mini",
        messages,
        temperature: 0.4,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM request failed (${res.status})`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("LLM returned an empty response");
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

function buildSummary(ctx: AssistantContext): string {
  const snap = snapshot(ctx);
  const money = (v: number) => formatMoney(v, ctx.currency);
  const lines: string[] = [];
  lines.push(`PHARMA business snapshot (generated ${formatDateTime(now())})`);
  lines.push(
    `- Revenue: today ${money(snap.todayRev)} from ${snap.todayCount} sale(s); last 7 days ${money(snap.weekRev)}; this month ${money(snap.monthRev)} vs ${money(snap.prevMonthRev)} last month.`,
  );
  lines.push(
    `- Top sellers (30d): ${snap.topSellers
      .map((s) => `${s.name} (${s.units} units, ${money(s.revenue)})`)
      .join("; ") || "none"}.`,
  );
  lines.push(
    `- Stock: ${snap.out} out of stock, ${snap.lowList.length} low${snap.lowList.length ? ` (${snap.lowList.slice(0, 6).map((l) => `${l.name}: ${l.qty} left`).join(", ")})` : ""}; stock value ${money(snap.stockSale)}.`,
  );
  const reorders = buildReorderSuggestions(ctx);
  if (reorders.length > 0) {
    lines.push(
      `- Reorder recommendations (${reorders.length}): ${reorders.slice(0, 6).map((r) => `${r.medicineName} (${r.currentStock} left, order ${r.recommendedQty})`).join("; ")}.`,
    );
  }
  lines.push(
    `- Expiry: ${snap.expired.length} expired, ${snap.expiring.length} expiring within ${ctx.warningDays} days${snap.expiring.length ? ` (${snap.expiring.slice(0, 5).map((e) => `${e.name} ${formatISO(e.expiryDate)}`).join(", ")})` : ""}.`,
  );
  const expiryRisk = buildExpiryIntelligence(ctx);
  const atRiskExpiry = expiryRisk.filter((i) => i.atRisk);
  if (atRiskExpiry.length > 0) {
    lines.push(
      `- Expiry risk: ${atRiskExpiry.length} batch(es) unlikely to sell before expiry, estimated ${money(atRiskExpiry.reduce((sum, i) => sum + i.costAtRisk, 0))} at risk (${atRiskExpiry.slice(0, 5).map((i) => `${i.medicineName} ${formatISO(i.expiryDate)} ~${i.likelyLeftover} unsold`).join("; ")}).`,
    );
  }
  lines.push(
    `- Patients: ${snap.patients} total (${snap.newPatients} new this month); prescriptions: ${snap.rxTotal} total (${snap.rxDispensed} dispensed, ${snap.rxPending} pending).`,
  );
  lines.push(
    `- Controlled drugs: ${snap.cdrMeds} CDR medicine(s), ${snap.registerEntries} register entries, ${snap.cdrVariances} open variance count(s), ${snap.openRequisitions} open requisition(s).`,
  );
  lines.push(
    `- Safety: ${snap.checks} check(s), ${snap.overrides} override(s), ${snap.warns} warning(s), ${snap.interactions} interaction rule(s) defined.`,
  );
  lines.push(
    `- Payments: ${snap.pendingSales} pending totaling ${money(snap.pendingTotal)}.`,
  );
  lines.push(
    `- Expenses: ${money(snap.monthExpenses)} this month vs ${money(snap.prevMonthExpenses)} last month.`,
  );
  const forecast = buildForecast(ctx);
  const atRiskForecast = forecast.items.filter((f) => f.stockoutRisk);
  if (atRiskForecast.length > 0) {
    lines.push(
      `- Demand forecast (next ${forecast.horizonDays}d): ${atRiskForecast.slice(0, 5).map((f) => `${f.medicineName} (${f.predicted30} predicted, ${f.currentStock} in stock)`).join("; ")} may run out.`,
    );
  }
  const finance = buildFinanceAnalysis(ctx);
  lines.push(
    `- Finance: ${money(finance.monthRevenue)} this month vs ${money(finance.prevRevenue)} last month${finance.revenueDeltaPct === null ? "" : ` (${finance.revenueDeltaPct > 0 ? "+" : ""}${finance.revenueDeltaPct}%)`}; gross ${money(finance.grossProfit)}, net ${money(finance.netProfit)}.`,
  );
  const anomalies = buildAnomalyDetection(ctx);
  if (anomalies.length > 0) {
    lines.push(
      `- Anomaly scan: ${anomalies.slice(0, 4).map((a) => `${a.category}: ${a.title}`).join("; ")}.`,
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Derived snapshot                                                    */
/* ------------------------------------------------------------------ */

interface ExpiryItem {
  batchId: string;
  medicineId: string;
  name: string;
  batchNumber: string;
  qty: number;
  expiryDate: string;
  days: number;
  cost: number;
}

interface Snapshot {
  todayRev: number;
  todayCount: number;
  yesterdayRev: number;
  weekRev: number;
  weekCount: number;
  monthRev: number;
  monthCount: number;
  prevMonthRev: number;
  prev7Rev: number;
  bestDay: { key: string; label: string; rev: number } | null;
  slowestDay: { key: string; label: string; rev: number } | null;
  topSellers: Array<{
    name: string;
    units: number;
    revenue: number;
    profit: number;
  }>;
  out: number;
  lowList: Array<{ name: string; qty: number; reorderLevel: number }>;
  expired: ExpiryItem[];
  expiring: ExpiryItem[];
  stockCost: number;
  stockSale: number;
  stockProducts: number;
  cdrMeds: number;
  registerEntries: number;
  cdrVariances: number;
  openRequisitions: number;
  overrides: number;
  warns: number;
  checks: number;
  interactions: number;
  warnings: number;
  pendingSales: number;
  pendingTotal: number;
  methodTotals: Record<PaymentMethod, number>;
  patients: number;
  newPatients: number;
  rxTotal: number;
  rxPending: number;
  rxDispensed: number;
  dispensedToday: number;
  monthExpenses: number;
  prevMonthExpenses: number;
  monthExpenseCount: number;
  topExpenseCategory: { label: string; amount: number } | null;
}

function labelOf(key: string): string {
  const [, m, d] = key.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

const EXPENSE_LABELS: Record<string, string> = {
  RENT: "Rent",
  SALARIES: "Salaries",
  UTILITIES: "Utilities",
  SUPPLIES: "Supplies",
  EQUIPMENT: "Equipment",
  MAINTENANCE: "Maintenance",
  TRANSPORT: "Transport",
  MARKETING: "Marketing",
  OTHER: "Other",
};

function snapshot(ctx: AssistantContext): Snapshot {
  const today = todayISO();
  const [year, monthNum] = today.split("-").map(Number);
  const curMonth = today.slice(0, 7);
  const prev = new Date(year, monthNum - 2, 1);
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

  const completed = ctx.sales.filter((s) => s.status === "COMPLETED");
  const itemsBySale = new Map<string, SaleItem[]>();
  for (const item of ctx.saleItems) {
    const list = itemsBySale.get(item.saleId);
    if (list) list.push(item);
    else itemsBySale.set(item.saleId, [item]);
  }
  const revOf = (list: Sale[]) =>
    round2(list.reduce((sum, s) => sum + s.total, 0));

  const todaySales = completed.filter((s) => s.saleDateKey === today);
  const yesterdaySales = completed.filter(
    (s) => s.saleDateKey === addDaysISO(-1),
  );
  const weekStart = addDaysISO(-6);
  const weekSales = completed.filter((s) => s.saleDateKey >= weekStart);
  const monthSales = completed.filter(
    (s) => s.saleDateKey.slice(0, 7) === curMonth,
  );
  const prevMonthSales = completed.filter(
    (s) => s.saleDateKey.slice(0, 7) === prevMonth,
  );

  const dayAgg = new Map<string, number>();
  for (const s of weekSales) {
    dayAgg.set(s.saleDateKey, (dayAgg.get(s.saleDateKey) ?? 0) + s.total);
  }
  const dayList = [...dayAgg.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const best = dayList.length
    ? dayList.reduce((a, b) => (b[1] > a[1] ? b : a))
    : null;
  const slowest = dayList.length
    ? dayList.reduce((a, b) => (b[1] < a[1] ? b : a))
    : null;
  const toDay = (d: [string, number] | null) =>
    d ? { key: d[0], label: labelOf(d[0]), rev: round2(d[1]) } : null;

  const prev7Start = addDaysISO(-13);
  const prevWeekStart = addDaysISO(-7);
  const prev7Rev = revOf(
    completed.filter(
      (s) => s.saleDateKey >= prev7Start && s.saleDateKey < prevWeekStart,
    ),
  );

  const threshold = addDaysISO(-29);
  const medName = new Map(ctx.medicines.map((m) => [m.id, m.name]));
  const sellerMap = new Map<
    string,
    { units: number; revenue: number; profit: number }
  >();
  for (const s of completed) {
    if (s.saleDateKey < threshold) continue;
    for (const item of itemsBySale.get(s.id) ?? []) {
      const cur = sellerMap.get(item.medicineId) ?? {
        units: 0,
        revenue: 0,
        profit: 0,
      };
      cur.units += item.quantity;
      cur.revenue += item.lineTotal;
      cur.profit += (item.unitPrice - item.costPrice) * item.quantity;
      sellerMap.set(item.medicineId, cur);
    }
  }
  const topSellers = [...sellerMap.entries()]
    .map(([id, v]) => ({
      name: medName.get(id) ?? "Unknown",
      units: v.units,
      revenue: round2(v.revenue),
      profit: round2(v.profit),
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);

  const stockByMedicine = new Map<string, number>();
  const usableBatches = ctx.batches.filter(
    (b) => b.quantityRemaining > 0 && b.expiryDate >= today,
  );
  for (const b of usableBatches) {
    stockByMedicine.set(
      b.medicineId,
      (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
    );
  }

  let out = 0;
  const lowList: Array<{ name: string; qty: number; reorderLevel: number }> =
    [];
  for (const med of ctx.medicines) {
    if (med.status !== "ACTIVE") continue;
    const qty = stockByMedicine.get(med.id) ?? 0;
    if (qty === 0) out += 1;
    else if (med.reorderLevel > 0 && qty <= med.reorderLevel) {
      lowList.push({ name: med.name, qty, reorderLevel: med.reorderLevel });
    }
  }
  lowList.sort((a, b) => a.qty - b.qty);

  const expired: ExpiryItem[] = [];
  const expiring: ExpiryItem[] = [];
  for (const b of ctx.batches) {
    if (b.quantityRemaining <= 0) continue;
    const d = daysUntil(b.expiryDate);
    const item: ExpiryItem = {
      batchId: b.id,
      medicineId: b.medicineId,
      name: medName.get(b.medicineId) ?? "Unknown",
      batchNumber: b.batchNumber,
      qty: b.quantityRemaining,
      expiryDate: b.expiryDate,
      days: d,
      cost: b.quantityRemaining * b.purchasePrice,
    };
    if (d < 0) expired.push(item);
    else if (d <= ctx.warningDays) expiring.push(item);
  }
  expired.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  expiring.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  let stockCost = 0;
  let stockSale = 0;
  for (const b of usableBatches) {
    stockCost += b.quantityRemaining * b.purchasePrice;
    stockSale += b.quantityRemaining * b.sellingPrice;
  }

  const cdrMeds = ctx.medicines.filter(
    (m) => m.controlCategory === "CDR",
  ).length;
  const cdrVariances = ctx.controlledDrugCounts.filter(
    (c) => c.status === "VARIANCE",
  ).length;
  const openRequisitions = ctx.controlRequisitions.filter(
    (r) => r.status === "PENDING",
  ).length;
  const overrides = ctx.safetyAlertChecks.filter(
    (c) => c.outcome === "OVERRIDE",
  ).length;
  const warns = ctx.safetyAlertChecks.filter(
    (c) => c.outcome === "WARN",
  ).length;

  const pendingSales = ctx.sales.filter(
    (s) => s.status === "PENDING_PAYMENT" && s.paymentStatus !== "SUCCESS",
  );
  const pendingTotal = round2(
    pendingSales.reduce((sum, s) => sum + s.total, 0),
  );

  const methodTotals = emptyMethodTotals();
  const methodThreshold = addDaysISO(-6);
  for (const s of completed) {
    if (s.saleDateKey < methodThreshold) continue;
    methodTotals[s.paymentMethod] += s.total;
  }

  const monthStartTs = new Date(year, monthNum - 1, 1).getTime();
  const newPatients = ctx.patients.filter((p) => p.createdAt >= monthStartTs)
    .length;

  const rxDispensed = ctx.prescriptions.filter(
    (p) => p.status === "DISPENSED",
  ).length;
  const rxPending = ctx.prescriptions.filter(
    (p) => p.status === "PENDING",
  ).length;
  const dispensedToday = ctx.dispensingRecords.filter(
    (d) => d.dispensedAt >= startOfToday(),
  ).length;

  const monthExpenses = ctx.expenses.filter(
    (e) => e.expenseDateKey.slice(0, 7) === curMonth,
  );
  const prevMonthExpenses = ctx.expenses.filter(
    (e) => e.expenseDateKey.slice(0, 7) === prevMonth,
  );
  const monthExpenseTotal = round2(
    monthExpenses.reduce((sum, e) => sum + e.amount, 0),
  );
  const prevMonthExpenseTotal = round2(
    prevMonthExpenses.reduce((sum, e) => sum + e.amount, 0),
  );
  const byCat = new Map<string, number>();
  for (const e of monthExpenses) {
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  }
  let topExpenseCategory: { label: string; amount: number } | null = null;
  for (const [cat, amount] of byCat) {
    if (!topExpenseCategory || amount > topExpenseCategory.amount) {
      topExpenseCategory = {
        label: EXPENSE_LABELS[cat] ?? cat,
        amount: round2(amount),
      };
    }
  }

  return {
    todayRev: revOf(todaySales),
    todayCount: todaySales.length,
    yesterdayRev: revOf(yesterdaySales),
    weekRev: revOf(weekSales),
    weekCount: weekSales.length,
    monthRev: revOf(monthSales),
    monthCount: monthSales.length,
    prevMonthRev: revOf(prevMonthSales),
    prev7Rev,
    bestDay: toDay(best),
    slowestDay: toDay(slowest),
    topSellers,
    out,
    lowList,
    expired,
    expiring,
    stockCost: round2(stockCost),
    stockSale: round2(stockSale),
    stockProducts: usableBatches.length
      ? new Set(usableBatches.map((b) => b.medicineId)).size
      : 0,
    cdrMeds,
    registerEntries: ctx.controlledDrugRegister.length,
    cdrVariances,
    openRequisitions,
    overrides,
    warns,
    checks: ctx.safetyAlertChecks.length,
    interactions: ctx.drugInteractions.length,
    warnings: ctx.medicineWarnings.length,
    pendingSales: pendingSales.length,
    pendingTotal,
    methodTotals,
    patients: ctx.patients.length,
    newPatients,
    rxTotal: ctx.prescriptions.length,
    rxPending,
    rxDispensed,
    dispensedToday,
    monthExpenses: monthExpenseTotal,
    prevMonthExpenses: prevMonthExpenseTotal,
    monthExpenseCount: monthExpenses.length,
    topExpenseCategory,
  };
}

function startOfToday(): number {
  const [y, m, d] = todayISO().split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function money(v: number, currency: string): string {
  return formatMoney(round2(v), currency);
}

/* ------------------------------------------------------------------ */
/* Offline intent engine                                               */
/* ------------------------------------------------------------------ */

export interface AssistantAnswer {
  intent: AssistantIntent | "FALLBACK";
  title: string;
  text: string;
  bullets?: string[];
  payload?: AssistantPayload;
}

const INTENT_KEYWORDS: Record<AssistantIntent, string[]> = {
  BRIEFING: [
    "briefing",
    "overview",
    "summary",
    "health check",
    "how are we doing",
    "what's going on",
    "status report",
    "recap",
    "rundown",
    "highlights",
  ],
  REVENUE: [
    "revenue",
    "income",
    "earned",
    "earnings",
    "turnover",
    "sales today",
    "sold today",
    "how much did we sell",
    "how much have we sold",
    "how are sales",
    "profit",
    "margin",
    "yesterday",
  ],
  TOP_SELLERS: [
    "top seller",
    "best seller",
    "best selling",
    "top selling",
    "top product",
    "best product",
    "most sold",
    "fast mover",
    "fastest moving",
    "top performers",
  ],
  LOW_STOCK: [
    "low stock",
    "out of stock",
    "running low",
    "stock level",
    "low on",
    "insufficient stock",
    "below reorder",
    "need restocking",
  ],
  EXPIRY: ["expir", "near expiry", "shelf life"],
  EXPIRY_RISK: [
    "unlikely to sell",
    "before expiry",
    "before it sells",
    "expire before",
    "expiry risk",
    "risk of expiry",
    "waste",
    "wasted",
    "go to waste",
    "sell before",
    "expire unsold",
    "leftover",
  ],
  STOCK_VALUE: [
    "stock value",
    "value of stock",
    "inventory value",
    "stock worth",
    "total stock",
  ],
  PATIENTS: ["patient", "clients", "patient summary", "patient history", "show me patient", "patient balance", "outstanding balance"],
  PRESCRIPTIONS: ["prescription", "dispens", "prescribed"],
  CONTROLLED: [
    "controlled",
    "cdr",
    "drug register",
    "register balance",
    "controlled substance",
    "restricted drug",
    "variance",
  ],
  SAFETY: [
    "safety",
    "interaction",
    "allergy",
    "override",
    "adverse",
    "contraindication",
  ],
  PAYMENTS: [
    "payment",
    "pending",
    "credit",
    "cash",
    "mobile money",
    "unpaid",
    "owing",
    "receivable",
    "reconcil",
    "unmatched",
    "failed",
    "declined",
    "refund",
  ],
  EXPENSES: ["expense", "spending", "spent", "costs", "bills", "overhead"],
  SALES_TREND: [
    "trend",
    "compared",
    "vs last",
    "versus",
    "improving",
    "declining",
    "week on week",
    "month on month",
    "over time",
    "performance",
  ],
  ATTENTION: [
    "attention",
    "what needs",
    "priorities",
    "action items",
    "action needed",
    "action required",
    "urgent",
    "flag",
    "concern",
    "morning brief",
    "good morning",
    "what should i look at",
    "what should i focus on",
    "start of day",
  ],
  REORDER: [
    "reorder",
    "restock",
    "replenish",
    "what should i order",
    "what do i need to order",
    "what to order",
    "purchase order",
    "order more",
    "stock up",
  ],
  FORECAST: [
    "forecast",
    "predict",
    "future demand",
    "demand for",
    "when will",
    "how long will",
    "run out",
    "sell out",
    "projected",
    "estimate demand",
    "upcoming demand",
    "stockout",
  ],
  FINANCE: [
    "why is revenue",
    "why did revenue",
    "why are sales",
    "why is profit",
    "why did profit",
    "why is business",
    "financial analysis",
    "profitability",
    "explain the drop",
    "explain the increase",
    "why did we",
    "reason for",
    "drivers",
  ],
  KNOWLEDGE: [
    "tell me about",
    "know about",
    "medicine profile",
    "drug profile",
    "information on",
    "info on",
    "knowledge base",
    "what is it used for",
    "interactions for",
    "warnings for",
    "about the medicine",
    "about this medicine",
  ],
  ANOMALY: [
    "anomal",
    "unusual",
    "suspicious",
    "detect",
    "odd activity",
    "abnormal",
    "audit trail",
    "audit",
    "red flag",
    "irregular",
    "fraud",
    "pattern",
    "outside normal",
    "spike",
  ],
  REPORT: [
    "report",
    "generate",
    "monthly",
    "annual report",
    "management report",
    "financial report",
    "sales report",
    "compliance report",
    "write a report",
  ],
  HELP: ["help", "what can you do", "how do you work", "what should i ask", "examples"],
};

const INTENT_ORDER: AssistantIntent[] = [
  "FORECAST",
  "FINANCE",
  "KNOWLEDGE",
  "ANOMALY",
  "REORDER",
  "REPORT",
  "TOP_SELLERS",
  "LOW_STOCK",
  "EXPIRY_RISK",
  "EXPIRY",
  "CONTROLLED",
  "SAFETY",
  "PRESCRIPTIONS",
  "PATIENTS",
  "PAYMENTS",
  "EXPENSES",
  "REVENUE",
  "SALES_TREND",
  "STOCK_VALUE",
  "ATTENTION",
  "BRIEFING",
  "HELP",
];

export function detectIntent(text: string): AssistantIntent | null {
  const t = text.toLowerCase();
  let best: AssistantIntent | null = null;
  let bestScore = 0;
  for (const intent of INTENT_ORDER) {
    let score = 0;
    for (const kw of INTENT_KEYWORDS[intent]) {
      if (t.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function answerQuestion(
  question: string,
  ctx: AssistantContext,
): AssistantAnswer {
  const intent = detectIntent(question);
  if (!intent) return fallbackAnswer();
  const snap = snapshot(ctx);
  switch (intent) {
    case "BRIEFING":
      return briefingAnswer(snap, ctx);
    case "REVENUE":
      return revenueAnswer(snap, ctx);
    case "TOP_SELLERS":
      return topSellersAnswer(snap, ctx);
    case "LOW_STOCK":
      return lowStockAnswer(snap);
    case "EXPIRY":
      return expiryAnswer(snap, ctx);
    case "EXPIRY_RISK":
      return expiryRiskAnswer(ctx);
    case "STOCK_VALUE":
      return stockValueAnswer(snap, ctx);
    case "PATIENTS": {
      const specific = patientSummaryAnswer(question, ctx);
      return specific ?? patientsAnswer(snap, ctx);
    }
    case "PRESCRIPTIONS":
      return prescriptionsAnswer(snap);
    case "CONTROLLED":
      return controlledAnswer(snap, ctx);
    case "SAFETY":
      return safetyAnswer(snap, ctx);
    case "PAYMENTS":
      return paymentsAnswer(snap, ctx);
    case "EXPENSES":
      return expensesAnswer(snap, ctx);
    case "SALES_TREND":
      return salesTrendAnswer(snap, ctx);
    case "ATTENTION":
      return attentionAnswer(snap, ctx);
    case "REORDER":
      return reorderAnswer(ctx);
    case "FORECAST":
      return forecastAnswer(ctx);
    case "FINANCE":
      return financeAnswer(ctx);
    case "KNOWLEDGE":
      return knowledgeAnswer(question, ctx);
    case "ANOMALY":
      return anomalyAnswer(ctx);
    case "REPORT":
      return reportAnswer(ctx);
    case "HELP":
      return helpAnswer();
  }
}

function revenueAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const vsYest =
    snap.todayCount === 0 && snap.yesterdayRev === 0
      ? ""
      : `, versus ${m(snap.yesterdayRev)} yesterday`;
  const monthDelta = deltaPct(snap.monthRev, snap.prevMonthRev);
  return {
    intent: "REVENUE",
    title: "Revenue snapshot",
    text: `Today you have taken ${m(snap.todayRev)} across ${snap.todayCount} confirmed sale(s)${vsYest}. Over the last 7 days that is ${m(snap.weekRev)} from ${snap.weekCount} sales. This month totals ${m(snap.monthRev)} compared with ${m(snap.prevMonthRev)} last month${monthDelta === null ? "" : ` (${monthDelta > 0 ? "+" : ""}${monthDelta}%)`}.`,
  };
}

function topSellersAnswer(
  snap: Snapshot,
  ctx: AssistantContext,
): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  if (snap.topSellers.length === 0) {
    return {
      intent: "TOP_SELLERS",
      title: "Top sellers",
      text: "There are no product sales in the last 30 days to rank yet.",
    };
  }
  return {
    intent: "TOP_SELLERS",
    title: "Top sellers (last 30 days)",
    text: "Here are the best sellers by units sold:",
    bullets: snap.topSellers.map(
      (s) =>
        `• ${s.name} — ${s.units} unit(s), ${m(s.revenue)} revenue (${m(s.profit)} gross profit)`,
    ),
  };
}

function lowStockAnswer(snap: Snapshot): AssistantAnswer {
  if (snap.out === 0 && snap.lowList.length === 0) {
    return {
      intent: "LOW_STOCK",
      title: "Stock levels",
      text: "Stock levels look healthy — no active medicines are out of stock or at/below their reorder level.",
    };
  }
  return {
    intent: "LOW_STOCK",
    title: "Stock watch",
    text: `${snap.out} medicine(s) are completely out of stock and ${snap.lowList.length} are at or below their reorder level.`,
    bullets: [
      ...(snap.lowList.length
        ? snap.lowList.slice(0, 8).map(
            (l) => `• ${l.name} — ${l.qty} left (reorder level ${l.reorderLevel})`,
          )
        : []),
      ...(snap.out > 0
        ? ["• Review the out-of-stock list on the Inventory page and prioritize restocking."]
        : []),
    ],
  };
}

function expiryAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const atRisk = [...snap.expired, ...snap.expiring];
  const riskCost = round2(atRisk.reduce((sum, e) => sum + e.cost, 0));
  if (atRisk.length === 0) {
    return {
      intent: "EXPIRY",
      title: "Expiry check",
      text: `No batches are expired or expiring within the next ${ctx.warningDays} days.`,
    };
  }
  return {
    intent: "EXPIRY",
    title: "Expiry watch",
    text: `${snap.expired.length} batch(es) have already expired and ${snap.expiring.length} will expire within ${ctx.warningDays} days. Estimated cost value at risk: ${m(riskCost)}.`,
    bullets: atRisk.slice(0, 8).map(
      (e) =>
        `• ${e.name} (batch ${e.batchNumber}) — ${e.qty} units, ${formatISO(e.expiryDate)}${e.days < 0 ? " (expired)" : ` (${e.days}d)`}`,
    ),
  };
}

function expiryRiskAnswer(ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const items = buildExpiryIntelligence(ctx);
  const atRisk = items.filter((i) => i.atRisk);
  const severe = atRisk.filter((i) => i.severity === "SEVERE");
  const riskCost = round2(atRisk.reduce((sum, i) => sum + i.costAtRisk, 0));

  if (atRisk.length === 0) {
    return {
      intent: "EXPIRY_RISK",
      title: "Expiry intelligence",
      text: "No batches are expected to go unsold before their expiry date at current sales rates.",
    };
  }

  return {
    intent: "EXPIRY_RISK",
    title: "Expiry intelligence",
    text: `${atRisk.length} batch(es) are unlikely to sell through before expiry at current sales rates — an estimated ${m(riskCost)} of stock could go to waste.${
      severe.length > 0
        ? ` ${severe.length} need immediate action (expiring within 30 days).`
        : ""
    } I can only recommend actions — dispensing and stock changes stay with you.`,
    bullets: atRisk
      .slice(0, 6)
      .map(
        (i) =>
          `• ${i.medicineName} (batch ${i.batchNumber}) — ${i.quantity} units, ${formatISO(i.expiryDate)} (${i.days}d left), ~${i.likelyLeftover} likely unsold`,
      ),
    payload: { expiry: atRisk, currency: ctx.currency },
  };
}

function stockValueAnswer(
  snap: Snapshot,
  ctx: AssistantContext,
): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  return {
    intent: "STOCK_VALUE",
    title: "Inventory value",
    text: `Saleable inventory is currently valued at ${m(snap.stockSale)} at selling price (${m(snap.stockCost)} at cost) across ${snap.stockProducts} product(s). Beyond that, ${snap.expired.length} batch(es) are already expired and ${snap.expiring.length} more are expiring within ${ctx.warningDays} days.`,
  };
}

function patientsAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const recent = [...ctx.patients]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
    .map((p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "));
  return {
    intent: "PATIENTS",
    title: "Patients",
    text: `You have ${snap.patients} registered patient(s), with ${snap.newPatients} added this month.${
      recent.length ? ` Most recent registrations: ${recent.join(", ")}.` : ""
    } Ask me about a specific patient for a full summary.`,
    bullets:
      recent.length > 0
        ? recent.map((n) => `• ${n}`)
        : undefined,
  };
}

function patientSummaryAnswer(
  question: string,
  ctx: AssistantContext,
): AssistantAnswer | null {
  const stripped = question
    .replace(
      /show me|summarize|summary of|summary|give me|patient|profile|about|for|the|of|please/gi,
      "",
    )
    .replace(/[?.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary: PatientSummary | null = findPatientSummary(ctx, stripped);
  if (!summary) return null;
  const m = (v: number) => money(v, ctx.currency);
  return {
    intent: "PATIENTS",
    title: `${summary.name} — patient summary`,
    text: `${summary.name}${summary.age != null ? ` (age ${summary.age})` : ""} is ${summary.status.toLowerCase()}. ${summary.allergies.length} recorded allergen(s)${summary.allergies.length ? `: ${summary.allergies.map((a) => a.allergen).join(", ")}` : ""}. ${summary.rxTotal} prescription(s) total, ${summary.rxPending} pending; ${summary.dispensingTotal} dispensing record(s), ${summary.dispensingRecent} in the last 7 days. Outstanding balance: ${m(summary.balanceDue)}.`,
    bullets: summary.rxRecent.map(
      (rx) =>
        `• ${rx.prescriptionNumber} (${formatDate(rx.date)}) — ${rx.items.join(", ") || "no items"}`,
    ),
    payload: { patients: [summary], currency: ctx.currency },
  };
}

function prescriptionsAnswer(snap: Snapshot): AssistantAnswer {
  const cancelled = snap.rxTotal - snap.rxDispensed - snap.rxPending;
  return {
    intent: "PRESCRIPTIONS",
    title: "Prescriptions",
    text: `${snap.rxTotal} prescription(s) in total — ${snap.rxDispensed} dispensed, ${snap.rxPending} still pending and ${cancelled} cancelled. ${snap.dispensedToday} dispensing record(s) were created today.`,
  };
}

function controlledAnswer(
  snap: Snapshot,
  ctx: AssistantContext,
): AssistantAnswer {
  const variances = ctx.controlledDrugCounts.filter(
    (c) => c.status === "VARIANCE",
  );
  const medName = new Map(ctx.medicines.map((x) => [x.id, x.name]));
  const batchName = new Map(
    ctx.batches.map((b) => [b.id, b.batchNumber] as const),
  );
  if (snap.cdrMeds === 0) {
    return {
      intent: "CONTROLLED",
      title: "Controlled medicines",
      text: "No controlled (CDR) medicines are registered yet.",
    };
  }
  return {
    intent: "CONTROLLED",
    title: "Controlled medicines",
    text: `${snap.cdrMeds} controlled medicine(s) are on the CDR register with ${snap.registerEntries} register entr(y/ies). ${snap.cdrVariances} open count variance(s) and ${snap.openRequisitions} open requisition(s) need attention.`,
    bullets:
      variances.length > 0
        ? variances.slice(0, 5).map((c) => {
            const med = medName.get(c.medicineId) ?? "Unknown";
            const batch = batchName.get(c.batchId) ?? "batch";
            return `• ${med} (${batch}) — register ${c.registerBalance} vs counted ${c.countedBalance} (variance ${c.variance})`;
          })
        : undefined,
  };
}

function safetyAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const si: SafetyIntelligence = buildSafetyIntelligence(ctx);
  return {
    intent: "SAFETY",
    title: "Drug safety",
    text: `${snap.checks} safety check(s) recorded — ${snap.overrides} override(s) and ${snap.warns} warning(s). ${si.allergyPatients} patient(s) carry recorded allergies. ${snap.interactions} interaction rule(s) and ${snap.warnings} medicine warning(s) are defined to guard dispensing.`,
    bullets: si.overridesRecent.map(
      (o) =>
        `• ${o.checkType} override on ${formatDate(o.at)} — ${o.reason}`,
    ),
    payload: { safety: si, currency: ctx.currency },
  };
}

function paymentsAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const pi: PaymentIntelligence = buildPaymentIntelligence(ctx);
  const top = [...PAYMENT_METHODS]
    .map((p) => ({ p, total: snap.methodTotals[p.value] }))
    .sort((a, b) => b.total - a.total)[0];
  const mix =
    top && top.total > 0
      ? ` ${top.p.shortLabel} leads the last 7 days at ${m(top.total)}`
      : " no payments recorded in the last 7 days";
  const issues: string[] = [];
  if (pi.failedCount > 0) issues.push(`${pi.failedCount} failed/declined`);
  if (pi.unmatched.length > 0) issues.push(`${pi.unmatched.length} unmatched`);
  if (pi.refunds30Count > 0) issues.push(`${pi.refunds30Count} refund(s) in 30d`);
  return {
    intent: "PAYMENTS",
    title: "Payment intelligence",
    text:
      pi.pendingSales.length === 0
        ? `No sales are awaiting payment confirmation right now.${mix}.`
        : `${pi.pendingSales.length} sale(s) are waiting on payment confirmation, totalling ${m(pi.pendingTotal)}.${mix}.`,
    bullets: issues.length
      ? issues.map((i) => `• ${i}`)
      : undefined,
    payload: { payments: pi, currency: ctx.currency },
  };
}

function expensesAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const delta = deltaPct(snap.monthExpenses, snap.prevMonthExpenses);
  return {
    intent: "EXPENSES",
    title: "Expenses",
    text: `You recorded ${m(snap.monthExpenses)} in expenses this month across ${snap.monthExpenseCount} entry(ies), compared with ${m(snap.prevMonthExpenses)} last month${delta === null ? "" : ` (${delta > 0 ? "+" : ""}${delta}%)`}.${
      snap.topExpenseCategory
        ? ` The largest category is ${snap.topExpenseCategory.label} at ${m(snap.topExpenseCategory.amount)}.`
        : ""
    }`,
  };
}

function salesTrendAnswer(
  snap: Snapshot,
  ctx: AssistantContext,
): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  if (snap.weekCount === 0) {
    return {
      intent: "SALES_TREND",
      title: "Sales trend",
      text: "There are no completed sales in the last 7 days to chart yet.",
    };
  }
  const delta = deltaPct(snap.weekRev, snap.prev7Rev);
  return {
    intent: "SALES_TREND",
    title: "Sales trend",
    text: `The last 7 days generated ${m(snap.weekRev)} from ${snap.weekCount} sales. Your strongest day was ${snap.bestDay?.label} (${m(snap.bestDay?.rev ?? 0)}) and the slowest was ${snap.slowestDay?.label} (${m(snap.slowestDay?.rev ?? 0)}). Compared with the previous 7 days that is ${delta === null ? "no prior baseline" : `${delta > 0 ? "+" : ""}${delta}%`}.`,
  };
}

function reorderAnswer(ctx: AssistantContext): AssistantAnswer {
  const reorders = buildReorderSuggestions(ctx);
  if (reorders.length === 0) {
    return {
      intent: "REORDER",
      title: "Reorder recommendations",
      text: "No medicines need reordering right now — stock levels and expected demand are healthy.",
    };
  }
  const out = reorders.filter((r) => r.currentStock === 0);
  return {
    intent: "REORDER",
    title: "Reorder recommendations",
    text: `I recommend reordering ${reorders.length} medicine(s). ${
      out.length > 0 ? `${out.length} are out of stock` : "A few are running low"
    } and expected daily demand suggests restocking soon. Each suggestion includes a suggested quantity and supplier — tap "Create PO" to draft a purchase order for review.`,
    bullets: reorders.slice(0, 6).map((r) => {
      const est = r.daysToOut === null ? "no recent sales" : `~${r.daysToOut} day(s) left`;
      return `• ${r.medicineName} — ${r.currentStock} in stock (${est}), order ${r.recommendedQty}`;
    }),
    payload: { reorders, currency: ctx.currency },
  };
}

function forecastAnswer(ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const f: ForecastOutcome = buildForecast(ctx);
  const risky = f.items.filter((i) => i.stockoutRisk);
  const rising = f.items.filter((i) => i.trend === "RISING").slice(0, 3);
  if (f.items.length === 0) {
    return {
      intent: "FORECAST",
      title: "Demand forecast",
      text: "There isn't enough sales history to project demand yet — sales records will build the baseline over the coming weeks.",
    };
  }
  return {
    intent: "FORECAST",
    title: `Demand forecast (next ${f.horizonDays} days)`,
    text: `Based on the last 90 days of sales I project about ${m(f.predictedRevenue30)} of demand over the next ${f.horizonDays} days.${risky.length > 0 ? ` ${risky.length} medicine(s) could run out within that window.` : ""} This is a statistical estimate to inform restocking — actual purchase decisions stay with you.`,
    bullets: [
      ...(risky.length
        ? risky.slice(0, 6).map(
            (i) =>
              `• ${i.medicineName} — ${i.currentStock} in stock, ~${i.predicted30} predicted, could run out${
                i.daysToStockout !== null ? ` in ~${i.daysToStockout}d` : ""
              }`,
          )
        : []),
      ...(rising.length
        ? [`• Rising demand: ${rising.map((i) => `${i.medicineName} (+${i.unitsLast30} units/30d)`).join(", ")}`]
        : []),
    ],
    payload: { forecast: f, currency: ctx.currency },
  };
}

function financeAnswer(ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const a: FinanceAnalysis = buildFinanceAnalysis(ctx);
  const delta = a.revenueDeltaPct;
  const dir = delta === null ? "has no prior baseline" : delta >= 0 ? `is up ${delta}%` : `is down ${Math.abs(delta)}%`;
  return {
    intent: "FINANCE",
    title: `Financial analysis — ${a.month}`,
    text: `Revenue ${dir} this month (${m(a.monthRevenue)} vs ${m(a.prevRevenue)} last month). Gross profit ${m(a.grossProfit)} from ${a.saleCount} sale(s) (average ${m(a.avgSale)} per sale); expenses ${m(a.expenses)} leave a net of ${m(a.netProfit)}.`,
    bullets: a.explanation,
    payload: { finance: a, currency: ctx.currency },
  };
}

function knowledgeAnswer(
  question: string,
  ctx: AssistantContext,
): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const stripped = question
    .replace(
      /tell me about|know about|information on|info on|medicine profile|drug profile|what is it used for|about this medicine|about the medicine|knowledge base/g,
      "",
    )
    .replace(/[?.]/g, "")
    .trim();
  const profile: MedicineKnowledgeProfile | null = findMedicineProfile(ctx, stripped);
  if (!profile) {
    return {
      intent: "KNOWLEDGE",
      title: "Medicine knowledge",
      text: "I couldn't match that to a medicine in your catalog. Ask about a specific product by name.",
      bullets: ctx.medicines.slice(0, 12).map((md) => `• ${md.name}`),
    };
  }
  const bullets: string[] = [];
  if (profile.interactions.length > 0) {
    bullets.push(
      `• Interactions on file: ${profile.interactions
        .map((i) => `${i.otherMedicineName} (${i.severity})`)
        .join(", ")}`,
    );
  }
  if (profile.warnings.length > 0) {
    bullets.push(
      `• Safety warnings: ${profile.warnings.map((w) => `${w.type} — ${w.message}`).join(" | ")}`,
    );
  }
  if (profile.suppliers.length > 0) {
    bullets.push(
      `• Suppliers: ${profile.suppliers
        .map((s) => `${s.name}${s.lastUnitCost != null ? ` (${m(s.lastUnitCost)}/unit)` : ""}`)
        .join(", ")}`,
    );
  }
  return {
    intent: "KNOWLEDGE",
    title: `${profile.name}`,
    text: `${profile.name}${profile.genericName ? ` (${profile.genericName})` : ""}${
      profile.strength ? ` ${profile.strength}` : ""
    } — ${profile.therapeuticCategory ?? "no therapeutic category"}${
      profile.controlCategory === "CDR" ? " · CONTROLLED (CDR)" : ""
    }${profile.prescriptionRequired ? " · prescription required" : ""}. Selling at ${m(profile.sellingPrice)}/unit. Stock: ${profile.stockTotal} unit(s) across ${profile.stockBatches} batch(es) — ${m(profile.stockValueCost)} at cost, ${m(profile.stockValueSale)} at selling price.`,
    bullets,
    payload: { knowledge: profile, currency: ctx.currency },
  };
}

function anomalyAnswer(ctx: AssistantContext): AssistantAnswer {
  const items: AnomalyItem[] = buildAnomalyDetection(ctx);
  if (items.length === 0) {
    return {
      intent: "ANOMALY",
      title: "Anomaly scan",
      text: "No unusual patterns detected across inventory, sales, payments, refunds or the audit trail.",
    };
  }
  const high = items.filter((i) => i.severity === "HIGH").length;
  return {
    intent: "ANOMALY",
    title: "Anomaly scan",
    text: `I found ${items.length} thing(s) worth a look — ${high} high priority. These are flags for your review based on patterns in your own data; they do not accuse anyone, and you inspect the actual records before acting.`,
    bullets: items.map(
      (i) => `• [${i.category}] ${i.title} — ${i.recommendation}`,
    ),
    payload: { anomalies: items },
  };
}

function reportAnswer(ctx: AssistantContext): AssistantAnswer {
  const r: ManagementReport = buildManagementReport(ctx);
  return {
    intent: "REPORT",
    title: `Monthly management report — ${r.period}`,
    text: r.highlight,
    bullets: r.sections.map(
      (s) =>
        `• ${s.title}: ${s.rows
          .slice(0, 2)
          .map((row) => `${row.label}: ${row.value}`)
          .join(" · ")}`,
    ),
    payload: { report: r },
  };
}

function attentionAnswer(
  snap: Snapshot,
  ctx: AssistantContext,
): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const reorders = buildReorderSuggestions(ctx);
  const attention: AttentionSection[] = [];

  if (snap.expired.length > 0) {
    const cost = round2(
      snap.expired.reduce((sum, e) => sum + e.cost, 0),
    );
    attention.push({
      severity: "URGENT",
      title: `${snap.expired.length} expired batch(es) worth ${m(cost)}`,
      detail: `${snap.expired.slice(0, 3).map((e) => `${e.name} (${e.batchNumber}, ${e.qty} units)`).join(", ")}${snap.expired.length > 3 ? " and more" : ""} — review and write off.`,
    });
  }

  const stockoutWithDemand = reorders.filter(
    (r) => r.currentStock === 0 && r.dailyUsage > 0,
  );
  if (stockoutWithDemand.length > 0) {
    attention.push({
      severity: "URGENT",
      title: `${stockoutWithDemand.length} medicine(s) out of stock despite demand`,
      detail: stockoutWithDemand
        .slice(0, 4)
        .map((r) => `${r.medicineName} (${r.dailyUsage.toFixed(1)}/day)`)
        .join(", "),
    });
  }

  if (snap.cdrVariances > 0) {
    attention.push({
      severity: "URGENT",
      title: `${snap.cdrVariances} open CDR count variance(s)`,
      detail: "Controlled medicine register balances need reconciling and sign-off.",
    });
  }

  if (snap.openRequisitions > 0) {
    attention.push({
      severity: "ATTENTION",
      title: `${snap.openRequisitions} open control requisition(s)`,
      detail: "Pending controlled-medicine requisitions need approval or completion.",
    });
  }

  const lowCount = reorders.filter(
    (r) => r.currentStock > 0 && r.daysToOut !== null && r.daysToOut <= 30,
  ).length;
  if (lowCount > 0) {
    attention.push({
      severity: "ATTENTION",
      title: `${lowCount} medicine(s) could run out within 30 days`,
      detail: "Reorder recommendations are ready below — review and create purchase orders.",
    });
  }

  const expiryIntel = buildExpiryIntelligence(ctx);
  const atRiskExpiry = expiryIntel.filter((i) => i.atRisk);
  const severeExpiry = atRiskExpiry.filter((i) => i.severity === "SEVERE");
  if (atRiskExpiry.length > 0) {
    const riskCost = round2(
      atRiskExpiry.reduce((sum, i) => sum + i.costAtRisk, 0),
    );
    attention.push({
      severity: severeExpiry.length > 0 ? "URGENT" : "ATTENTION",
      title: `${atRiskExpiry.length} batch(es) may expire before selling (${m(riskCost)} at risk)`,
      detail: `${atRiskExpiry.slice(0, 3).map((i) => `${i.medicineName} (batch ${i.batchNumber}, ${i.quantity} units, ${formatISO(i.expiryDate)})`).join(", ")}${atRiskExpiry.length > 3 ? " and more" : ""} — suggested actions are shown below.`,
    });
  }

  if (snap.pendingSales > 0) {
    attention.push({
      severity: "ATTENTION",
      title: `${snap.pendingSales} sale(s) pending payment confirmation (${m(snap.pendingTotal)})`,
      detail: "Confirm or follow up on these transactions on the Payments page.",
    });
  }

  if (snap.overrides > 0) {
    attention.push({
      severity: "ATTENTION",
      title: `${snap.overrides} safety override(s) on record`,
      detail: "Review overrides in Drug Safety to confirm the documented reasons are valid.",
    });
  }

  const anomalies: AnomalyItem[] = buildAnomalyDetection(ctx);
  const highAnomalies = anomalies.filter((a) => a.severity === "HIGH");
  if (highAnomalies.length > 0) {
    attention.push({
      severity: "URGENT",
      title: `${highAnomalies.length} unusual pattern(s) flagged by anomaly scan`,
      detail: `${highAnomalies.slice(0, 3).map((a) => a.title).join(", ")} — inspect the actual records before acting.`,
    });
  }
  const fin: FinanceAnalysis = buildFinanceAnalysis(ctx);
  if (fin.stockoutsHurt.length > 0) {
    attention.push({
      severity: "ATTENTION",
      title: `${fin.stockoutsHurt.length} former top seller(s) now out of stock`,
      detail: `${fin.stockoutsHurt.slice(0, 3).join(", ")} — reorder early to protect revenue.`,
    });
  }

  const monthDelta = deltaPct(snap.monthRev, snap.prevMonthRev);
  attention.push({
    severity: "BUSINESS",
    title: `Revenue is ${monthDelta === null ? "steady" : monthDelta >= 0 ? "up" : "down"} ${monthDelta === null ? "this month" : `${Math.abs(monthDelta)}%`}`,
    detail: `${m(snap.monthRev)} this month vs ${m(snap.prevMonthRev)} last month across ${snap.monthCount} sale(s).${snap.topSellers.length ? ` Top seller: ${snap.topSellers[0].name} (${snap.topSellers[0].units} units).` : ""}`,
  });

  if (snap.topExpenseCategory) {
    attention.push({
      severity: "BUSINESS",
      title: `Expenses this month ${m(snap.monthExpenses)}`,
      detail: `Largest category is ${snap.topExpenseCategory.label} at ${m(snap.topExpenseCategory.amount)}.`,
    });
  }

  if (snap.pendingSales === 0 && snap.cdrVariances === 0 && snap.expired.length === 0 && reorders.length === 0 && snap.overrides === 0) {
    attention.push({
      severity: "GOOD",
      title: "All quiet",
      detail: "No urgent issues, open variances, expired stock, pending payments or reorder recommendations right now.",
    });
  } else {
    attention.push({
      severity: "GOOD",
      title: "On track",
      detail: `${snap.pendingSales === 0 ? "No pending payments. " : ""}${snap.cdrVariances === 0 ? "CDR register in balance. " : ""}${snap.overrides === 0 ? "No safety overrides. " : ""}${snap.expired.length === 0 ? "No expired stock. " : ""}`.trim(),
    });
  }

  const urgentCount = attention.filter((a) => a.severity === "URGENT").length;
  const attentionCount = attention.filter((a) => a.severity === "ATTENTION").length;

  return {
    intent: "ATTENTION",
    title: "What needs your attention today",
    text: `${urgentCount > 0 ? `${urgentCount} urgent issue(s) and ` : ""}${attentionCount > 0 ? `${attentionCount} item(s) needing attention. ` : ""}Recommendations below are based on live data — the app stays the authority for every transaction.`,
    payload: { attention, reorders, expiry: atRiskExpiry, currency: ctx.currency },
  };
}

function briefingAnswer(snap: Snapshot, ctx: AssistantContext): AssistantAnswer {
  const m = (v: number) => money(v, ctx.currency);
  const bullets: string[] = [];
  if (snap.lowList.length > 0) {
    bullets.push(
      `• Stock: ${snap.lowList.slice(0, 3).map((l) => `${l.name} (${l.qty} left)`).join(", ")}${snap.lowList.length > 3 ? " and more" : ""} below reorder level`,
    );
  }
  if (snap.expiring.length > 0) {
    bullets.push(
      `• Expiring: nearest is ${snap.expiring[0].name} (${formatISO(snap.expiring[0].expiryDate)}, ${snap.expiring[0].qty} units)`,
    );
  }
  if (snap.cdrVariances > 0) {
    bullets.push(`• Compliance: ${snap.cdrVariances} open CDR count variance(s)`);
  }
  if (snap.overrides > 0) {
    bullets.push(`• Safety: ${snap.overrides} safety override(s) on record`);
  }
  if (snap.pendingSales > 0) {
    bullets.push(
      `• Payments: ${snap.pendingSales} sale(s) pending, ${m(snap.pendingTotal)}`,
    );
  }
  if (snap.topSellers.length > 0) {
    bullets.push(`• Top seller: ${snap.topSellers[0].name} (${snap.topSellers[0].units} units)`);
  }
  return {
    intent: "BRIEFING",
    title: "Daily briefing",
    text: `${m(snap.todayRev)} taken today from ${snap.todayCount} confirmed sale(s). Stock watch: ${snap.out} out, ${snap.lowList.length} low, ${snap.expiring.length} expiring within ${ctx.warningDays} days, ${snap.expired.length} expired. ${snap.cdrMeds} controlled medicine(s) on the register with ${snap.cdrVariances} open variance(s). ${snap.overrides} safety override(s) recorded.`,
    bullets,
  };
}

function helpAnswer(): AssistantAnswer {
  return {
    intent: "HELP",
    title: "What I can do",
    text: "I can answer questions about your pharmacy using live data. Try asking:",
    bullets: SUGGESTED_QUESTIONS.map((q) => `• "${q}"`),
  };
}

function fallbackAnswer(): AssistantAnswer {
  return {
    intent: "FALLBACK",
    title: "Hmm, I'm not sure",
    text: "I couldn't match that to the data I track. I can answer questions about revenue and sales, top sellers, stock, expiries, reordering, demand forecasting, financial analysis, medicines knowledge, patients, drug safety, payments, anomalies, audits and reports — always grounded in your live data.",
    bullets: SUGGESTED_QUESTIONS.slice(0, 5).map((q) => `• "${q}"`),
  };
}

export function renderAnswer(a: AssistantAnswer): string {
  const lines = [a.title, "", a.text];
  for (const b of a.bullets ?? []) lines.push(b);
  return lines.join("\n");
}

export const SUGGESTED_QUESTIONS = [
  "What needs my attention today?",
  "Which medicines should I reorder?",
  "What might expire before it sells?",
  "What is the demand forecast for next month?",
  "Generate a monthly management report",
  "Why is revenue down this month?",
  "Tell me about amoxicillin 500mg",
  "Show me the patient summary for John Okello",
  "Any anomalies or suspicious activity?",
  "Give me a daily briefing",
  "How much did we sell today?",
  "Which medicines are low on stock?",
  "What payments are still pending?",
  "Any drug safety concerns?",
];

/* ------------------------------------------------------------------ */
/* Briefing cards                                                      */
/* ------------------------------------------------------------------ */

export interface BriefingCard {
  id: string;
  tone: "green" | "red" | "amber" | "blue" | "slate";
  label: string;
  title: string;
  text: string;
}

export function buildBriefing(ctx: AssistantContext): BriefingCard[] {
  const snap = snapshot(ctx);
  const m = (v: number) => money(v, ctx.currency);
  const todayDelta = deltaPct(snap.todayRev, snap.yesterdayRev);
  const cards: BriefingCard[] = [];

  cards.push({
    id: "revenue",
    tone: snap.todayRev >= snap.yesterdayRev ? "green" : "amber",
    label: snap.todayRev >= snap.yesterdayRev ? "Good" : "Attention",
    title: "Revenue today",
    text: `${m(snap.todayRev)} from ${snap.todayCount} confirmed sale(s)${
      todayDelta === null
        ? "."
        : ` — ${todayDelta > 0 ? "+" : ""}${todayDelta}% vs yesterday.`
    } 7-day total is ${m(snap.weekRev)}.`,
  });

  cards.push({
    id: "stock",
    tone: snap.out > 0 || snap.expired.length > 0 ? "red" : snap.lowList.length || snap.expiring.length ? "amber" : "green",
    label:
      snap.out > 0 || snap.expired.length > 0
        ? "Action needed"
        : snap.lowList.length || snap.expiring.length
          ? "Attention"
          : "Healthy",
    title: "Stock health",
    text: `${snap.out} out of stock, ${snap.lowList.length} below reorder level, ${snap.expiring.length} expiring within ${ctx.warningDays} days and ${snap.expired.length} already expired.`,
  });

  if (snap.expiring.length > 0) {
    cards.push({
      id: "expiry",
      tone: "amber",
      label: "Watch",
      title: "Expiring soon",
      text: snap.expiring
        .slice(0, 3)
        .map(
          (e) =>
            `${e.name} (${e.batchNumber}) — ${e.qty} units, ${formatISO(e.expiryDate)} (${e.days}d)`,
        )
        .join(" · "),
    });
  }

  if (snap.cdrMeds > 0) {
    cards.push({
      id: "controlled",
      tone: snap.cdrVariances > 0 ? "red" : "blue",
      label: snap.cdrVariances > 0 ? "Compliance" : "On track",
      title: "Controlled medicines",
      text: `${snap.cdrMeds} CDR medicine(s), ${snap.registerEntries} register entries, ${snap.cdrVariances} open variance(s), ${snap.openRequisitions} open requisition(s).`,
    });
  }

  if (snap.checks > 0) {
    cards.push({
      id: "safety",
      tone: snap.overrides > 0 ? "amber" : "green",
      label: snap.overrides > 0 ? "Review" : "Clear",
      title: "Drug safety",
      text: `${snap.checks} checks recorded — ${snap.overrides} override(s) and ${snap.warns} warning(s). ${snap.interactions} interaction rule(s) active.`,
    });
  }

  cards.push({
    id: "payments",
    tone: snap.pendingSales > 0 ? "amber" : "green",
    label: snap.pendingSales > 0 ? "Pending" : "Settled",
    title: "Payments",
    text:
      snap.pendingSales === 0
        ? "No sales are awaiting payment confirmation."
        : `${snap.pendingSales} sale(s) awaiting confirmation totalling ${m(snap.pendingTotal)}.`,
  });

  cards.push({
    id: "expenses",
    tone:
      snap.monthExpenses > snap.prevMonthRev && snap.prevMonthRev > 0
        ? "amber"
        : "slate",
    label: "Finance",
    title: "Expenses this month",
    text: `${m(snap.monthExpenses)} vs ${m(snap.prevMonthExpenses)} last month${snap.topExpenseCategory ? `; largest category ${snap.topExpenseCategory.label} (${m(snap.topExpenseCategory.amount)})` : ""}.`,
  });

  return cards;
}
