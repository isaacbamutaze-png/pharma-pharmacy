import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import type {
  InteractionSeverity,
  MedicineWarning,
  SafetyAlertCheck,
  SafetyCheckType,
} from "../types";

export interface SafetyCheckResult {
  checkType: SafetyCheckType;
  severity: InteractionSeverity | "INFO";
  outcome: "PASS" | "WARN";
  detail: string;
  medicineId?: string;
  medicineName?: string;
  relatedMedicineId?: string;
}

export interface RunSafetyInput {
  patientId: string;
  medicineIds: string[];
  prescriptionId?: string;
}

const SEVERITY_RANK: Record<InteractionSeverity | "INFO", number> = {
  INFO: 0,
  MINOR: 1,
  MODERATE: 2,
  MAJOR: 3,
  CONTRAINDICATED: 4,
};

/**
 * Clinical decision-support only. Evaluates a patient + medicine set for
 * allergies, interactions, duplicate therapy, contraindications, age,
 * pregnancy/lactation and dose warnings. Never blocks the flow by itself;
 * the caller decides what is blocking.
 */
export async function runSafetyChecks(
  input: RunSafetyInput,
): Promise<SafetyCheckResult[]> {
  const results: SafetyCheckResult[] = [];

  const patient = await pharmaDb.patients.get(input.patientId);
  if (!patient) return results;

  const meds = (
    await pharmaDb.medicines.bulkGet(input.medicineIds)
  ).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (meds.length === 0) return results;

  const medById = new Map(meds.map((m) => [m.id, m]));

  const allergies = await pharmaDb.patientAllergies
    .where("patientId")
    .equals(patient.id)
    .toArray();

  // ── Allergy ──────────────────────────────────────────────────────────────
  for (const allergy of allergies) {
    const allergen = allergy.allergen.trim().toLowerCase();
    if (!allergen) continue;
    for (const med of meds) {
      const hay = `${med.name} ${med.genericName ?? ""} ${med.strength ?? ""}`
        .toLowerCase();
      if (!hay.includes(allergen)) continue;
      results.push({
        checkType: "ALLERGY",
        severity: "MAJOR",
        outcome: "WARN",
        detail: `${patient.firstName} is allergic to ${allergy.allergen}, which matches ${med.name}.`,
        medicineId: med.id,
        medicineName: med.name,
      });
    }
  }

  // ── Interactions (pairwise) ──────────────────────────────────────────────
  const interactions = await pharmaDb.drugInteractions.toArray();
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i];
      const b = meds[j];
      const hit = interactions.find(
        (x) =>
          (x.medicineAId === a.id && x.medicineBId === b.id) ||
          (x.medicineAId === b.id && x.medicineBId === a.id),
      );
      if (!hit) continue;
      results.push({
        checkType: "INTERACTION",
        severity: hit.severity,
        outcome: "WARN",
        detail: `${a.name} + ${b.name}: ${hit.detail}`,
        medicineId: a.id,
        medicineName: a.name,
        relatedMedicineId: b.id,
      });
    }
  }

  // ── Duplicate therapy ────────────────────────────────────────────────────
  const genericGroups = new Map<string, string[]>();
  for (const med of meds) {
    const key = (med.genericName ?? med.name).trim().toLowerCase();
    if (!key) continue;
    const list = genericGroups.get(key) ?? [];
    list.push(med.name);
    genericGroups.set(key, list);
  }
  for (const [key, names] of genericGroups) {
    if (names.length < 2) continue;
    results.push({
      checkType: "DUPLICATE_THERAPY",
      severity: "MODERATE",
      outcome: "WARN",
      detail: `${names.join(" + ")} share the same active ingredient "${key}".`,
      medicineId: meds.find(
        (m) => (m.genericName ?? m.name).trim().toLowerCase() === key,
      )?.id,
      medicineName: names[0],
    });
  }

  // ── Warnings from the medicine knowledge data ────────────────────────────
  const warnings = (
    await pharmaDb.medicineWarnings
      .where("medicineId")
      .anyOf(input.medicineIds)
      .toArray()
  ) as MedicineWarning[];
  const medicalText =
    `${patient.medicalConditions ?? ""} ${patient.chronicConditions ?? ""}`.toLowerCase();

  const age = ageOf(patient.dob);

  for (const w of warnings) {
    const med = medById.get(w.medicineId);
    const name = med?.name ?? "Medicine";
    switch (w.warningType) {
      case "CONTRAINDICATION": {
        const cond = w.condition.trim().toLowerCase();
        if (!cond || medicalText.includes(cond)) {
          results.push({
            checkType: "CONTRAINDICATION",
            severity: "MAJOR",
            outcome: "WARN",
            detail: `${name}: ${w.message}`,
            medicineId: w.medicineId,
            medicineName: name,
          });
        }
        break;
      }
      case "AGE": {
        const cond = w.condition.trim().toLowerCase();
        const matchesAge =
          (cond.includes("child") || cond.includes("under 12") || cond.includes("pediatric")) &&
          age !== null &&
          age < 12;
        if (matchesAge) {
          results.push({
            checkType: "AGE",
            severity: "MODERATE",
            outcome: "WARN",
            detail: `${name}: ${w.message}`,
            medicineId: w.medicineId,
            medicineName: name,
          });
        }
        break;
      }
      case "PREGNANCY":
      case "LACTATION": {
        if (patient.sex?.toUpperCase() === "F") {
          results.push({
            checkType: w.warningType,
            severity: w.severity === "SEVERE" ? "MAJOR" : "MODERATE",
            outcome: "WARN",
            detail: `${name}: ${w.message}`,
            medicineId: w.medicineId,
            medicineName: name,
          });
        }
        break;
      }
      case "DOSE": {
        results.push({
          checkType: "DOSE",
          severity: w.severity === "SEVERE" ? "MAJOR" : "MODERATE",
          outcome: "WARN",
          detail: `${name}: ${w.message}`,
          medicineId: w.medicineId,
          medicineName: name,
        });
        break;
      }
    }
  }

  return results.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

export interface SafetyOverrideInput {
  checkType: SafetyCheckType;
  reason: string;
}

export interface RecordChecksInput {
  patientId: string;
  prescriptionId?: string;
  results: SafetyCheckResult[];
  overrides?: SafetyOverrideInput[];
  actorId: string;
  actorName?: string;
}

/** Persists the outcome of a safety-engine run. No override is silent. */
export async function recordSafetyChecks(
  input: RecordChecksInput,
): Promise<SafetyAlertCheck[]> {
  const timestamp = now();
  const overrideByType = new Map(
    (input.overrides ?? []).map((o) => [o.checkType, o.reason.trim()]),
  );
  const checks: SafetyAlertCheck[] = input.results.map((r) => {
    const reason = overrideByType.get(r.checkType);
    return {
      id: uid(),
      patientId: input.patientId,
      prescriptionId: input.prescriptionId,
      checkType: r.checkType,
      severity: r.severity,
      outcome: reason ? "OVERRIDE" : r.outcome,
      detail: r.detail,
      overriddenBy: reason ? input.actorId : undefined,
      overrideReason: reason || undefined,
      checkedAt: timestamp,
    };
  });

  if (checks.length > 0) {
    await pharmaDb.safetyAlertChecks.bulkAdd(checks);
  }
  for (const c of checks) {
    if (c.outcome !== "OVERRIDE") continue;
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: input.actorId,
      action: "SAFETY_OVERRIDE",
      entityType: "safetyAlertCheck",
      entityId: c.id,
      oldValues: { outcome: "WARN" },
      newValues: {
        checkType: c.checkType,
        detail: c.detail,
        overrideReason: c.overrideReason,
      },
      createdAt: timestamp,
    });
  }

  return checks;
}

export function isBlockingResult(result: SafetyCheckResult): boolean {
  return result.checkType === "ALLERGY";
}

export function severityTone(
  severity: InteractionSeverity | "INFO",
): "green" | "amber" | "red" | "slate" {
  switch (severity) {
    case "INFO":
      return "green";
    case "MINOR":
    case "MODERATE":
      return "amber";
    default:
      return "red";
  }
}

function ageOf(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const nowDate = new Date();
  let a = nowDate.getFullYear() - d.getFullYear();
  const m = nowDate.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && nowDate.getDate() < d.getDate())) a--;
  return a;
}
