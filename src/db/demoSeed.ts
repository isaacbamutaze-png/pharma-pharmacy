import { pharmaDb } from "./index";
import { uid, now } from "../lib/utils";
import { round2 } from "../lib/sales";
import type {
  Customer,
  DrugInteraction,
  Expense,
  ExpenseCategory,
  Medicine,
  MedicineBarcode,
  MedicineBatch,
  MedicineUnit,
  MedicineWarning,
  Patient,
  PatientAllergy,
  PaymentMethod,
  Prescription,
  PrescriptionItem,
  Sale,
  SaleItem,
  StockMovement,
  Supplier,
} from "../types";

const DEMO_FLAG_KEY = "demo_seeded";

function dateKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function stampOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const h = 8 + Math.floor(Math.random() * 13);
  const min = Math.floor(Math.random() * 60);
  const sec = Math.floor(Math.random() * 60);
  return new Date(y, m - 1, d, h, min, sec).getTime();
}

interface MedDef {
  name: string;
  generic?: string;
  strength?: string;
  category: string;
  unit: string;
  rx: boolean;
  controlCategory?: "GENERAL" | "CDR";
  costPrice: number;
  sellPrice: number;
  reorderLevel: number;
  minimumStock: number;
  received: number;
  expDays: number;
  weight: number;
  keep?: number;
  extraBatches?: Array<{
    expDays: number;
    received: number;
    remaining: number;
    status?: "ACTIVE" | "EXPIRED";
  }>;
}

const SAMPLE_MEDS: MedDef[] = [
  {
    name: "Paracetamol 500mg", generic: "Paracetamol", strength: "500mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 150, sellPrice: 500, reorderLevel: 100, minimumStock: 50,
    received: 300, expDays: 420, weight: 5,
  },
  {
    name: "Amoxicillin 500mg", generic: "Amoxicillin", strength: "500mg",
    category: "Capsule", unit: "capsule(s)", rx: true,
    costPrice: 350, sellPrice: 900, reorderLevel: 80, minimumStock: 40,
    received: 260, expDays: 300, weight: 4,
  },
  {
    name: "Amoxicillin Suspension", generic: "Amoxicillin", strength: "250mg/5ml",
    category: "Suspension", unit: "bottle", rx: true,
    costPrice: 1500, sellPrice: 3000, reorderLevel: 30, minimumStock: 15,
    received: 90, expDays: 540, weight: 2,
  },
  {
    name: "Coartem 20/120", generic: "Artemether/Lumefantrine", strength: "20mg/120mg",
    category: "Tablet", unit: "tablet(s)", rx: true,
    costPrice: 2800, sellPrice: 4000, reorderLevel: 60, minimumStock: 30,
    received: 240, expDays: 210, weight: 4,
    extraBatches: [{ expDays: 12, received: 30, remaining: 30 }],
  },
  {
    name: "Metronidazole 400mg", generic: "Metronidazole", strength: "400mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 120, sellPrice: 400, reorderLevel: 100, minimumStock: 50,
    received: 320, expDays: 480, weight: 3,
  },
  {
    name: "ORS Sachet", generic: "Oral Rehydration Salts", strength: "20.5g",
    category: "Sachet", unit: "sachet(s)", rx: false,
    costPrice: 250, sellPrice: 600, reorderLevel: 50, minimumStock: 25,
    received: 150, expDays: 540, weight: 3,
  },
  {
    name: "Ibuprofen 400mg", generic: "Ibuprofen", strength: "400mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 180, sellPrice: 500, reorderLevel: 80, minimumStock: 40,
    received: 200, expDays: 360, weight: 2,
  },
  {
    name: "Vitamin C 1000mg", generic: "Ascorbic Acid", strength: "1000mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 350, sellPrice: 1000, reorderLevel: 40, minimumStock: 20,
    received: 120, expDays: 450, weight: 1,
  },
  {
    name: "Cetirizine 10mg", generic: "Cetirizine", strength: "10mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 250, sellPrice: 700, reorderLevel: 20, minimumStock: 10,
    received: 150, expDays: 390, weight: 0, keep: 5,
  },
  {
    name: "Ciprofloxacin 500mg", generic: "Ciprofloxacin", strength: "500mg",
    category: "Tablet", unit: "tablet(s)", rx: true,
    costPrice: 300, sellPrice: 800, reorderLevel: 40, minimumStock: 20,
    received: 120, expDays: 330, weight: 0, keep: 0,
  },
  {
    name: "Diclofenac 50mg", generic: "Diclofenac", strength: "50mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 250, sellPrice: 700, reorderLevel: 50, minimumStock: 25,
    received: 160, expDays: 380, weight: 1,
  },
  {
    name: "Salbutamol 4mg", generic: "Salbutamol", strength: "4mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 150, sellPrice: 500, reorderLevel: 60, minimumStock: 30,
    received: 180, expDays: 420, weight: 2,
  },
  {
    name: "Panadol Syrup", generic: "Paracetamol", strength: "120mg/5ml",
    category: "Syrup", unit: "bottle", rx: false,
    costPrice: 900, sellPrice: 2000, reorderLevel: 25, minimumStock: 12,
    received: 60, expDays: 480, weight: 2,
  },
  {
    name: "Mebendazole 100mg", generic: "Mebendazole", strength: "100mg",
    category: "Tablet", unit: "tablet(s)", rx: false,
    costPrice: 120, sellPrice: 400, reorderLevel: 30, minimumStock: 15,
    received: 100, expDays: 500, weight: 1,
  },
  {
    name: "Dextrose 5% Infusion", generic: "Glucose", strength: "5% 500ml",
    category: "Injection", unit: "bottle", rx: true,
    costPrice: 3500, sellPrice: 5500, reorderLevel: 15, minimumStock: 8,
    received: 40, expDays: 240, weight: 1,
    extraBatches: [{ expDays: -10, received: 40, remaining: 12, status: "EXPIRED" }],
  },
  {
    name: "Gentamicin Eye Drops", generic: "Gentamicin", strength: "0.3% 5ml",
    category: "Drops", unit: "bottle", rx: false,
    costPrice: 2000, sellPrice: 3500, reorderLevel: 20, minimumStock: 10,
    received: 70, expDays: 270, weight: 1,
    extraBatches: [{ expDays: 20, received: 25, remaining: 25 }],
  },
  {
    name: "Clotrimazole Cream 1%", generic: "Clotrimazole", strength: "1% 20g",
    category: "Cream", unit: "tube", rx: false,
    costPrice: 1500, sellPrice: 3000, reorderLevel: 25, minimumStock: 12,
    received: 80, expDays: 320, weight: 1,
  },
  {
    name: "Hydrocortisone Ointment 1%", generic: "Hydrocortisone", strength: "1% 15g",
    category: "Ointment", unit: "tube", rx: false,
    costPrice: 1200, sellPrice: 2500, reorderLevel: 20, minimumStock: 10,
    received: 60, expDays: 350, weight: 1,
  },
  {
    name: "Diazepam 5mg", generic: "Diazepam", strength: "5mg",
    category: "Tablet", unit: "tablet(s)", rx: true, controlCategory: "CDR",
    costPrice: 2500, sellPrice: 6000, reorderLevel: 30, minimumStock: 15,
    received: 120, expDays: 480, weight: 1,
  },
  {
    name: "Codeine Phosphate 30mg", generic: "Codeine", strength: "30mg",
    category: "Tablet", unit: "tablet(s)", rx: true, controlCategory: "CDR",
    costPrice: 1200, sellPrice: 2500, reorderLevel: 40, minimumStock: 20,
    received: 200, expDays: 360, weight: 1,
  },
];

const SAMPLE_SUPPLIERS = [
  "Juba Pharma Supplies",
  "Kampala Drug Distributors",
  "MediWorld Uganda",
];

const SAMPLE_CUSTOMERS = [
  { name: "John Okello", phone: "+256 701 223344" },
  { name: "Sarah Namuli", phone: "+256 772 556677" },
  { name: "David Mugisha", phone: "+256 782 889900" },
  { name: "Aisha Nabirye", phone: "+256 701 445566" },
  { name: "Peter Kato", phone: "+256 783 112233" },
];

const SAMPLE_EXPENSE_CATEGORIES: Array<{
  category: ExpenseCategory;
  label: string;
}> = [
  { category: "RENT", label: "Monthly rent" },
  { category: "SALARIES", label: "Staff salaries" },
  { category: "UTILITIES", label: "Electricity & water" },
  { category: "SUPPLIES", label: "Packaging & supplies" },
  { category: "TRANSPORT", label: "Delivery transport" },
  { category: "MARKETING", label: "Promotions" },
  { category: "EQUIPMENT", label: "Equipment" },
  { category: "MAINTENANCE", label: "Repairs" },
  { category: "OTHER", label: "Miscellaneous" },
];

function pickWeighted<T>(items: T[], weights: number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

let demoSeeding = false;
let demoDone = false;

export async function seedDemoData(): Promise<boolean> {
  if (demoDone) return false;
  if (demoSeeding) return false;
  demoSeeding = true;

  try {
    const flag = await pharmaDb.systemSettings
      .where("settingKey")
      .equals(DEMO_FLAG_KEY)
      .first();
    if (flag) {
      demoDone = true;
      return false;
    }

    const medicineCount = await pharmaDb.medicines.count();
    if (medicineCount > 0) {
      demoDone = true;
      return false;
    }

  const timestamp = now();
  const categories = await pharmaDb.medicineCategories.toArray();
  const categoryId = (name: string): string =>
    categories.find((c) => c.name === name)?.id ?? categories[0].id;

  const users = await pharmaDb.users.toArray();
  const adminUser = users.find((u) => u.username === "admin");
  const cashierUser = users.find((u) => u.username === "user");
  const cashiers = [adminUser ?? users[0], cashierUser ?? users[1]].filter(
    Boolean,
  );

  const suppliers: Supplier[] = SAMPLE_SUPPLIERS.map((name, i) => ({
    id: uid(),
    name,
    contactPerson: ["Grace Akello", "Musa Ssebunya", "Faith Achieng"][i % 3],
    phone: ["+256 701 111111", "+256 772 222222", "+256 783 333333"][i % 3],
    email: `sales@${name.toLowerCase().replace(/[^a-z]+/g, "")}.co.ug`,
    address: ["Nakawa, Kampala", "Ntinda, Kampala", "Entebbe Road"][i % 3],
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const customers: Customer[] = SAMPLE_CUSTOMERS.map((c) => ({
    id: uid(),
    name: c.name,
    phone: c.phone,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const dayOffsets: number[] = [0, 0, 0, 1, 1, 1, 2, 2];
  for (let i = 0; i < 170; i++) {
    dayOffsets.push(Math.floor(Math.pow(Math.random(), 1.6) * 180));
  }
  dayOffsets.sort((a, b) => b - a);

  const sellable = SAMPLE_MEDS.filter((m) => (m.keep ?? m.received) > 0);
  const sold = new Map<string, number>();

  const saleDraft: Array<{
    saleDate: number;
    saleDateKey: string;
    paymentMethod: PaymentMethod;
    customerId?: string;
    customerName?: string;
    items: Array<{
      med: MedDef;
      quantity: number;
      lineTotal: number;
      costPrice: number;
      batchId: string;
    }>;
    subtotal: number;
    discount: number;
  }> = [];

  for (const offset of dayOffsets) {
    const key = dateKey(offset);
    const itemCount = 1 + Math.floor(Math.random() * 3);
    const lines: typeof saleDraft[0]["items"] = [];
    let subtotal = 0;

    for (let attempt = 0; attempt < itemCount * 3; attempt++) {
      const med = pickWeighted(
        sellable,
        sellable.map((m) => m.weight),
      );
      const maxSold = (med.keep ?? med.received) - Math.min(5, med.received);
      if ((sold.get(med.name) ?? 0) >= maxSold) continue;
      const quantity = pickWeighted([1, 2, 3], [6, 3, 1]);
      if ((sold.get(med.name) ?? 0) + quantity > maxSold) continue;
      const lineTotal = round2(quantity * med.sellPrice);
      sold.set(med.name, (sold.get(med.name) ?? 0) + quantity);
      lines.push({
        med,
        quantity,
        lineTotal,
        costPrice: med.costPrice,
        batchId: "",
      });
      subtotal += lineTotal;
      if (lines.length >= itemCount) break;
    }

    if (lines.length === 0) continue;

    const discount =
      Math.random() < 0.15
        ? round2(subtotal * (0.05 + Math.random() * 0.05))
        : 0;
    const methodRoll = Math.random();
    const paymentMethod: PaymentMethod =
      methodRoll < 0.5
        ? "CASH"
        : methodRoll < 0.8
          ? "MOBILE_MONEY"
          : methodRoll < 0.9
            ? "CARD"
            : "CREDIT";

    let customerId: string | undefined;
    let customerName: string | undefined;
    if (Math.random() < 0.45) {
      const c = customers[Math.floor(Math.random() * customers.length)];
      customerId = c.id;
      customerName = c.name;
    }

    saleDraft.push({
      saleDate: stampOf(key),
      saleDateKey: key,
      paymentMethod,
      customerId,
      customerName,
      items: lines,
      subtotal: round2(subtotal),
      discount,
    });
  }

  saleDraft.sort((a, b) => a.saleDate - b.saleDate);

  const batches: MedicineBatch[] = [];
  const purchaseMovements: StockMovement[] = [];
  const medicines: Medicine[] = [];
  const barcodes: MedicineBarcode[] = [];
  const units: MedicineUnit[] = [];

  let medIndex = 0;
  for (const def of SAMPLE_MEDS) {
    medIndex += 1;
    const medId = uid();
    medicines.push({
      id: medId,
      name: def.name,
      genericName: def.generic,
      strength: def.strength,
      categoryId: categoryId(def.category),
      unit: def.unit,
      baseUnit: def.unit,
      prescriptionRequired: def.rx,
      controlCategory: def.controlCategory ?? "GENERAL",
      sellingPrice: def.sellPrice,
      minimumStock: def.minimumStock,
      reorderLevel: def.reorderLevel,
      description: undefined,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    barcodes.push({
      id: uid(),
      medicineId: medId,
      barcode: `0604${String(1000 + medIndex * 37).padStart(9, "0")}`,
      isPrimary: true,
      createdAt: timestamp,
    });

    units.push({
      id: uid(),
      medicineId: medId,
      unitName: def.unit,
      unitCode: "BASE",
      conversionToBase: 1,
      sellingPrice: def.sellPrice,
      canSell: true,
      canPurchase: true,
      isDefault: true,
      isBase: true,
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const remaining = Math.max(
      0,
      (def.keep ?? def.received) - (sold.get(def.name) ?? 0),
    );
    const primary = {
      id: uid(),
      medicineId: medId,
      supplierId: suppliers[Math.floor(Math.random() * suppliers.length)].id,
      batchNumber: `BN-${medIndex}-${String(100 + Math.floor(Math.random() * 900))}`,
      expiryDate: dateKey(-def.expDays),
      manufacturingDate: dateKey(-def.expDays - 730),
      purchasePrice: def.costPrice,
      sellingPrice: def.sellPrice,
      quantityReceived: def.received,
      quantityRemaining: remaining,
      status: remaining === 0 ? ("DEPLETED" as const) : ("ACTIVE" as const),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    batches.push(primary);
    purchaseMovements.push({
      id: uid(),
      medicineId: medId,
      batchId: primary.id,
      movementType: "PURCHASE",
      quantity: primary.quantityReceived,
      referenceType: "receiving",
      reason: `Received batch ${primary.batchNumber}`,
      createdAt: timestamp,
    });

    for (const extra of def.extraBatches ?? []) {
      const extraBatch: MedicineBatch = {
        id: uid(),
        medicineId: medId,
        supplierId: primary.supplierId,
        batchNumber: `BN-${medIndex}-X`,
        expiryDate: dateKey(-extra.expDays),
        manufacturingDate: dateKey(-extra.expDays - 730),
        purchasePrice: def.costPrice,
        sellingPrice: def.sellPrice,
        quantityReceived: extra.received,
        quantityRemaining: extra.remaining,
        status: extra.status ?? (extra.remaining > 0 ? "ACTIVE" : "DEPLETED"),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      batches.push(extraBatch);
      purchaseMovements.push({
        id: uid(),
        medicineId: medId,
        batchId: extraBatch.id,
        movementType: "PURCHASE",
        quantity: extraBatch.quantityReceived,
        referenceType: "receiving",
        reason: `Received batch ${extraBatch.batchNumber}`,
        createdAt: timestamp,
      });
    }
  }

  const batchByMedicine = new Map<string, MedicineBatch>();
  for (const b of batches) {
    if (!batchByMedicine.has(b.medicineId)) batchByMedicine.set(b.medicineId, b);
  }

  const sales: Sale[] = [];
  const saleItems: SaleItem[] = [];
  const saleMovements: StockMovement[] = [];

  let invoiceSeq = 1;
  for (const draft of saleDraft) {
    const saleId = uid();
    const invoiceNumber = `INV-${String(invoiceSeq).padStart(5, "0")}`;
    invoiceSeq += 1;
    const cashier = cashiers[Math.floor(Math.random() * cashiers.length)];
    const total = round2(draft.subtotal - draft.discount);
    const isCredit = draft.paymentMethod === "CREDIT";

    sales.push({
      id: saleId,
      invoiceNumber,
      customerId: draft.customerId,
      customerName: draft.customerName,
      customerPhone: undefined,
      saleDate: draft.saleDate,
      saleDateKey: draft.saleDateKey,
      subtotal: draft.subtotal,
      discount: draft.discount,
      taxRate: 0,
      tax: 0,
      total,
      amountPaid: isCredit ? 0 : total,
      changeDue: 0,
      balanceDue: isCredit ? total : 0,
      paymentMethod: draft.paymentMethod,
      cashierId: cashier.id,
      cashierName: cashier.fullName,
      status: "COMPLETED",
      note: undefined,
      createdAt: draft.saleDate,
      updatedAt: draft.saleDate,
    });

    for (const item of draft.items) {
      const batch =
        batchByMedicine.get(
          medicines.find((m) => m.name === item.med.name)?.id ?? "",
        ) ?? batches[0];
      saleItems.push({
        id: uid(),
        saleId,
        medicineId: batch.medicineId,
        medicineName: item.med.name,
        unitPrice: item.med.sellPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        costPrice: item.costPrice,
        batches: [
          { batchId: batch.id, quantity: item.quantity, costPrice: item.costPrice },
        ],
      });
    }

    saleMovements.push({
      id: uid(),
      medicineId: saleItems[saleItems.length - 1].medicineId,
      batchId: saleItems[saleItems.length - 1].batches[0].batchId,
      movementType: "SALE",
      quantity: -draft.items.reduce((sum, i) => sum + i.quantity, 0),
      referenceType: "sale",
      referenceId: saleId,
      reason: `Sale ${invoiceNumber}`,
      createdAt: draft.saleDate,
    });
  }

  const expenses: Expense[] = [];
  const expenseBasis: Array<{ category: ExpenseCategory; amount: number }> = [
    { category: "RENT", amount: 800000 },
    { category: "SALARIES", amount: 700000 },
    { category: "SALARIES", amount: 650000 },
    { category: "UTILITIES", amount: 180000 },
    { category: "SUPPLIES", amount: 220000 },
    { category: "TRANSPORT", amount: 120000 },
    { category: "MARKETING", amount: 180000 },
    { category: "EQUIPMENT", amount: 350000 },
    { category: "MAINTENANCE", amount: 90000 },
  ];

  for (let monthAgo = 5; monthAgo >= 0; monthAgo--) {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() - monthAgo);
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const maxDay =
      monthAgo === 0 ? Math.min(daysInMonth, new Date().getDate()) : daysInMonth;

    const monthly = expenseBasis.map((e, i) => {
      const day = Math.min(maxDay, 1 + ((i * 3 + monthAgo * 2) % maxDay));
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return {
        category: e.category,
        description: SAMPLE_EXPENSE_CATEGORIES.find((c) => c.category === e.category)?.label,
        amount: Math.round(e.amount * (0.9 + Math.random() * 0.2)),
        expenseDateKey: key,
        expenseDate: stampOf(key),
      };
    });
    for (const e of monthly) {
      expenses.push({
        id: uid(),
        category: e.category,
        description: e.description,
        amount: e.amount,
        expenseDate: e.expenseDate,
        expenseDateKey: e.expenseDateKey,
        recordedBy: adminUser?.id,
        createdAt: e.expenseDate,
      });
    }
  }

  const SAMPLE_PATIENTS: Array<{
    firstName: string;
    lastName: string;
    dob: string;
    sex: "Male" | "Female";
    phone: string;
    allergies?: string[];
    conditions?: string;
  }> = [
    {
      firstName: "John", lastName: "Okello", dob: "1990-04-12", sex: "Male", phone: "+256 701 223344",
      allergies: ["Penicillin"], conditions: "Hypertension",
    },
    {
      firstName: "Sarah", lastName: "Namuli", dob: "1985-11-02", sex: "Female", phone: "+256 772 556677",
      conditions: "Type 2 Diabetes",
    },
    {
      firstName: "Aisha", lastName: "Nabirye", dob: "2001-06-23", sex: "Female", phone: "+256 701 445566",
      allergies: ["Sulphur drugs"],
    },
    {
      firstName: "Peter", lastName: "Kato", dob: "1978-02-15", sex: "Male", phone: "+256 783 112233",
      conditions: "Asthma",
    },
    {
      firstName: "Grace", lastName: "Achieng", dob: "1995-09-30", sex: "Female", phone: "+256 772 998877",
      allergies: ["Ibuprofen"],
    },
  ];

  const patients: Patient[] = [];
  const patientAllergies: PatientAllergy[] = [];
  const patientYear = new Date().getFullYear();
  SAMPLE_PATIENTS.forEach((def, i) => {
    const pId = uid();
    patients.push({
      id: pId,
      patientNumber: `PAT-${patientYear}-${String(i + 1).padStart(6, "0")}`,
      firstName: def.firstName,
      lastName: def.lastName,
      dob: def.dob,
      sex: def.sex,
      phone: def.phone,
      status: "REGISTERED",
      medicalConditions: def.conditions,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (const allergen of def.allergies ?? []) {
      patientAllergies.push({
        id: uid(),
        patientId: pId,
        allergen,
        severity: undefined,
        recordedBy: adminUser?.id,
        createdAt: timestamp,
      });
    }
  });

  const prescriptions: Prescription[] = [];
  const prescriptionItems: PrescriptionItem[] = [];
  const rxYear = new Date().getFullYear();
  const rxDrafts = [
    {
      patientIndex: 0,
      doctor: "Dr. Sarah Kimuli",
      license: "MED/PC/2017/0042",
      items: [
        { medName: "Amoxicillin 500mg", qty: 15, dosage: "500mg", frequency: "TDS", duration: "5 days", instructions: "After meals" },
        { medName: "Paracetamol 500mg", qty: 20, dosage: "500mg", frequency: "TDS", duration: "3 days", instructions: "When in pain" },
      ],
    },
    {
      patientIndex: 2,
      doctor: "Dr. James Mukasa",
      license: "MED/PC/2019/0117",
      items: [
        { medName: "Coartem 20/120", qty: 24, dosage: "20mg/120mg", frequency: "BD", duration: "3 days", instructions: "With food" },
      ],
    },
    {
      patientIndex: 3,
      doctor: "Dr. Sarah Kimuli",
      license: "MED/PC/2017/0042",
      items: [
        { medName: "Ibuprofen 400mg", qty: 30, dosage: "400mg", frequency: "TDS", duration: "10 days", instructions: "With food" },
      ],
    },
  ] as const;

  rxDrafts.forEach((draft, i) => {
    const rxId = uid();
    const patient = patients[draft.patientIndex];
    prescriptions.push({
      id: rxId,
      prescriptionNumber: `RX-${rxYear}-${String(i + 1).padStart(3, "0")}`,
      patientId: patient.id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      doctorName: draft.doctor,
      doctorLicense: draft.license,
      note: undefined,
      status: "PENDING",
      createdBy: adminUser?.id,
      prescribedDate: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (const item of draft.items) {
      const med = medicines.find((m) => m.name === item.medName);
      if (!med) continue;
      prescriptionItems.push({
        id: uid(),
        prescriptionId: rxId,
        medicineId: med.id,
        medicineName: med.name,
        quantity: item.qty,
        strength: med.strength,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions,
        dispensedQty: 0,
        createdAt: timestamp,
      });
    }
  });

  const drugInteractions: DrugInteraction[] = [];
  const medicineWarnings: MedicineWarning[] = [];

  const findMedId = (name: string) =>
    medicines.find((m) => m.name === name)?.id;

  const interactionPairs: Array<{
    a: string;
    b: string;
    severity: DrugInteraction["severity"];
    detail: string;
  }> = [
    {
      a: "Amoxicillin 500mg",
      b: "Ibuprofen 400mg",
      severity: "MODERATE",
      detail: "NSAIDs may reduce the renal clearance of penicillins.",
    },
    {
      a: "Coartem 20/120",
      b: "Metronidazole 400mg",
      severity: "MAJOR",
      detail: "Additive QT interval prolongation risk; use with caution.",
    },
    {
      a: "Diazepam 5mg",
      b: "Codeine Phosphate 30mg",
      severity: "MAJOR",
      detail: "Additive CNS and respiratory depression.",
    },
    {
      a: "Ciprofloxacin 500mg",
      b: "Ibuprofen 400mg",
      severity: "CONTRAINDICATED",
      detail: "Increased risk of CNS toxicity and seizures.",
    },
  ];
  for (const pair of interactionPairs) {
    const aId = findMedId(pair.a);
    const bId = findMedId(pair.b);
    if (!aId || !bId) continue;
    drugInteractions.push({
      id: uid(),
      medicineAId: aId,
      medicineBId: bId,
      severity: pair.severity,
      detail: pair.detail,
      createdAt: timestamp,
    });
  }

  const warningDefs: Array<{
    medName: string;
    warningType: MedicineWarning["warningType"];
    condition: string;
    message: string;
    severity: MedicineWarning["severity"];
  }> = [
    {
      medName: "Coartem 20/120",
      warningType: "PREGNANCY",
      condition: "",
      message: "Avoid in pregnancy; safety not established.",
      severity: "SEVERE",
    },
    {
      medName: "Ibuprofen 400mg",
      warningType: "PREGNANCY",
      condition: "",
      message: "Avoid during the third trimester.",
      severity: "WARNING",
    },
    {
      medName: "Diclofenac 50mg",
      warningType: "CONTRAINDICATION",
      condition: "asthma",
      message: "NSAIDs may precipitate asthma in sensitive patients.",
      severity: "SEVERE",
    },
    {
      medName: "Codeine Phosphate 30mg",
      warningType: "LACTATION",
      condition: "",
      message: "Contraindicated while breastfeeding — risk of infant respiratory depression.",
      severity: "SEVERE",
    },
    {
      medName: "Diazepam 5mg",
      warningType: "LACTATION",
      condition: "",
      message: "Avoid while breastfeeding.",
      severity: "WARNING",
    },
    {
      medName: "Paracetamol 500mg",
      warningType: "DOSE",
      condition: "",
      message: "Maximum 4 g per day in adults.",
      severity: "INFO",
    },
  ];
  for (const w of warningDefs) {
    const medId = findMedId(w.medName);
    if (!medId) continue;
    medicineWarnings.push({
      id: uid(),
      medicineId: medId,
      warningType: w.warningType,
      condition: w.condition,
      message: w.message,
      severity: w.severity,
      createdAt: timestamp,
    });
  }

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.suppliers,
      pharmaDb.customers,
      pharmaDb.medicines,
      pharmaDb.medicineBarcodes,
      pharmaDb.medicineUnits,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.expenses,
      pharmaDb.patients,
      pharmaDb.patientAllergies,
      pharmaDb.prescriptions,
      pharmaDb.prescriptionItems,
      pharmaDb.drugInteractions,
      pharmaDb.medicineWarnings,
      pharmaDb.systemSettings,
    ],
    async () => {
      await pharmaDb.suppliers.bulkAdd(suppliers);
      await pharmaDb.customers.bulkAdd(customers);
      await pharmaDb.medicines.bulkAdd(medicines);
      await pharmaDb.medicineBarcodes.bulkAdd(barcodes);
      await pharmaDb.medicineUnits.bulkAdd(units);
      await pharmaDb.medicineBatches.bulkAdd(batches);
      await pharmaDb.stockMovements.bulkAdd([
        ...purchaseMovements,
        ...saleMovements,
      ]);
      await pharmaDb.sales.bulkAdd(sales);
      await pharmaDb.saleItems.bulkAdd(saleItems);
      await pharmaDb.expenses.bulkAdd(expenses);
      await pharmaDb.patients.bulkAdd(patients);
      await pharmaDb.patientAllergies.bulkAdd(patientAllergies);
      await pharmaDb.prescriptions.bulkAdd(prescriptions);
      await pharmaDb.prescriptionItems.bulkAdd(prescriptionItems);
      await pharmaDb.drugInteractions.bulkAdd(drugInteractions);
      await pharmaDb.medicineWarnings.bulkAdd(medicineWarnings);
      await pharmaDb.systemSettings.add({
        id: uid(),
        settingKey: DEMO_FLAG_KEY,
        settingValue: "1",
        updatedAt: now(),
      });
    },
  );

    demoDone = true;
    return true;
  } finally {
    demoSeeding = false;
  }
}
