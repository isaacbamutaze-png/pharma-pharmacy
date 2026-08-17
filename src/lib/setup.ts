import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { ESSENTIAL_MODULE_IDS, resolveTier, type Tier } from "./modules";

export type BusinessType =
  | "DRUG_SHOP"
  | "PHARMACY"
  | "HOSPITAL_CLINIC"
  | "PHARMACY_GROUP";

export type BusinessSize =
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "MULTI_LOCATION";

export interface BusinessProfile {
  businessType: BusinessType;
  businessTypeLabel: string;
  size: BusinessSize;
  sizeLabel: string;
  locations: number;
  users: number;
  branchNames?: string[];
  tier: Tier;
  configuredAt: number;
  configuredBy?: string;
}

export const BUSINESS_TYPES: Array<{
  value: BusinessType;
  label: string;
  description: string;
}> = [
  {
    value: "DRUG_SHOP",
    label: "Drug Shop",
    description: "Community medicine outlet",
  },
  {
    value: "PHARMACY",
    label: "Pharmacy",
    description: "Licensed retail pharmacy",
  },
  {
    value: "HOSPITAL_CLINIC",
    label: "Hospital / Clinic Pharmacy",
    description: "Facility-based pharmacy",
  },
  {
    value: "PHARMACY_GROUP",
    label: "Pharmacy Group",
    description: "Multiple branches / chain",
  },
];

export const BUSINESS_SIZES: Array<{
  value: BusinessSize;
  label: string;
  description: string;
}> = [
  { value: "SMALL", label: "Small", description: "1 location, small team" },
  {
    value: "MEDIUM",
    label: "Medium",
    description: "1 location, several employees",
  },
  {
    value: "LARGE",
    label: "Large",
    description: "Large inventory, departments",
  },
  {
    value: "MULTI_LOCATION",
    label: "Multiple Locations",
    description: "More than one branch",
  },
];

export async function getSetting(key: string): Promise<string | undefined> {
  const row = await pharmaDb.systemSettings
    .where("settingKey")
    .equals(key)
    .first();
  return row?.settingValue;
}

export async function setSetting(
  key: string,
  value: string,
  actorId?: string,
): Promise<void> {
  const row = await pharmaDb.systemSettings
    .where("settingKey")
    .equals(key)
    .first();
  if (row) {
    await pharmaDb.systemSettings.update(row.id, {
      settingValue: value,
      updatedBy: actorId,
      updatedAt: now(),
    });
  } else {
    await pharmaDb.systemSettings.add({
      id: uid(),
      settingKey: key,
      settingValue: value,
      updatedBy: actorId,
      updatedAt: now(),
    });
  }
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getSetting("setup_complete")) === "true";
}

export async function getBusinessProfile(): Promise<BusinessProfile | null> {
  const raw = await getSetting("business_profile");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BusinessProfile;
  } catch {
    return null;
  }
}

export interface BusinessSetupInput {
  businessType: BusinessType;
  businessTypeLabel: string;
  size: BusinessSize;
  sizeLabel: string;
  locations: number;
  users: number;
  branchNames?: string[];
  modules: string[];
  pharmacyName?: string;
  pharmacyAddress?: string;
  pharmacyPhone?: string;
  currency?: string;
  invoicePrefix?: string;
  receiptFooter?: string;
  actorId?: string;
}

export async function saveBusinessSetup(
  input: BusinessSetupInput,
): Promise<{ tier: Tier; modules: string[] }> {
  const nonEssential = [
    ...new Set(input.modules.filter((m) => !ESSENTIAL_MODULE_IDS.has(m))),
  ];
  const enabled = new Set([...ESSENTIAL_MODULE_IDS, ...nonEssential]);
  const tier = resolveTier(enabled);

  const profile: BusinessProfile = {
    businessType: input.businessType,
    businessTypeLabel: input.businessTypeLabel,
    size: input.size,
    sizeLabel: input.sizeLabel,
    locations: input.locations,
    users: input.users,
    branchNames:
      input.branchNames && input.branchNames.length
        ? input.branchNames
        : undefined,
    tier,
    configuredAt: now(),
    configuredBy: input.actorId,
  };

  const settings: Record<string, string> = {
    setup_complete: "true",
    enabled_modules: JSON.stringify(nonEssential),
    business_profile: JSON.stringify(profile),
  };
  if (input.pharmacyName) settings.pharmacy_name = input.pharmacyName;
  if (input.pharmacyAddress) settings.pharmacy_address = input.pharmacyAddress;
  if (input.pharmacyPhone) settings.pharmacy_phone = input.pharmacyPhone;
  if (input.currency) settings.currency = input.currency;
  if (input.invoicePrefix) settings.invoice_prefix = input.invoicePrefix;
  if (input.receiptFooter) settings.receipt_footer = input.receiptFooter;

  for (const [key, value] of Object.entries(settings)) {
    await setSetting(key, value, input.actorId);
  }

  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.actorId ?? "system",
    action: "UPDATE",
    entityType: "business_setup",
    newValues: {
      tier,
      modules: nonEssential,
      businessType: input.businessType,
      locations: input.locations,
    },
    createdAt: now(),
  });

  return { tier, modules: nonEssential };
}
