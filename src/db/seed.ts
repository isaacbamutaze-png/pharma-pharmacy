import { pharmaDb } from "./index";
import { hashPassword } from "../lib/password";
import { uid, now } from "../lib/utils";

const CATEGORY_NAMES = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Suspension",
  "Sachet",
];

const DEFAULT_SETTINGS: Array<[string, string]> = [
  ["pharmacy_name", "My Pharmacy"],
  ["pharmacy_address", ""],
  ["pharmacy_phone", ""],
  ["currency", "UGX"],
  ["tax_rate", "0"],
  ["expiry_warning_days", "60"],
  ["low_stock_threshold", "10"],
  ["invoice_prefix", "INV"],
  ["receipt_footer", "Thank you for your purchase. Get well soon!"],
];

let seeding = false;
let seedDone = false;

export async function seedDatabase(): Promise<void> {
  if (seedDone) return;
  if (seeding) return;
  seeding = true;

  try {
    const roleCount = await pharmaDb.roles.count();
    if (roleCount > 0) {
      seedDone = true;
      return;
    }

    const adminRoleId = uid();
    const userRoleId = uid();
    const timestamp = now();

    await pharmaDb.transaction(
      "rw",
      [
        pharmaDb.roles,
        pharmaDb.users,
        pharmaDb.medicineCategories,
        pharmaDb.systemSettings,
      ],
      async () => {
        await pharmaDb.roles.bulkAdd([
          { id: adminRoleId, name: "ADMIN", description: "Full management access", createdAt: timestamp },
          { id: userRoleId, name: "USER", description: "Daily pharmacy operator", createdAt: timestamp },
        ]);

        const adminPasswordHash = await hashPassword("admin123");
        await pharmaDb.users.add({
          id: uid(),
          roleId: adminRoleId,
          fullName: "System Administrator",
          username: "admin",
          passwordHash: adminPasswordHash,
          phone: "",
          email: "",
          status: "ACTIVE",
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        const userPasswordHash = await hashPassword("user123");
        await pharmaDb.users.add({
          id: uid(),
          roleId: userRoleId,
          fullName: "Pharmacy User",
          username: "user",
          passwordHash: userPasswordHash,
          phone: "",
          email: "",
          status: "ACTIVE",
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        await pharmaDb.medicineCategories.bulkAdd(
          CATEGORY_NAMES.map((name) => ({
            id: uid(),
            name,
            createdAt: timestamp,
          })),
        );

        await pharmaDb.systemSettings.bulkAdd(
          DEFAULT_SETTINGS.map(([settingKey, settingValue]) => ({
            id: uid(),
            settingKey,
            settingValue,
            updatedAt: timestamp,
          })),
        );
      },
    );

    seedDone = true;
  } finally {
    seeding = false;
  }
}
