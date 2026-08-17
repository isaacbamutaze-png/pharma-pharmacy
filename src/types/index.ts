export type Role = "ADMIN" | "USER";

export type EntityStatus = "ACTIVE" | "INACTIVE";

export interface RoleRecord {
  id: string;
  name: Role;
  description: string;
  createdAt: number;
}

export interface UserRecord {
  id: string;
  roleId: string;
  fullName: string;
  username: string;
  passwordHash: string;
  phone?: string;
  email?: string;
  status: EntityStatus;
  lastLogin?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MedicineCategory {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface Medicine {
  id: string;
  name: string;
  genericName?: string;
  strength?: string;
  categoryId: string;
  therapeuticCategory?: string;
  unit: string;
  baseUnit: string;
  prescriptionRequired: boolean;
  sellingPrice: number;
  minimumStock: number;
  reorderLevel: number;
  description?: string;
  controlCategory?: "GENERAL" | "CDR";
  status: EntityStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MedicineUnit {
  id: string;
  medicineId: string;
  unitName: string;
  unitCode: string;
  conversionToBase: number;
  sellingPrice: number;
  costPrice?: number;
  barcode?: string;
  canSell: boolean;
  canPurchase: boolean;
  isDefault: boolean;
  isBase: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface MedicineBarcode {
  id: string;
  medicineId: string;
  barcode: string;
  barcodeType?: string;
  unitId?: string;
  unitName?: string;
  isPrimary: boolean;
  createdAt: number;
}

export interface SystemSetting {
  id: string;
  settingKey: string;
  settingValue: string;
  updatedBy?: string;
  updatedAt: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  createdAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  status: EntityStatus;
  createdAt: number;
  updatedAt: number;
}

export type BatchStatus = "ACTIVE" | "DEPLETED" | "EXPIRED";

export interface MedicineBatch {
  id: string;
  medicineId: string;
  supplierId?: string;
  batchNumber: string;
  serialNumber?: string;
  manufacturingDate?: string;
  expiryDate: string;
  purchasePrice: number;
  sellingPrice: number;
  quantityReceived: number;
  quantityRemaining: number;
  status: BatchStatus;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
  createdAt: number;
  updatedAt: number;
}

export type MovementType =
  | "PURCHASE"
  | "SALE"
  | "RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "EXPIRY"
  | "TRANSFER";

export interface StockMovement {
  id: string;
  medicineId: string;
  batchId?: string;
  movementType: MovementType;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  performedBy?: string;
  reason?: string;
  createdAt: number;
}

export type PaymentMethod =
  | "CASH"
  | "MOBILE_MONEY"
  | "CARD"
  | "CREDIT"
  | "BANK"
  | "PAYPAL"
  | "OTHER";

export type PaymentStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "DECLINED"
  | "CANCELLED"
  | "TIMEOUT"
  | "EXPIRED"
  | "UNKNOWN"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "VOIDED";

export type ProviderEventType =
  | "REQUEST"
  | "CALLBACK"
  | "STATUS_POLL"
  | "WEBHOOK";

export type GatewayEnvironment = "sandbox" | "production";

export interface Payment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  provider?: string;
  providerReference?: string;
  paymentReference?: string;
  transactionId?: string;
  confirmationId?: string;
  providerTransactionId?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  initiatedAt: number;
  completedAt?: number;
  failureReason?: string;
  note?: string;
  recordedBy?: string;
  createdAt: number;
}

export interface PaymentTransaction {
  id: string;
  paymentId?: string;
  saleId?: string;
  method: PaymentMethod;
  provider?: string;
  direction: "COLLECTION" | "REFUND";
  amount: number;
  currency: string;
  customerReference?: string;
  providerReference?: string;
  providerTransactionId?: string;
  providerConfirmation?: string;
  paymentReference?: string;
  status: PaymentStatus;
  initiatedAt: number;
  requestedAt?: number;
  confirmedAt?: number;
  verifiedAt?: number;
  completedAt?: number;
  failureReason?: string;
  payload?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentProviderEvent {
  id: string;
  transactionId: string;
  saleId?: string;
  provider: string;
  eventType: ProviderEventType;
  status: string;
  raw: string;
  receivedAt: number;
}

export interface PaymentConfirmation {
  id: string;
  paymentId?: string;
  transactionId: string;
  saleId?: string;
  provider: string;
  providerStatus: string;
  providerTransactionId?: string;
  confirmationReference?: string;
  providerResponse?: string;
  amount?: number;
  currency?: string;
  verified: boolean;
  verifiedAt?: number;
  createdAt: number;
}

export interface PaymentGateway {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  environment: GatewayEnvironment;
  merchantId?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  currency: string;
  status?: "CONNECTED" | "NOT_CONFIGURED" | "ERROR";
  lastConnectedAt?: number;
  config?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type SaleStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "PAID"
  | "COMPLETED"
  | "CANCELLED"
  | "VOIDED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaleItemBatch {
  batchId: string;
  quantity: number;
  costPrice: number;
}

export interface SaleItem {
  id: string;
  saleId: string;
  medicineId: string;
  medicineName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  costPrice: number;
  unitName?: string;
  unitConversion?: number;
  baseQuantity?: number;
  batches: SaleItemBatch[];
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  saleDate: number;
  saleDateKey: string;
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  amountPaid: number;
  changeDue: number;
  balanceDue: number;
  paymentMethod: PaymentMethod;
  cashierId: string;
  cashierName?: string;
  status: SaleStatus;
  paymentStatus?: PaymentStatus;
  stockStatus?: "NOT_DEDUCTED" | "DEDUCTED";
  receiptStatus?: "NOT_ISSUED" | "ISSUED";
  paymentIntents?: Array<{ method: PaymentMethod; amount: number }>;
  note?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type ExpenseCategory =
  | "RENT"
  | "SALARIES"
  | "UTILITIES"
  | "SUPPLIES"
  | "EQUIPMENT"
  | "MAINTENANCE"
  | "TRANSPORT"
  | "MARKETING"
  | "OTHER";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description?: string;
  amount: number;
  expenseDate: number;
  expenseDateKey: string;
  recordedBy?: string;
  createdAt: number;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  saleId?: string;
  note?: string;
  recordedBy?: string;
  createdAt: number;
}

export type RefundReason =
  | "CUSTOMER_RETURN"
  | "WRONG_ITEM"
  | "DAMAGED"
  | "OTHER";

export interface RefundItem {
  id: string;
  refundId: string;
  saleId: string;
  saleItemId: string;
  medicineId: string;
  medicineName: string;
  unitName?: string;
  quantity: number;
  unitConversion?: number;
  baseQuantity: number;
  unitPrice: number;
  lineTotal: number;
  costPrice: number;
}

export interface Refund {
  id: string;
  saleId: string;
  invoiceNumber: string;
  saleDate: number;
  saleDateKey: string;
  amount: number;
  cogs: number;
  reason: RefundReason;
  refundMethod: PaymentMethod;
  note?: string;
  recordedBy: string;
  recordedByName?: string;
  createdAt: number;
}

export interface HeldSaleLine {
  medicineId: string;
  unitId: string;
  unitName: string;
  unitPrice: number;
  unitConversion: number;
  quantity: number;
}

export interface HeldSale {
  id: string;
  label: string;
  lines: HeldSaleLine[];
  customerName?: string;
  customerPhone?: string;
  discountInput?: string;
  taxRate?: number;
  createdBy?: string;
  createdAt: number;
}

export type PurchaseRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "ORDERED"
  | "CANCELLED";

export interface PurchaseRequest {
  id: string;
  number: string;
  status: PurchaseRequestStatus;
  note?: string;
  requestedBy?: string;
  requestedByName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PurchaseRequestItem {
  id: string;
  purchaseRequestId: string;
  medicineId: string;
  medicineName: string;
  requestedQty: number;
  unitName?: string;
  unitConversion?: number;
  note?: string;
  createdAt: number;
}

export type PurchaseOrderStatus =
  | "DRAFT"
  | "SENT"
  | "CONFIRMED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  purchaseRequestId?: string;
  expectedDate?: string;
  terms?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  medicineId: string;
  medicineName: string;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  lineTotal: number;
}

export interface Grn {
  id: string;
  number: string;
  poId?: string;
  poNumber?: string;
  supplierId: string;
  supplierName: string;
  receivedAt: number;
  receivedBy?: string;
  receivedByName?: string;
  note?: string;
  createdAt: number;
}

export interface GrnItem {
  id: string;
  grnId: string;
  poItemId?: string;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  qtyReceived: number;
  unitName?: string;
  unitConversion?: number;
  unitCost: number;
  sellingPrice: number;
  lineTotal: number;
}

export type SupplierInvoiceStatus =
  | "PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export interface SupplierInvoice {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  grnId?: string;
  grnNumber?: string;
  amount: number;
  tax: number;
  total: number;
  dueDate?: string;
  status: SupplierInvoiceStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupplierPayment {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  invoiceId?: string;
  invoiceNumber?: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  recordedBy?: string;
  recordedByName?: string;
  createdAt: number;
}

export type PurchaseReturnStatus = "COMPLETED" | "CANCELLED";

export interface PurchaseReturn {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  grnId?: string;
  grnNumber?: string;
  reason: string;
  total: number;
  status: PurchaseReturnStatus;
  creditNoteRef?: string;
  recordedBy?: string;
  recordedByName?: string;
  createdAt: number;
}

export interface PurchaseReturnItem {
  id: string;
  purchaseReturnId: string;
  medicineId: string;
  medicineName: string;
  batchId?: string;
  batchNumber: string;
  qty: number;
  unitName?: string;
  unitConversion?: number;
  unitCost: number;
  total: number;
}

export interface SupplierProduct {
  id: string;
  supplierId: string;
  medicineId: string;
  latestUnitCost: number;
  leadTimeDays?: number;
  safetyStock?: number;
  isPreferred?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SupplierPriceHistory {
  id: string;
  supplierId: string;
  medicineId: string;
  unitId?: string;
  unitName?: string;
  price: number;
  effectiveFrom: number;
  recordedBy?: string;
  createdAt: number;
}

export interface SupplierPerformance {
  id: string;
  supplierId: string;
  onTimeDeliveries: number;
  lateDeliveries: number;
  returnsCount: number;
  avgLeadDays: number;
  rating: number;
  lastOrderAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type PatientStatus =
  | "REGISTERED"
  | "OUTPATIENT"
  | "ADMITTED"
  | "TRANSFERRED"
  | "DISCHARGED"
  | "DECEASED";

export interface Patient {
  id: string;
  patientNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  sex?: string;
  phone?: string;
  email?: string;
  address?: string;
  nationality?: string;
  emergencyContact?: string;
  nationalId?: string;
  insuranceNumber?: string;
  bloodGroup?: string;
  medicalConditions?: string;
  chronicConditions?: string;
  status: PatientStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PatientAllergy {
  id: string;
  patientId: string;
  allergen: string;
  severity?: string;
  reaction?: string;
  recordedBy?: string;
  createdAt: number;
}

export interface PatientMedicalHistory {
  id: string;
  patientId: string;
  condition: string;
  onsetDate?: string;
  resolutionDate?: string;
  notes?: string;
  recordedBy?: string;
  createdAt: number;
}

export type PrescriptionStatus = "PENDING" | "DISPENSED" | "CANCELLED";

export interface Prescription {
  id: string;
  prescriptionNumber: string;
  patientId: string;
  patientName?: string;
  admissionId?: string;
  doctorName?: string;
  doctorLicense?: string;
  prescribedDate: number;
  status: PrescriptionStatus;
  saleId?: string;
  invoiceNumber?: string;
  note?: string;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PrescriptionItem {
  id: string;
  prescriptionId: string;
  medicineId: string;
  medicineName: string;
  strength?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  quantity: number;
  instructions?: string;
  dispensedQty: number;
  createdAt: number;
}

export interface DispensingRecord {
  id: string;
  prescriptionId: string;
  prescriptionItemId: string;
  saleId?: string;
  medicineId: string;
  medicineName: string;
  batchIds: string[];
  qty: number;
  dispensedBy?: string;
  dispensedByName?: string;
  dispensedAt: number;
}

export type RegisterTransactionType =
  | "RECEIVED"
  | "DISPENSED"
  | "RETURNED"
  | "DESTROYED"
  | "ADJUSTMENT"
  | "REQUISITION_ISSUE"
  | "REQUISITION_RECEIVE";

export interface ControlledDrugRegisterEntry {
  id: string;
  entryNumber: string;
  medicineId: string;
  batchId: string;
  transactionType: RegisterTransactionType;
  openingBalance: number;
  quantity: number;
  balanceAfter: number;
  patientId?: string;
  prescriptionId?: string;
  prescriberName?: string;
  pharmacistId: string;
  pharmacistName: string;
  secondAuthorizerId?: string;
  secondAuthorizerName?: string;
  reason: string;
  recordedAt: number;
}

export interface ControlRequisition {
  id: string;
  requisitionNumber: string;
  type: "ISSUE" | "RECEIVE";
  medicineId: string;
  batchId: string;
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  pharmacistId: string;
  pharmacistName: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  createdAt: number;
  completedAt?: number;
}

export interface ControlledDrugCount {
  id: string;
  countNumber: string;
  medicineId: string;
  batchId: string;
  countedBalance: number;
  registerBalance: number;
  variance: number;
  status: "MATCH" | "VARIANCE" | "RESOLVED";
  countedBy: string;
  countedByName: string;
  notes?: string;
  countedAt: number;
}

export type InteractionSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CONTRAINDICATED";

export interface DrugInteraction {
  id: string;
  medicineAId: string;
  medicineBId: string;
  severity: InteractionSeverity;
  detail: string;
  recommendation?: string;
  createdAt: number;
}

export type MedicineWarningType =
  | "AGE"
  | "PREGNANCY"
  | "LACTATION"
  | "DOSE"
  | "CONTRAINDICATION";

export interface MedicineWarning {
  id: string;
  medicineId: string;
  warningType: MedicineWarningType;
  condition: string;
  message: string;
  severity: "INFO" | "WARNING" | "SEVERE";
  createdAt: number;
}

export type SafetyCheckType =
  | "ALLERGY"
  | "INTERACTION"
  | "DUPLICATE_THERAPY"
  | "CONTRAINDICATION"
  | "DOSE"
  | "AGE"
  | "PREGNANCY"
  | "LACTATION";

export type SafetyOutcome = "PASS" | "WARN" | "OVERRIDE";

export interface SafetyAlertCheck {
  id: string;
  patientId: string;
  prescriptionId?: string;
  checkType: SafetyCheckType;
  severity: InteractionSeverity | "INFO";
  outcome: SafetyOutcome;
  detail: string;
  overriddenBy?: string;
  overrideReason?: string;
  checkedAt: number;
}

export type AssistantMessageRole = "user" | "assistant";

export type AssistantIntent =
  | "BRIEFING"
  | "REVENUE"
  | "TOP_SELLERS"
  | "LOW_STOCK"
  | "EXPIRY"
  | "EXPIRY_RISK"
  | "STOCK_VALUE"
  | "PATIENTS"
  | "PRESCRIPTIONS"
  | "CONTROLLED"
  | "SAFETY"
  | "PAYMENTS"
  | "EXPENSES"
  | "SALES_TREND"
  | "ATTENTION"
  | "REORDER"
  | "FORECAST"
  | "FINANCE"
  | "KNOWLEDGE"
  | "ANOMALY"
  | "REPORT"
  | "HELP";

export type AssistantSource = "LLM" | "OFFLINE";

export interface ReorderSuggestion {
  medicineId: string;
  medicineName: string;
  currentStock: number;
  dailyUsage: number;
  daysToOut: number | null;
  recommendedQty: number;
  supplierId?: string;
  supplierName?: string;
  lastUnitCost?: number;
  unit?: string;
}

export interface AttentionSection {
  severity: "URGENT" | "ATTENTION" | "BUSINESS" | "GOOD";
  title: string;
  detail: string;
  reorderIndex?: number;
}

export type ExpiryRiskSeverity = "SEVERE" | "WATCH" | "HEALTHY";

export interface ExpiryRiskItem {
  batchId: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  days: number;
  quantity: number;
  dailyUsage: number;
  sellThrough: number;
  likelyLeftover: number;
  atRisk: boolean;
  severity: ExpiryRiskSeverity;
  costAtRisk: number;
  suggestedActions: string[];
  supplierName?: string;
}

export interface AssistantPayload {
  attention?: AttentionSection[];
  reorders?: ReorderSuggestion[];
  expiry?: ExpiryRiskItem[];
  forecast?: ForecastOutcome;
  finance?: FinanceAnalysis;
  knowledge?: MedicineKnowledgeProfile;
  anomalies?: AnomalyItem[];
  report?: ManagementReport;
  payments?: PaymentIntelligence;
  safety?: SafetyIntelligence;
  patients?: PatientSummary[];
  currency?: string;
}

/* ── PHARMA AI layer payload types ─────────────────────────────────── */

export interface ForecastItem {
  medicineId: string;
  medicineName: string;
  unitsLast30: number;
  dailyAvg: number;
  trend: "RISING" | "STABLE" | "FALLING" | "NO_DATA";
  predicted30: number;
  currentStock: number;
  stockoutRisk: boolean;
  daysToStockout: number | null;
}

export interface ForecastOutcome {
  horizonDays: number;
  method: string;
  items: ForecastItem[];
  predictedRevenue30: number;
}

export interface FinanceProductDelta {
  name: string;
  unitsThis: number;
  unitsPrev: number;
  deltaPct: number | null;
}

export interface FinanceInsight {
  tone: "good" | "bad" | "neutral";
  text: string;
}

export interface FinanceAnalysis {
  month: string;
  prevMonth: string;
  monthRevenue: number;
  prevRevenue: number;
  revenueDeltaPct: number | null;
  grossProfit: number;
  netProfit: number;
  expenses: number;
  saleCount: number;
  avgSale: number;
  topProductsDelta: FinanceProductDelta[];
  stockoutsHurt: string[];
  explanation: string[];
  insights: FinanceInsight[];
}

export interface KnowledgeInteraction {
  otherMedicineName: string;
  severity: InteractionSeverity;
  detail: string;
}

export interface KnowledgeWarning {
  type: string;
  message: string;
  severity: string;
}

export interface MedicineKnowledgeProfile {
  medicineId: string;
  name: string;
  genericName?: string;
  strength?: string;
  therapeuticCategory?: string;
  controlCategory?: string;
  prescriptionRequired?: boolean;
  unit?: string;
  sellingPrice: number;
  stockTotal: number;
  stockBatches: number;
  stockValueCost: number;
  stockValueSale: number;
  suppliers: Array<{ name: string; lastUnitCost?: number }>;
  interactions: KnowledgeInteraction[];
  warnings: KnowledgeWarning[];
  barcodes: string[];
  source: string;
}

export interface AnomalyItem {
  category: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  recommendation: string;
}

export interface ReportRow {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

export interface ManagementReport {
  generatedAt: number;
  period: string;
  highlight: string;
  sections: ReportSection[];
}

export interface PaymentIntelPending {
  saleId: string;
  invoiceNumber: string;
  total: number;
  method: PaymentMethod;
  customerName?: string;
}

export interface PaymentIntelTransaction {
  method: string;
  provider?: string;
  amount: number;
  status: string;
  reason?: string;
  saleId?: string;
}

export interface PaymentIntelligence {
  pendingSales: PaymentIntelPending[];
  pendingTotal: number;
  failedRecent: PaymentIntelTransaction[];
  failedCount: number;
  unmatched: PaymentIntelTransaction[];
  refunds30Count: number;
  refunds30Total: number;
  notes: string[];
}

export interface SafetyIntelConcern {
  title: string;
  detail: string;
}

export interface SafetyIntelligence {
  checksTotal: number;
  warns: number;
  overrides: number;
  overridesRecent: Array<{
    checkType: string;
    detail: string;
    reason: string;
    at: number;
  }>;
  allergyPatients: number;
  interactionRules: number;
  warningRules: number;
  openConcerns: SafetyIntelConcern[];
}

export interface PatientSummaryAllergy {
  allergen: string;
  severity?: string;
  reaction?: string;
}

export interface PatientSummaryRx {
  prescriptionNumber: string;
  date: number;
  status: string;
  items: string[];
}

export interface PatientSummary {
  patientId: string;
  name: string;
  age?: number;
  status: string;
  allergies: PatientSummaryAllergy[];
  conditions: string[];
  rxTotal: number;
  rxPending: number;
  rxRecent: PatientSummaryRx[];
  dispensingTotal: number;
  dispensingRecent: number;
  balanceDue: number;
}

export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  text: string;
  intent?: AssistantIntent;
  source?: AssistantSource;
  payload?: AssistantPayload;
  createdAt: number;
}

