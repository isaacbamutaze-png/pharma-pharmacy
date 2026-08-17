import { useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import {
  ClipboardPlus,
  Search,
  Eye,
  PackageX,
  Pill,
  Trash2,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, formatDateTime } from "../../lib/utils";
import { fullName } from "../../lib/patients";
import {
  createPrescription,
  cancelPrescription,
  dispensePrescription,
  prescriptionStatusTone,
  formatDoctorName,
} from "../../lib/prescriptions";
import { isControlled } from "../../lib/controlled";
import {
  runSafetyChecks,
  isBlockingResult,
  severityTone,
  type SafetyCheckResult,
  type SafetyOverrideInput,
} from "../../lib/safety";
import { useAuthStore } from "../../store/authStore";
import type {
  PaymentMethod,
  Prescription,
  SafetyCheckType,
} from "../../types";

interface LineForm {
  medicineId: string;
  quantity: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

interface NewRxForm {
  patientId: string;
  doctorName: string;
  doctorLicense: string;
  note: string;
  lines: LineForm[];
}

const EMPTY_LINE: LineForm = {
  medicineId: "",
  quantity: "1",
  dosage: "",
  frequency: "",
  duration: "",
  instructions: "",
};

const DISPENSE_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "CREDIT", label: "Credit" },
];

export function PrescriptionsPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();

  const prescriptions =
    useLiveQuery(() => pharmaDb.prescriptions.toArray(), []) ?? [];
  const patients = useLiveQuery(() => pharmaDb.patients.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const prescriptionItems =
    useLiveQuery(() => pharmaDb.prescriptionItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];
  const users = useLiveQuery(() => pharmaDb.users.toArray(), []) ?? [];
  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const medicineById = new Map(medicines.map((m) => [m.id, m]));
  const patientById = new Map(patients.map((p) => [p.id, p]));

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showNew, setShowNew] = useState(false);
  const [rxForm, setRxForm] = useState<NewRxForm>({
    patientId: "",
    doctorName: "",
    doctorLicense: "",
    note: "",
    lines: [{ ...EMPTY_LINE }],
  });
  const [dispenseTarget, setDispenseTarget] = useState<Prescription | null>(
    null,
  );
  const [dispenseMethod, setDispenseMethod] = useState<PaymentMethod>("CASH");
  const [pharmacistId, setPharmacistId] = useState("");
  const [safetyResults, setSafetyResults] = useState<SafetyCheckResult[]>([]);
  const [overrideReasons, setOverrideReasons] = useState<
    Record<string, string>
  >({});
  const [viewTarget, setViewTarget] = useState<Prescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const patientId = searchParams.get("patient");
    if (patientId && patients.some((p) => p.id === patientId)) {
      setRxForm((f) => ({ ...f, patientId }));
      setShowNew(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, patients.length]);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const itemsFor = (pId: string) =>
    prescriptionItems.filter((it) => it.prescriptionId === pId);

  const filtered = prescriptions.filter((p) => {
    const patient = patientById.get(p.patientId);
    const q = search.trim().toLowerCase();
    const matchesQ =
      !q ||
      p.prescriptionNumber.toLowerCase().includes(q) ||
      (patient ? fullName(patient).toLowerCase().includes(q) : false) ||
      (patient?.patientNumber ?? "").toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "ALL" || p.status === statusFilter;
    return matchesQ && matchesStatus;
  });

  const pendingCount = prescriptions.filter(
    (p) => p.status === "PENDING",
  ).length;
  const dispensedCount = prescriptions.filter(
    (p) => p.status === "DISPENSED",
  ).length;

  const openNew = () => {
    clearMessages();
    setRxForm({
      patientId: rxForm.patientId,
      doctorName: "",
      doctorLicense: "",
      note: "",
      lines: [{ ...EMPTY_LINE }],
    });
    setShowNew(true);
  };

  const updateLine = (index: number, patch: Partial<LineForm>) => {
    setRxForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    try {
      const created = await createPrescription({
        patientId: rxForm.patientId,
        doctorName: rxForm.doctorName,
        doctorLicense: rxForm.doctorLicense,
        note: rxForm.note,
        items: rxForm.lines.map((l) => ({
          medicineId: l.medicineId,
          dosage: l.dosage,
          frequency: l.frequency,
          duration: l.duration,
          quantity: Number(l.quantity),
          instructions: l.instructions,
        })),
        createdBy: user.id,
      });
      setShowNew(false);
      setSuccess(
        `Prescription ${created.prescriptionNumber} created for ${created.patientName}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prescription.");
    }
  };

  const handleCancel = async (p: Prescription) => {
    if (!user) return;
    clearMessages();
    try {
      await cancelPrescription(p.id, user.id);
      setSuccess(`Prescription ${p.prescriptionNumber} cancelled.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel prescription.");
    }
  };

  const openDispense = async (p: Prescription) => {
    clearMessages();
    setDispenseMethod("CASH");
    setPharmacistId("");
    setOverrideReasons({});
    setDispenseTarget(p);
    const results = await runSafetyChecks({
      patientId: p.patientId,
      medicineIds: itemsFor(p.id).map((it) => it.medicineId),
      prescriptionId: p.id,
    });
    setSafetyResults(results);
  };

  const handleDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !dispenseTarget) return;
    clearMessages();
    try {
      const pharmacist = users.find((u) => u.id === pharmacistId);
      const overrides: SafetyOverrideInput[] = Object.entries(overrideReasons)
        .filter(([, reason]) => reason.trim().length > 0)
        .map(([type, reason]) => ({
          checkType: type as SafetyCheckType,
          reason,
        }));
      const { invoiceNumber } = await dispensePrescription({
        prescriptionId: dispenseTarget.id,
        paymentMethod: dispenseMethod,
        cashierId: user.id,
        cashierName: user.fullName,
        pharmacistId,
        pharmacistName: pharmacist?.fullName,
        safetyOverrides: overrides,
      });
      setDispenseTarget(null);
      setSuccess(
        `Dispensed ${dispenseTarget.prescriptionNumber} — invoice ${invoiceNumber}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispense prescription.");
    }
  };

  const dispenseItems = dispenseTarget ? itemsFor(dispenseTarget.id) : [];
  const cdrItems = dispenseItems.filter((it) =>
    isControlled(medicineById.get(it.medicineId)),
  );
  const hasCdr = cdrItems.length > 0;
  const blockingResults = safetyResults.filter(isBlockingResult);
  const cdrBlocked = hasCdr && !pharmacistId;
  const overrideBlocked = blockingResults.some(
    (r) => !(overrideReasons[r.checkType] ?? "").trim(),
  );
  const dispenseDisabled = cdrBlocked || overrideBlocked;
  const dispenseTotal = dispenseItems.reduce(
    (sum, it) =>
      sum + it.quantity * (medicineById.get(it.medicineId)?.sellingPrice ?? 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title="Prescriptions & Dispensing"
        subtitle="Prescription capture, pharmacy review and dispensing"
        actions={
          <Button onClick={openNew}>
            <ClipboardPlus size={16} />
            New Prescription
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
          <p className="text-xs font-medium text-slate-500">Total Prescriptions</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {prescriptions.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Pending</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{pendingCount}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Dispensed</p>
          <p className="mt-1 text-xl font-bold text-green-600">{dispensedCount}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search by prescription number or patient..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="DISPENSED">Dispensed</option>
            <option value="CANCELLED">Cancelled</option>
          </SelectInput>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No prescriptions found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Rx No.</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Prescribed</th>
                  <th className="px-3 py-2 font-medium">Doctor</th>
                  <th className="px-3 py-2 font-medium">Lines</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const patient = patientById.get(p.patientId);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-mono text-xs text-pharma-600">
                          {p.prescriptionNumber}
                        </p>
                        {p.invoiceNumber && (
                          <p className="text-xs text-slate-400">
                            {p.invoiceNumber}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">
                          {patient ? fullName(patient) : p.patientName || "—"}
                        </p>
                        {patient && (
                          <p className="font-mono text-xs text-slate-400">
                            {patient.patientNumber}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDateTime(p.prescribedDate)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {formatDoctorName(p.doctorName)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {itemsFor(p.id).length}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={prescriptionStatusTone(p.status)}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {p.status === "PENDING" && (
                            <button
                              onClick={() => openDispense(p)}
                              className="rounded-lg p-2 text-green-600 hover:bg-green-50"
                              aria-label="Dispense"
                              title="Dispense"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              clearMessages();
                              setViewTarget(p);
                            }}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label="View items"
                            title="View items"
                          >
                            <Eye size={16} />
                          </button>
                          {p.status === "PENDING" && (
                            <button
                              onClick={() => handleCancel(p)}
                              className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                              aria-label="Cancel prescription"
                              title="Cancel"
                            >
                              <PackageX size={16} />
                            </button>
                          )}
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

      {showNew && (
        <Modal
          title="New Prescription"
          subtitle={
            rxForm.patientId
              ? `Patient: ${fullName(patientById.get(rxForm.patientId)!)}`
              : "Select a patient"
          }
          onClose={() => setShowNew(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button form="rx-form" type="submit">
                Create Prescription
              </Button>
            </>
          }
        >
          <form id="rx-form" onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectInput
                label="Patient *"
                value={rxForm.patientId}
                onChange={(e) =>
                  setRxForm({ ...rxForm, patientId: e.target.value })
                }
              >
                <option value="">Select patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fullName(p)} · {p.patientNumber}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Doctor"
                value={rxForm.doctorName}
                onChange={(e) =>
                  setRxForm({ ...rxForm, doctorName: e.target.value })
                }
                placeholder="e.g. Smith"
              />
              <TextInput
                label="Doctor License No."
                value={rxForm.doctorLicense}
                onChange={(e) =>
                  setRxForm({ ...rxForm, doctorLicense: e.target.value })
                }
                placeholder="Optional"
              />
              <TextInput
                label="Note"
                value={rxForm.note}
                onChange={(e) => setRxForm({ ...rxForm, note: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Medicines *</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setRxForm((f) => ({
                      ...f,
                      lines: [...f.lines, { ...EMPTY_LINE }],
                    }))
                  }
                >
                  <Pill size={14} /> Add line
                </Button>
              </div>
              <div className="space-y-3">
                {rxForm.lines.map((line, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Line {index + 1}
                      </span>
                      {rxForm.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setRxForm((f) => ({
                              ...f,
                              lines: f.lines.filter((_, i) => i !== index),
                            }))
                          }
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove line"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                      <div className="col-span-2 sm:col-span-2">
                        <SelectInput
                          label="Medicine *"
                          value={line.medicineId}
                          onChange={(e) =>
                            updateLine(index, { medicineId: e.target.value })
                          }
                        >
                          <option value="">Select...</option>
                          {medicines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                      <TextInput
                        label="Qty *"
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(index, { quantity: e.target.value })
                        }
                      />
                      <TextInput
                        label="Dosage"
                        value={line.dosage}
                        onChange={(e) =>
                          updateLine(index, { dosage: e.target.value })
                        }
                        placeholder="e.g. 500mg"
                      />
                      <TextInput
                        label="Frequency"
                        value={line.frequency}
                        onChange={(e) =>
                          updateLine(index, { frequency: e.target.value })
                        }
                        placeholder="e.g. TDS"
                      />
                      <TextInput
                        label="Duration"
                        value={line.duration}
                        onChange={(e) =>
                          updateLine(index, { duration: e.target.value })
                        }
                        placeholder="e.g. 5 days"
                      />
                      <div className="col-span-2 sm:col-span-6">
                        <TextInput
                          label="Instructions"
                          value={line.instructions}
                          onChange={(e) =>
                            updateLine(index, { instructions: e.target.value })
                          }
                          placeholder="e.g. After meals"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {dispenseTarget && (
        <Modal
          title="Dispense Prescription"
          subtitle={`${dispenseTarget.prescriptionNumber} · ${
            patientById.get(dispenseTarget.patientId)
              ? fullName(patientById.get(dispenseTarget.patientId)!)
              : ""
          }`}
          onClose={() => setDispenseTarget(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDispenseTarget(null)}>
                Cancel
              </Button>
          <Button
            form="dispense-form"
            type="submit"
            disabled={dispenseDisabled}
          >
            Dispense & Charge {formatMoney(dispenseTotal, currency)}
          </Button>
            </>
          }
        >
          <form id="dispense-form" onSubmit={handleDispense} className="space-y-4">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Medicine</th>
                    <th className="px-3 py-2 font-medium">Strength</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dispenseItems.map((it) => {
                    const med = medicineById.get(it.medicineId);
                    const price = med?.sellingPrice ?? 0;
                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {it.medicineName}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {it.strength || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {it.quantity}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {formatMoney(price, currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">
                          {formatMoney(it.quantity * price, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <td
                      colSpan={4}
                      className="px-3 py-2 text-right font-semibold text-slate-700"
                    >
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      {formatMoney(dispenseTotal, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {hasCdr && (
              <div className="rounded-lg border border-pharma-200 bg-pharma-50 p-3">
                <div className="mb-1 flex items-center gap-2 text-pharma-800">
                  <ShieldAlert size={16} />
                  <p className="text-sm font-semibold">
                    Controlled Medicine (CDR)
                  </p>
                </div>
                <p className="mb-2 text-xs text-slate-600">
                  {cdrItems.map((it) => it.medicineName).join(", ")} require an
                  authorized pharmacist to authorize dispensing. The pharmacist
                  is recorded on the Controlled Drug Register.
                </p>
                <SelectInput
                  label="Authorizing pharmacist *"
                  value={pharmacistId}
                  onChange={(e) => setPharmacistId(e.target.value)}
                >
                  <option value="">Select pharmacist...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </SelectInput>
              </div>
            )}

            {safetyResults.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-amber-800">
                  <ShieldAlert size={16} />
                  <p className="text-sm font-semibold">Safety Engine</p>
                </div>
                <ul className="space-y-3">
                  {safetyResults.map((r, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge tone={severityTone(r.severity)}>
                          {r.severity}
                        </Badge>
                        <span className="flex-1 text-slate-700">
                          <span className="font-semibold uppercase tracking-wide text-slate-500">
                            {r.checkType.replace(/_/g, " ")}
                          </span>{" "}
                          — {r.detail}
                        </span>
                        <Badge tone={isBlockingResult(r) ? "red" : "amber"}>
                          {isBlockingResult(r) ? "Override required" : "Warning"}
                        </Badge>
                      </div>
                      {isBlockingResult(r) && (
                        <TextInput
                          className="mt-2"
                          placeholder="Authorization reason (required to dispense)"
                          value={overrideReasons[r.checkType] ?? ""}
                          onChange={(e) =>
                            setOverrideReasons((prev) => ({
                              ...prev,
                              [r.checkType]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <SelectInput
              label="Payment method"
              value={dispenseMethod}
              onChange={(e) =>
                setDispenseMethod(e.target.value as PaymentMethod)
              }
            >
              {DISPENSE_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectInput>
            <p className="text-xs text-slate-500">
              Online payments (mobile money, card, bank) are routed through POS
              so provider confirmation is verified before the sale completes.
            </p>
          </form>
        </Modal>
      )}

      {viewTarget && (
        <Modal
          title={viewTarget.prescriptionNumber}
          subtitle={`${
            patientById.get(viewTarget.patientId)
              ? fullName(patientById.get(viewTarget.patientId)!)
              : viewTarget.patientName || ""
          } · ${viewTarget.status}`}
          onClose={() => setViewTarget(null)}
          size="lg"
        >
          <div className="mb-3 flex flex-wrap gap-4 text-sm text-slate-600">
            <span>
              Prescribed:{" "}
              <span className="font-medium">
                {formatDateTime(viewTarget.prescribedDate)}
              </span>
            </span>
            {viewTarget.doctorName && (
              <span>
                Doctor: <span className="font-medium">{viewTarget.doctorName}</span>
              </span>
            )}
            {viewTarget.invoiceNumber && (
              <span>
                Invoice: <span className="font-medium">{viewTarget.invoiceNumber}</span>
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Dosage / Freq / Duration</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Dispensed</th>
                  <th className="px-3 py-2 font-medium">Instructions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsFor(viewTarget.id).map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {it.medicineName}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {[it.dosage, it.frequency, it.duration]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{it.quantity}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {it.dispensedQty}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {it.instructions || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
