import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useLocation } from "react-router-dom";
import { UserPlus, Eye, Pencil, Search, AlertTriangle } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import {
  createPatient,
  updatePatient,
  nextPatientNumber,
  fullName,
  ageOf,
  patientStatusTone,
  PatientDuplicateError,
  type PatientInput,
} from "../../lib/patients";
import { useAuthStore } from "../../store/authStore";
import type { Patient } from "../../types";

interface FormState {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  sex: string;
  phone: string;
  email: string;
  address: string;
  nationality: string;
  emergencyContact: string;
  nationalId: string;
  insuranceNumber: string;
  bloodGroup: string;
  medicalConditions: string;
  chronicConditions: string;
  allergies: Array<{
    allergen: string;
    severity?: string;
    reaction?: string;
  }>;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  middleName: "",
  lastName: "",
  dob: "",
  sex: "Male",
  phone: "",
  email: "",
  address: "",
  nationality: "",
  emergencyContact: "",
  nationalId: "",
  insuranceNumber: "",
  bloodGroup: "",
  medicalConditions: "",
  chronicConditions: "",
  allergies: [],
};

const SEX_OPTIONS = ["Male", "Female", "Other"];
const BLOOD_GROUPS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function allergiesFromText(text: string): Array<{
  allergen: string;
}> {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((allergen) => ({ allergen }));
}

export function PatientsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.startsWith("/admin") ? "/admin" : "";
  const user = useAuthStore((s) => s.user);
  const patients = useLiveQuery(() => pharmaDb.patients.toArray(), []) ?? [];
  const allergies =
    useLiveQuery(() => pharmaDb.patientAllergies.toArray(), []) ?? [];

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [nextNumber, setNextNumber] = useState<string>("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const filtered = patients.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.patientNumber.toLowerCase().includes(q) ||
      fullName(p).toLowerCase().includes(q) ||
      (p.phone ?? "").toLowerCase().includes(q) ||
      (p.nationalId ?? "").toLowerCase().includes(q) ||
      (p.insuranceNumber ?? "").toLowerCase().includes(q)
    );
  });

  const allergyCount = (patientId: string): number =>
    allergies.filter((a) => a.patientId === patientId).length;

  const openAdd = async () => {
    clearMessages();
    setEditing(null);
    setDuplicates([]);
    setForm({ ...EMPTY_FORM, allergies: [] });
    setNextNumber(await nextPatientNumber());
    setShowForm(true);
  };

  const openEdit = (patient: Patient) => {
    clearMessages();
    setEditing(patient);
    setDuplicates([]);
    setForm({
      firstName: patient.firstName,
      middleName: patient.middleName ?? "",
      lastName: patient.lastName,
      dob: patient.dob,
      sex: patient.sex ?? "Male",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      address: patient.address ?? "",
      nationality: patient.nationality ?? "",
      emergencyContact: patient.emergencyContact ?? "",
      nationalId: patient.nationalId ?? "",
      insuranceNumber: patient.insuranceNumber ?? "",
      bloodGroup: patient.bloodGroup ?? "",
      medicalConditions: patient.medicalConditions ?? "",
      chronicConditions: patient.chronicConditions ?? "",
      allergies: allergies
        .filter((a) => a.patientId === patient.id)
        .map((a) => ({ allergen: a.allergen })),
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    const input: PatientInput = {
      ...form,
      allergies: allergiesFromText(
        (form.allergies ?? []).map((a) => a.allergen).join(", "),
      ),
    };

    try {
      if (editing) {
        await updatePatient(editing.id, input, user.id);
        setShowForm(false);
        setSuccess(`Patient ${fullName(editing)} updated.`);
      } else {
        try {
          const created = await createPatient(input, user.id);
          setShowForm(false);
          setSuccess(
            `Patient ${created.patientNumber} — ${fullName(created)} registered.`,
          );
        } catch (err) {
          if (err instanceof PatientDuplicateError) {
            setDuplicates(err.duplicates);
            setError(
              "Possible existing patient found with the same name/DOB or phone.",
            );
            return;
          }
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save patient.");
    }
  };

  const handleForceCreate = async () => {
    if (!user) return;
    clearMessages();
    try {
      const input: PatientInput = {
        ...form,
        allergies: allergiesFromText(
          (form.allergies ?? []).map((a) => a.allergen).join(", "),
        ),
      };
      const created = await createPatient(input, user.id, true);
      setDuplicates([]);
      setShowForm(false);
      setSuccess(
        `Patient ${created.patientNumber} — ${fullName(created)} registered.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register patient.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Patient profiles, allergies and medication history"
        actions={
          <Button onClick={openAdd}>
            <UserPlus size={16} />
            Register Patient
          </Button>
        }
      />

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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Total Patients</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {patients.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">With Allergies</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {new Set(allergies.map((a) => a.patientId)).size}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Admitted / In Care</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {patients.filter((p) => p.status === "ADMITTED").length}
          </p>
        </Card>
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search by patient number, name, phone, NID or insurance..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No patients found. Register your first patient to begin.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Patient No.</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Age / Sex</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Blood Group</th>
                  <th className="px-3 py-2 font-medium">Allergies</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const age = ageOf(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-mono text-xs text-pharma-600">
                          {p.patientNumber}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">
                          {fullName(p)}
                        </p>
                        <Badge tone={patientStatusTone(p.status)}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {age !== null ? `${age} yrs` : "—"} · {p.sex ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {p.phone || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {p.bloodGroup || "—"}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={allergyCount(p.id) > 0 ? "amber" : "slate"}>
                          {allergyCount(p.id) > 0
                            ? `${allergyCount(p.id)} allergy(ies)`
                            : "None"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => navigate(`${base}/patients/${p.id}`)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label="Open patient"
                            title="Open patient"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label="Edit patient"
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showForm && (
        <Modal
          title={editing ? "Edit Patient" : "Register Patient"}
          subtitle={
            editing
              ? editing.patientNumber
              : `New patient number ${nextNumber} — auto generated`
          }
          onClose={() => setShowForm(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button form="patient-form" type="submit">
                {editing ? "Save Patient" : "Register Patient"}
              </Button>
            </>
          }
        >
          {duplicates.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-amber-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">
                    Possible existing patient found
                  </p>
                  <ul className="mt-2 space-y-1">
                    {duplicates.map((d) => (
                      <li key={d.id} className="text-xs text-amber-700">
                        <button
                          className="font-semibold underline hover:text-amber-900"
                          onClick={() => navigate(`${base}/patients/${d.id}`)}
                        >
                          {fullName(d)} · {d.patientNumber}
                        </button>{" "}
                        {d.phone ? `· ${d.phone}` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setDuplicates([]);
                        if (duplicates[0]) {
                          navigate(`${base}/patients/${duplicates[0].id}`);
                        }
                      }}
                    >
                      Open Existing
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleForceCreate}>
                      Register Anyway
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <form id="patient-form" onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextInput
                label="First Name *"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
                placeholder="First name"
              />
              <TextInput
                label="Middle Name"
                value={form.middleName}
                onChange={(e) =>
                  setForm({ ...form, middleName: e.target.value })
                }
                placeholder="Optional"
              />
              <TextInput
                label="Last Name *"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                placeholder="Last name"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextInput
                label="Date of Birth"
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
              />
              <SelectInput
                label="Sex"
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value })}
              >
                {SEX_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Blood Group"
                value={form.bloodGroup}
                onChange={(e) =>
                  setForm({ ...form, bloodGroup: e.target.value })
                }
              >
                {BLOOD_GROUPS.map((b) => (
                  <option key={b || "none"} value={b}>
                    {b || "Not specified"}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. +256 700 000000"
              />
              <TextInput
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Optional"
              />
              <TextInput
                label="National ID"
                value={form.nationalId}
                onChange={(e) =>
                  setForm({ ...form, nationalId: e.target.value })
                }
                placeholder="Optional"
              />
              <TextInput
                label="Insurance Number"
                value={form.insuranceNumber}
                onChange={(e) =>
                  setForm({ ...form, insuranceNumber: e.target.value })
                }
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Optional"
              />
              <TextInput
                label="Nationality"
                value={form.nationality}
                onChange={(e) =>
                  setForm({ ...form, nationality: e.target.value })
                }
                placeholder="e.g. Ugandan"
              />
              <TextInput
                label="Emergency Contact"
                value={form.emergencyContact}
                onChange={(e) =>
                  setForm({ ...form, emergencyContact: e.target.value })
                }
                placeholder="Name + phone"
              />
            </div>
            <TextArea
              label="Known Allergies (comma-separated)"
              value={(form.allergies ?? []).map((a) => a.allergen).join(", ")}
              onChange={(e) =>
                setForm({
                  ...form,
                  allergies: allergiesFromText(e.target.value),
                })
              }
              placeholder="e.g. Penicillin, Sulphur drugs"
              rows={2}
            />
            <TextInput
              label="Medical Conditions"
              value={form.medicalConditions}
              onChange={(e) =>
                setForm({ ...form, medicalConditions: e.target.value })
              }
              placeholder="e.g. Hypertension, Diabetes"
            />
            <TextInput
              label="Chronic Conditions"
              value={form.chronicConditions}
              onChange={(e) =>
                setForm({ ...form, chronicConditions: e.target.value })
              }
              placeholder="Optional"
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
