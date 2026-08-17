import { useLiveQuery } from "dexie-react-hooks";
import { pharmaDb } from "../db";

export type Tier = "ESSENTIAL" | "PROFESSIONAL" | "ADVANCED" | "ENTERPRISE";

export interface ModuleDef {
  id: string;
  tier: Exclude<Tier, "ESSENTIAL">;
  label: string;
  description: string;
  dependsOn?: string[];
}

export const TIER_META: Record<
  Tier,
  { label: string; blurb: string; badge: "slate" | "blue" | "amber" | "red" }
> = {
  ESSENTIAL: {
    label: "Essential",
    blurb: "Core pharmacy operations — always on",
    badge: "slate",
  },
  PROFESSIONAL: {
    label: "Professional",
    blurb: "Procurement, inventory & finance controls",
    badge: "blue",
  },
  ADVANCED: {
    label: "Advanced",
    blurb: "Patients, prescriptions & compliance",
    badge: "amber",
  },
  ENTERPRISE: {
    label: "Enterprise",
    blurb: "Branches, cold chain & analytics",
    badge: "red",
  },
};

export const PHARMA_MODULES: ModuleDef[] = [
  // Professional
  {
    id: "PROCUREMENT",
    tier: "PROFESSIONAL",
    label: "Procurement",
    description:
      "Purchase requests, purchase orders, GRNs, supplier invoices & payments",
  },
  {
    id: "SUPPLIER_CENTER",
    tier: "PROFESSIONAL",
    label: "Supplier Center",
    description: "Supplier products, price history & performance ratings",
  },
  {
    id: "STOCK_TAKES",
    tier: "PROFESSIONAL",
    label: "Stock Taking",
    description: "Physical counts, variance & approval workflow",
  },
  {
    id: "LOCATIONS",
    tier: "PROFESSIONAL",
    label: "Storage Locations",
    description: "Rooms, shelves & bins for stock placement",
  },
  {
    id: "TRANSFERS",
    tier: "PROFESSIONAL",
    label: "Stock Transfers",
    description: "Move stock between locations",
    dependsOn: ["LOCATIONS"],
  },
  {
    id: "QUARANTINE",
    tier: "PROFESSIONAL",
    label: "Quarantine",
    description: "Hold suspect batches away from sale",
  },
  {
    id: "CREDIT_ACCOUNTS",
    tier: "PROFESSIONAL",
    label: "Customer Credit",
    description: "Credit limits, ledgers & statements",
  },
  {
    id: "CORPORATE_ACCOUNTS",
    tier: "PROFESSIONAL",
    label: "Corporate & Insurance",
    description: "Company / insurer accounts & payer billing",
  },
  {
    id: "SHIFTS",
    tier: "PROFESSIONAL",
    label: "Shifts",
    description: "Cashier open/close with cash variance",
  },
  {
    id: "CASH_DRAWER",
    tier: "PROFESSIONAL",
    label: "Cash Drawer",
    description: "Cash movement logging",
    dependsOn: ["SHIFTS"],
  },
  // Advanced
  {
    id: "PATIENTS",
    tier: "ADVANCED",
    label: "Patients",
    description: "Patient profiles, allergies & medication history",
  },
  {
    id: "PRESCRIPTIONS",
    tier: "ADVANCED",
    label: "Prescriptions",
    description: "Prescription capture, upload & dispensing records",
    dependsOn: ["PATIENTS"],
  },
  {
    id: "CONTROLLED_MEDICINES",
    tier: "ADVANCED",
    label: "Controlled Medicines",
    description: "Restricted drug register & authorization",
  },
  {
    id: "SAFETY_ENGINE",
    tier: "ADVANCED",
    label: "Drug Safety",
    description: "Interactions, allergies & dispensing warnings",
  },
  {
    id: "KNOWLEDGE_BASE",
    tier: "ADVANCED",
    label: "Medicine Knowledge Base",
    description: "Structured medicine information profiles",
  },
  {
    id: "RECALL",
    tier: "ADVANCED",
    label: "Recall",
    description: "Batch recall & sale hold management",
  },
  // Enterprise
  {
    id: "BRANCHES",
    tier: "ENTERPRISE",
    label: "Branches",
    description: "Multi-location & warehouse management",
  },
  {
    id: "COLD_CHAIN",
    tier: "ENTERPRISE",
    label: "Cold Chain",
    description: "Temperature monitoring & excursion records",
  },
  {
    id: "ANALYTICS",
    tier: "ENTERPRISE",
    label: "Analytics",
    description: "Business intelligence & demand forecasting",
  },
  {
    id: "AI_ASSISTANT",
    tier: "ENTERPRISE",
    label: "AI Assistant",
    description: "Natural-language management insights",
    dependsOn: ["ANALYTICS"],
  },
];

export const MODULE_BY_ID = new Map(
  PHARMA_MODULES.map((m) => [m.id, m]),
);

export const TIER_MODULES: Record<
  Exclude<Tier, "ESSENTIAL">,
  ModuleDef[]
> = {
  PROFESSIONAL: PHARMA_MODULES.filter((m) => m.tier === "PROFESSIONAL"),
  ADVANCED: PHARMA_MODULES.filter((m) => m.tier === "ADVANCED"),
  ENTERPRISE: PHARMA_MODULES.filter((m) => m.tier === "ENTERPRISE"),
};

export interface SetupRequirement {
  key: string;
  label: string;
  description: string;
  modules: string[];
  tier: Tier;
}

export const SETUP_REQUIREMENTS: SetupRequirement[] = [
  {
    key: "SUPPLIERS_PROCUREMENT",
    label: "Suppliers & Procurement",
    description: "Purchase orders, GRNs, supplier invoices and balances",
    modules: ["PROCUREMENT", "SUPPLIER_CENTER"],
    tier: "PROFESSIONAL",
  },
  {
    key: "ADVANCED_INVENTORY",
    label: "Advanced Inventory",
    description: "Stock taking, storage locations, transfers and quarantine",
    modules: ["STOCK_TAKES", "LOCATIONS", "TRANSFERS", "QUARANTINE"],
    tier: "PROFESSIONAL",
  },
  {
    key: "CUSTOMER_CREDIT",
    label: "Customer Credit",
    description: "Credit limits, ledgers and statements",
    modules: ["CREDIT_ACCOUNTS"],
    tier: "PROFESSIONAL",
  },
  {
    key: "CORPORATE",
    label: "Corporate & Insurance",
    description: "Company and insurer accounts",
    modules: ["CORPORATE_ACCOUNTS"],
    tier: "PROFESSIONAL",
  },
  {
    key: "SHIFTS",
    label: "Shifts & Cash Drawer",
    description: "Cashier shifts and cash logs",
    modules: ["SHIFTS", "CASH_DRAWER"],
    tier: "PROFESSIONAL",
  },
  {
    key: "PATIENTS",
    label: "Patients",
    description: "Patient profiles and history",
    modules: ["PATIENTS"],
    tier: "ADVANCED",
  },
  {
    key: "PRESCRIPTIONS",
    label: "Prescriptions & Dispensing",
    description: "Prescription capture and dispensing records",
    modules: ["PATIENTS", "PRESCRIPTIONS"],
    tier: "ADVANCED",
  },
  {
    key: "CONTROLLED",
    label: "Controlled Medicines",
    description: "Restricted drug register",
    modules: ["CONTROLLED_MEDICINES"],
    tier: "ADVANCED",
  },
  {
    key: "SAFETY",
    label: "Drug Safety Alerts",
    description: "Interactions, allergies and warnings",
    modules: ["SAFETY_ENGINE"],
    tier: "ADVANCED",
  },
  {
    key: "KNOWLEDGE",
    label: "Medicine Knowledge Base",
    description: "Structured drug profiles",
    modules: ["KNOWLEDGE_BASE"],
    tier: "ADVANCED",
  },
  {
    key: "RECALL",
    label: "Expiry & Recall",
    description: "Recall management and sale holds",
    modules: ["RECALL"],
    tier: "ADVANCED",
  },
  {
    key: "COLD_CHAIN",
    label: "Cold Chain",
    description: "Temperature monitoring",
    modules: ["COLD_CHAIN"],
    tier: "ENTERPRISE",
  },
  {
    key: "BRANCHES",
    label: "Multiple Branches",
    description: "Multi-location and warehouse",
    modules: ["BRANCHES", "TRANSFERS"],
    tier: "ENTERPRISE",
  },
  {
    key: "ANALYTICS",
    label: "Analytics & AI",
    description: "Business insights and assistant",
    modules: ["ANALYTICS", "AI_ASSISTANT"],
    tier: "ENTERPRISE",
  },
];

export const ESSENTIAL_MODULE_IDS = new Set<string>([
  "DASHBOARD",
  "POS",
  "SALES",
  "MEDICINES",
  "INVENTORY",
  "BATCHES",
  "SUPPLIERS",
  "STOCK_MOVEMENTS",
  "PAYMENTS",
  "REFUNDS",
  "EXPENSES",
  "BALANCING",
  "REPORTS",
  "CUSTOMERS",
  "CATEGORIES",
  "USERS",
  "SETTINGS",
]);

export function isEssential(id: string): boolean {
  return ESSENTIAL_MODULE_IDS.has(id);
}

async function readStoredModules(): Promise<string[]> {
  const row = await pharmaDb.systemSettings
    .where("settingKey")
    .equals("enabled_modules")
    .first();
  if (!row) return [];
  try {
    return JSON.parse(row.settingValue) as string[];
  } catch {
    return [];
  }
}

export async function getEnabledModules(): Promise<Set<string>> {
  return new Set([...ESSENTIAL_MODULE_IDS, ...(await readStoredModules())]);
}

export function useEnabledModules(): Set<string> | undefined {
  return useLiveQuery(async () => {
    return new Set([...ESSENTIAL_MODULE_IDS, ...(await readStoredModules())]);
  }, []);
}

export function moduleEnabled(enabled: Set<string>, id: string): boolean {
  return isEssential(id) || enabled.has(id);
}

export function resolveTier(enabled: Set<string>): Tier {
  const order: Array<Exclude<Tier, "ESSENTIAL">> = [
    "ENTERPRISE",
    "ADVANCED",
    "PROFESSIONAL",
  ];
  for (const t of order) {
    if (PHARMA_MODULES.some((m) => m.tier === t && enabled.has(m.id))) {
      return t;
    }
  }
  return "ESSENTIAL";
}
