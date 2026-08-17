import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  ClipboardPlus,
  Phone,
  Mail,
  MapPin,
  Hash,
  Droplet,
  Stethoscope,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { Alert } from "../../components/ui/Alert";
import { formatDateTime } from "../../lib/utils";
import {
  fullName,
  ageOf,
  patientStatusTone,
  PATIENT_STATUSES,
  setPatientStatus,
  addPatientAllergy,
  addPatientHistory,
  type PatientStatus,
} from "../../lib/patients";
import { prescriptionStatusTone, formatDoctorName } from "../../lib/prescriptions";
import type { PrescriptionItem, DispensingRecord } from "../../types";
import { useAuthStore } from "../../store/authStore";

interface TimelineEvent {
  ts: number;
  text: string;
  tone: "green" | "blue" | "amber" | "slate";
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.startsWith("/admin") ? "/admin" : "";
  const user = useAuthStore((s) => s.user);

  const patient = useLiveQuery(
    () => (id ? pharmaDb.patients.get(id) : undefined),
    [id],
  );
  const allergies = useLiveQuery(
    () => (id ? pharmaDb.patientAllergies.where("patientId").equals(id).toArray() : []),
    [id],
  ) ?? [];
  const history =
    useLiveQuery(
      () => (id ? pharmaDb.patientMedicalHistory.where("patientId").equals(id).toArray() : []),
      [id],
    ) ?? [];
  const prescriptions =
    useLiveQuery(
      () => (id ? pharmaDb.prescriptions.where("patientId").equals(id).toArray() : []),
      [id],
    ) ?? [];
  const prescriptionIds = prescriptions.map((p) => p.id);
  const items = useLiveQuery<PrescriptionItem[]>(
    () =>
      prescriptionIds.length > 0
        ? pharmaDb.prescriptionItems
            .filter((it) => prescriptionIds.includes(it.prescriptionId))
            .toArray()
        : Promise.resolve([]),
    [prescriptionIds],
  ) ?? [];
  const dispensing =
    useLiveQuery<DispensingRecord[]>(
      () =>
        prescriptionIds.length > 0
          ? pharmaDb.dispensingRecords
              .filter((d) => prescriptionIds.includes(d.prescriptionId))
              .toArray()
          : Promise.resolve([]),
      [prescriptionIds],
    ) ?? [];

  const [allergyForm, setAllergyForm] = useState({
    allergen: "",
    severity: "",
    reaction: "",
  });
  const [historyForm, setHistoryForm] = useState({
    condition: "",
    onsetDate: "",
    notes: "",
  });
  const [status, setStatus] = useState<PatientStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!patient) {
    return (
      <div>
        <Button variant="ghost" onClick={() => navigate(`${base}/patients`)}>
          <ArrowLeft size={16} /> Back to Patients
        </Button>
        <p className="py-10 text-center text-sm text-slate-400">
          Patient not found.
        </p>
      </div>
    );
  }

  const currentStatus = status ?? patient.status;
  const itemCount = (pId: string): number =>
    items.filter((it) => it.prescriptionId === pId).length;
  const dispensedTotal = prescriptions
    .filter((p) => p.status === "DISPENSED")
    .length;

  const timeline: TimelineEvent[] = [
    {
      ts: patient.createdAt,
      text: `Patient registered — ${patient.patientNumber}`,
      tone: "blue",
    },
    ...allergies.map((a): TimelineEvent => ({
      ts: a.createdAt,
      text: `Allergy recorded: ${a.allergen}`,
      tone: "amber",
    })),
    ...history.map((h): TimelineEvent => ({
      ts: h.createdAt,
      text: `Medical history: ${h.condition}`,
      tone: "slate",
    })),
    ...prescriptions.map((p): TimelineEvent => ({
      ts: p.prescribedDate,
      text: `Prescription ${p.prescriptionNumber} created`,
      tone: "green",
    })),
    ...dispensing.map((d): TimelineEvent => ({
      ts: d.dispensedAt,
      text: `Dispensed ${d.medicineName} × ${d.qty}`,
      tone: "green",
    })),
  ];
  timeline.sort((a, b) => b.ts - a.ts);

  const handleStatusChange = async () => {
    if (!user || !status || status === patient.status) return;
    try {
      await setPatientStatus(patient.id, status, user.id);
      setSuccess(`Status changed to ${status}.`);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  };

  const handleAddAllergy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await addPatientAllergy({
        patientId: patient.id,
        allergen: allergyForm.allergen,
        severity: allergyForm.severity || undefined,
        reaction: allergyForm.reaction || undefined,
        recordedBy: user.id,
      });
      setAllergyForm({ allergen: "", severity: "", reaction: "" });
      setSuccess("Allergy added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add allergy.");
    }
  };

  const handleAddHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await addPatientHistory({
        patientId: patient.id,
        condition: historyForm.condition,
        onsetDate: historyForm.onsetDate || undefined,
        notes: historyForm.notes || undefined,
        recordedBy: user.id,
      });
      setHistoryForm({ condition: "", onsetDate: "", notes: "" });
      setSuccess("Medical history added.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add medical history.",
      );
    }
  };

  const age = ageOf(patient);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => navigate(`${base}/patients`)}>
          <ArrowLeft size={16} /> Back to Patients
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              navigate(`${base}/prescriptions?patient=${patient.id}`)
            }
          >
            <ClipboardPlus size={16} />
            New Prescription
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        </div>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-medium text-pharma-600">
              {patient.patientNumber}
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              {fullName(patient)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={patientStatusTone(patient.status)}>
                {patient.status}
              </Badge>
              <span className="text-sm text-slate-500">
                {age !== null ? `${age} years` : "Age unknown"}
                {patient.sex ? ` · ${patient.sex}` : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SelectInput
              value={currentStatus}
              onChange={(e) => setStatus(e.target.value as PatientStatus)}
            >
              {PATIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
            <Button
              variant="secondary"
              disabled={!status || status === patient.status}
              onClick={handleStatusChange}
            >
              Update
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone size={14} className="text-slate-400" />
            {patient.phone || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail size={14} className="text-slate-400" />
            {patient.email || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin size={14} className="text-slate-400" />
            {patient.address || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Hash size={14} className="text-slate-400" />
            NID: {patient.nationalId || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Droplet size={14} className="text-slate-400" />
            Blood group: {patient.bloodGroup || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Stethoscope size={14} className="text-slate-400" />
            Insurance: {patient.insuranceNumber || "—"}
          </div>
        </div>
        {(patient.medicalConditions || patient.chronicConditions) && (
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
            <p>
              <span className="font-medium text-slate-700">Medical conditions:</span>{" "}
              {patient.medicalConditions || "—"}
            </p>
            <p>
              <span className="font-medium text-slate-700">Chronic conditions:</span>{" "}
              {patient.chronicConditions || "—"}
            </p>
          </div>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Prescriptions</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {prescriptions.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Dispensed</p>
          <p className="mt-1 text-xl font-bold text-green-600">
            {dispensedTotal}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Allergies</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {allergies.length}
          </p>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Allergies</h3>
          </div>
          {allergies.length === 0 ? (
            <p className="mb-3 text-sm text-slate-400">No allergies recorded.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-100">
              {allergies.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {a.allergen}
                    </p>
                    {a.reaction && (
                      <p className="text-xs text-slate-500">{a.reaction}</p>
                    )}
                  </div>
                  {a.severity && (
                    <Badge tone={a.severity === "SEVERE" ? "red" : "amber"}>
                      {a.severity}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={handleAddAllergy}
            className="space-y-2 rounded-lg bg-slate-50 p-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Add allergy
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextInput
                placeholder="Allergen *"
                value={allergyForm.allergen}
                onChange={(e) =>
                  setAllergyForm({ ...allergyForm, allergen: e.target.value })
                }
              />
              <SelectInput
                value={allergyForm.severity}
                onChange={(e) =>
                  setAllergyForm({ ...allergyForm, severity: e.target.value })
                }
              >
                <option value="">Severity</option>
                <option value="MILD">Mild</option>
                <option value="MODERATE">Moderate</option>
                <option value="SEVERE">Severe</option>
              </SelectInput>
              <TextInput
                placeholder="Reaction"
                value={allergyForm.reaction}
                onChange={(e) =>
                  setAllergyForm({ ...allergyForm, reaction: e.target.value })
                }
              />
            </div>
            <Button type="submit" size="sm">
              <Plus size={14} /> Add Allergy
            </Button>
          </form>
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Medical History
          </h3>
          {history.length === 0 ? (
            <p className="mb-4 text-sm text-slate-400">
              No medical history recorded.
            </p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-100">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <p className="text-sm font-medium text-slate-800">
                    {h.condition}
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.onsetDate ? `Onset: ${h.onsetDate}` : "Onset unknown"}
                    {h.notes ? ` · ${h.notes}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={handleAddHistory}
            className="space-y-2 rounded-lg bg-slate-50 p-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Add condition
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextInput
                placeholder="Condition *"
                value={historyForm.condition}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, condition: e.target.value })
                }
              />
              <TextInput
                type="date"
                placeholder="Onset"
                value={historyForm.onsetDate}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, onsetDate: e.target.value })
                }
              />
              <TextInput
                placeholder="Notes"
                value={historyForm.notes}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, notes: e.target.value })
                }
              />
            </div>
            <Button type="submit" size="sm">
              <Plus size={14} /> Add Condition
            </Button>
          </form>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Prescriptions
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(`${base}/prescriptions?patient=${patient.id}`)
              }
            >
              View all
            </Button>
          </div>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-slate-400">No prescriptions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...prescriptions]
                .sort((a, b) => b.prescribedDate - a.prescribedDate)
                .slice(0, 5)
                .map((p) => (
                  <li key={p.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-xs text-pharma-600">
                        {p.prescriptionNumber}
                      </p>
                      <Badge tone={prescriptionStatusTone(p.status)}>
                        {p.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(p.prescribedDate)} · {itemCount(p.id)} line(s)
                      {p.doctorName ? ` · ${formatDoctorName(p.doctorName)}` : ""}
                      {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Patient Timeline
          </h3>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {timeline.map((ev, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      ev.tone === "green"
                        ? "bg-green-500"
                        : ev.tone === "blue"
                          ? "bg-blue-500"
                          : ev.tone === "amber"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                    }`}
                  />
                  <div>
                    <p className="text-sm text-slate-700">{ev.text}</p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(ev.ts)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
