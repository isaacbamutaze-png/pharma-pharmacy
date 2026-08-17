import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import type { Patient, PatientAllergy, PatientMedicalHistory } from "../types";

export type PatientStatus = Patient["status"];

export function fullName(p: {
  firstName: string;
  middleName?: string;
  lastName: string;
}): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
}

export function ageOf(p: Patient): number | null {
  if (!p.dob) return null;
  const dob = new Date(`${p.dob}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function patientStatusTone(
  status: PatientStatus,
): "green" | "red" | "amber" | "slate" | "blue" {
  switch (status) {
    case "OUTPATIENT":
      return "green";
    case "ADMITTED":
      return "amber";
    case "TRANSFERRED":
      return "blue";
    case "DISCHARGED":
      return "slate";
    case "DECEASED":
      return "red";
    default:
      return "slate";
  }
}

export const PATIENT_STATUSES: PatientStatus[] = [
  "REGISTERED",
  "OUTPATIENT",
  "ADMITTED",
  "TRANSFERRED",
  "DISCHARGED",
  "DECEASED",
];

/** Auto-generated, permanent, never-reused per year: PAT-YYYY-NNNNNN */
export async function nextPatientNumber(): Promise<string> {
  const prefix = `PAT-${new Date().getFullYear()}-`;
  const patients = await pharmaDb.patients.toArray();
  let max = 0;
  for (const p of patients) {
    if (!p.patientNumber.startsWith(prefix)) continue;
    const n = Number(p.patientNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

export class PatientDuplicateError extends Error {
  duplicates: Patient[];
  constructor(duplicates: Patient[]) {
    super("Possible existing patient found.");
    this.name = "PatientDuplicateError";
    this.duplicates = duplicates;
  }
}

export interface PatientInput {
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
  allergies?: Array<{
    allergen: string;
    severity?: string;
    reaction?: string;
  }>;
  medicalHistory?: Array<{
    condition: string;
    onsetDate?: string;
    notes?: string;
  }>;
}

export async function findPatientDuplicates(
  input: PatientInput,
): Promise<Patient[]> {
  const key = (s: string) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const fname = key(input.firstName);
  const lname = key(input.lastName);
  const dob = input.dob || "";
  const phone = (input.phone ?? "").trim();
  const candidates = await pharmaDb.patients.toArray();
  return candidates.filter((p) => {
    const sameName = key(p.firstName) === fname && key(p.lastName) === lname;
    if (dob && p.dob === dob && sameName) return true;
    if (phone && p.phone === phone) return true;
    return false;
  });
}

export async function createPatient(
  input: PatientInput,
  actorId: string,
  force = false,
): Promise<Patient> {
  if (!input.firstName.trim() || !input.lastName.trim()) {
    throw new Error("First and last name are required.");
  }
  if (!force) {
    const dups = await findPatientDuplicates(input);
    if (dups.length > 0) throw new PatientDuplicateError(dups);
  }

  const timestamp = now();
  const patient: Patient = {
    id: uid(),
    patientNumber: await nextPatientNumber(),
    firstName: input.firstName.trim(),
    middleName: input.middleName?.trim() || undefined,
    lastName: input.lastName.trim(),
    dob: input.dob || "",
    sex: input.sex,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    address: input.address?.trim() || undefined,
    nationality: input.nationality?.trim() || undefined,
    emergencyContact: input.emergencyContact?.trim() || undefined,
    nationalId: input.nationalId?.trim() || undefined,
    insuranceNumber: input.insuranceNumber?.trim() || undefined,
    bloodGroup: input.bloodGroup,
    medicalConditions: input.medicalConditions?.trim() || undefined,
    chronicConditions: input.chronicConditions?.trim() || undefined,
    status: "REGISTERED",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.patients,
      pharmaDb.patientAllergies,
      pharmaDb.patientMedicalHistory,
      pharmaDb.auditLogs,
    ],
    async () => {
      await pharmaDb.patients.add(patient);

      const allergies = (input.allergies ?? [])
        .filter((a) => a.allergen.trim())
        .map(
          (a) =>
            ({
              id: uid(),
              patientId: patient.id,
              allergen: a.allergen.trim(),
              severity: a.severity,
              reaction: a.reaction?.trim() || undefined,
              recordedBy: actorId,
              createdAt: timestamp,
            }) as PatientAllergy,
        );
      if (allergies.length > 0) {
        await pharmaDb.patientAllergies.bulkAdd(allergies);
      }

      const history = (input.medicalHistory ?? [])
        .filter((h) => h.condition.trim())
        .map(
          (h) =>
            ({
              id: uid(),
              patientId: patient.id,
              condition: h.condition.trim(),
              onsetDate: h.onsetDate || undefined,
              notes: h.notes?.trim() || undefined,
              recordedBy: actorId,
              createdAt: timestamp,
            }) as PatientMedicalHistory,
        );
      if (history.length > 0) {
        await pharmaDb.patientMedicalHistory.bulkAdd(history);
      }

      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: actorId,
        action: "CREATE",
        entityType: "patient",
        entityId: patient.id,
        newValues: {
          patientNumber: patient.patientNumber,
          fullName: fullName(patient),
        },
        createdAt: timestamp,
      });
    },
  );

  return patient;
}

export async function updatePatient(
  id: string,
  patch: Partial<Patient>,
  actorId: string,
): Promise<void> {
  const before = await pharmaDb.patients.get(id);
  if (!before) throw new Error("Patient not found.");
  const timestamp = now();
  await pharmaDb.patients.update(id, { ...patch, updatedAt: timestamp });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: actorId,
    action: "UPDATE",
    entityType: "patient",
    entityId: id,
    oldValues: { patientNumber: before.patientNumber, status: before.status },
    newValues: patch,
    createdAt: timestamp,
  });
}

export async function setPatientStatus(
  id: string,
  status: PatientStatus,
  actorId: string,
): Promise<void> {
  const before = await pharmaDb.patients.get(id);
  if (!before) throw new Error("Patient not found.");
  if (before.status === status) return;
  const timestamp = now();
  await pharmaDb.patients.update(id, { status, updatedAt: timestamp });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: actorId,
    action: "PATIENT_STATUS",
    entityType: "patient",
    entityId: id,
    oldValues: { status: before.status },
    newValues: { status },
    createdAt: timestamp,
  });
}

export async function addPatientAllergy(input: {
  patientId: string;
  allergen: string;
  severity?: string;
  reaction?: string;
  recordedBy: string;
}): Promise<void> {
  if (!input.allergen.trim()) throw new Error("Allergen is required.");
  const timestamp = now();
  await pharmaDb.patientAllergies.add({
    id: uid(),
    patientId: input.patientId,
    allergen: input.allergen.trim(),
    severity: input.severity,
    reaction: input.reaction?.trim() || undefined,
    recordedBy: input.recordedBy,
    createdAt: timestamp,
  });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.recordedBy,
    action: "ADD",
    entityType: "patient_allergy",
    entityId: input.patientId,
    newValues: { allergen: input.allergen.trim() },
    createdAt: timestamp,
  });
}

export async function addPatientHistory(input: {
  patientId: string;
  condition: string;
  onsetDate?: string;
  notes?: string;
  recordedBy: string;
}): Promise<void> {
  if (!input.condition.trim()) throw new Error("Condition is required.");
  const timestamp = now();
  await pharmaDb.patientMedicalHistory.add({
    id: uid(),
    patientId: input.patientId,
    condition: input.condition.trim(),
    onsetDate: input.onsetDate || undefined,
    notes: input.notes?.trim() || undefined,
    recordedBy: input.recordedBy,
    createdAt: timestamp,
  });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.recordedBy,
    action: "ADD",
    entityType: "patient_medical_history",
    entityId: input.patientId,
    newValues: { condition: input.condition.trim() },
    createdAt: timestamp,
  });
}
