import { round2 } from "../sales";
import type { AssistantContext } from "../assistant";
import type {
  PatientSummary,
  PatientSummaryRx,
} from "../../types";

export function findPatientSummary(
  ctx: AssistantContext,
  query: string,
): PatientSummary | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const nameOf = (p: { firstName: string; middleName?: string; lastName: string }) =>
    [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");

  const patient =
    ctx.patients.find((p) => p.patientNumber?.toLowerCase().includes(q)) ??
    ctx.patients.find((p) => nameOf(p).toLowerCase().includes(q)) ??
    ctx.patients.find((p) =>
      q
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .every((t) => nameOf(p).toLowerCase().includes(t)),
    );
  if (!patient) return null;

  const name = nameOf(patient);
  const allergies = ctx.patientAllergies
    .filter((a) => a.patientId === patient.id)
    .map((a) => ({
      allergen: a.allergen,
      severity: a.severity,
      reaction: a.reaction,
    }));

  const conditions = [
    ...(patient.medicalConditions ?? "")
      .split(/[;,]/)
      .map((c) => c.trim())
      .filter(Boolean),
    ...(patient.chronicConditions ?? "")
      .split(/[;,]/)
      .map((c) => c.trim())
      .filter(Boolean),
  ];

  const prescriptions = ctx.prescriptions.filter(
    (p) => p.patientId === patient.id,
  );
  const rxRecent: PatientSummaryRx[] = prescriptions
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
    .map((p) => ({
      prescriptionNumber: p.prescriptionNumber,
      date: p.createdAt,
      status: p.status,
      items: ctx.prescriptionItems
        .filter((pi) => pi.prescriptionId === p.id)
        .map((pi) => pi.medicineName || "Unknown"),
    }));

  const patientDispensing = ctx.dispensingRecords.filter((d) =>
    ctx.prescriptions
      .filter((p) => p.patientId === patient.id)
      .some((p) => p.id === d.prescriptionId),
  );

  const customer = ctx.customers.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
  let balanceDue = 0;
  if (customer) {
    let owed = 0;
    for (const s of ctx.sales) {
      if (s.customerId === customer.id && s.status === "COMPLETED") {
        owed += s.balanceDue;
      }
    }
    let paid = 0;
    for (const p of ctx.customerPayments) {
      if (p.customerId === customer.id) paid += p.amount;
    }
    balanceDue = round2(Math.max(0, owed - paid));
  }

  let age: number | undefined;
  if (patient.dob) {
    const d = new Date(patient.dob);
    if (!Number.isNaN(d.getTime())) {
      const nowD = new Date();
      age = nowD.getFullYear() - d.getFullYear();
      const m = nowD.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && nowD.getDate() < d.getDate())) age -= 1;
    }
  }

  const dispensingRecent = patientDispensing.filter(
    (d) => d.dispensedAt >= Date.now() - 7 * 86400000,
  ).length;

  return {
    patientId: patient.id,
    name,
    age,
    status: patient.status,
    allergies,
    conditions,
    rxTotal: prescriptions.length,
    rxPending: prescriptions.filter((p) => p.status === "PENDING").length,
    rxRecent,
    dispensingTotal: patientDispensing.length,
    dispensingRecent,
    balanceDue,
  };
}
