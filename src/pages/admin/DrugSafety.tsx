import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ShieldAlert, Trash2, Plus } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatDateTime, uid, now } from "../../lib/utils";
import { fullName } from "../../lib/patients";
import {
  runSafetyChecks,
  recordSafetyChecks,
  isBlockingResult,
  severityTone,
  type SafetyCheckResult,
} from "../../lib/safety";
import { useAuthStore } from "../../store/authStore";
import type {
  InteractionSeverity,
  MedicineWarning,
  MedicineWarningType,
  SafetyCheckType,
} from "../../types";

const WARNING_TYPES: MedicineWarningType[] = [
  "AGE",
  "PREGNANCY",
  "LACTATION",
  "DOSE",
  "CONTRAINDICATION",
];

const SEVERITIES: Array<InteractionSeverity | "INFO"> = [
  "INFO",
  "MINOR",
  "MODERATE",
  "MAJOR",
  "CONTRAINDICATED",
];

export function DrugSafetyPage() {
  const user = useAuthStore((s) => s.user);
  const medicines =
    useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const patients = useLiveQuery(() => pharmaDb.patients.toArray(), []) ?? [];
  const interactions =
    useLiveQuery(() => pharmaDb.drugInteractions.toArray(), []) ?? [];
  const warnings =
    useLiveQuery(() => pharmaDb.medicineWarnings.toArray(), []) ?? [];
  const checks =
    useLiveQuery(() => pharmaDb.safetyAlertChecks.toArray(), []) ?? [];

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [selectedMeds, setSelectedMeds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<SafetyCheckResult[]>([]);
  const [overrideReasons, setOverrideReasons] = useState<
    Record<string, string>
  >({});

  const [interactionModal, setInteractionModal] = useState(false);
  const [interactionForm, setInteractionForm] = useState<{
    medicineAId: string;
    medicineBId: string;
    severity: InteractionSeverity;
    detail: string;
    recommendation: string;
  }>({
    medicineAId: "",
    medicineBId: "",
    severity: "MODERATE",
    detail: "",
    recommendation: "",
  });

  const [warningModal, setWarningModal] = useState(false);
  const [warningForm, setWarningForm] = useState<{
    medicineId: string;
    warningType: MedicineWarningType;
    condition: string;
    message: string;
    severity: MedicineWarning["severity"];
  }>({
    medicineId: "",
    warningType: "CONTRAINDICATION",
    condition: "",
    message: "",
    severity: "WARNING",
  });

  const medById = new Map(medicines.map((m) => [m.id, m]));
  const sortedChecks = [...checks].sort((a, b) => b.checkedAt - a.checkedAt);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const toggleMed = (id: string) => {
    setSelectedMeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    clearMessages();
    if (!patientId) {
      setError("Select a patient to run the safety engine.");
      return;
    }
    if (selectedMeds.size === 0) {
      setError("Select at least one medicine.");
      return;
    }
    setOverrideReasons({});
    const resultsNow = await runSafetyChecks({
      patientId,
      medicineIds: [...selectedMeds],
    });
    setResults(resultsNow);
  };

  const handleSaveRun = async () => {
    if (!user) return;
    clearMessages();
    try {
      await recordSafetyChecks({
        patientId,
        results,
        overrides: Object.entries(overrideReasons)
          .filter(([, reason]) => reason.trim().length > 0)
          .map(([type, reason]) => ({
            checkType: type as SafetyCheckType,
            reason,
          })),
        actorId: user.id,
        actorName: user.fullName,
      });
      setSuccess("Safety run recorded to the audit trail.");
      setResults([]);
      setSelectedMeds(new Set());
      setPatientId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record run.");
    }
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    try {
      if (interactionForm.medicineAId === interactionForm.medicineBId) {
        throw new Error("Select two different medicines.");
      }
      await pharmaDb.drugInteractions.add({
        id: uid(),
        medicineAId: interactionForm.medicineAId,
        medicineBId: interactionForm.medicineBId,
        severity: interactionForm.severity,
        detail: interactionForm.detail.trim(),
        recommendation: interactionForm.recommendation.trim() || undefined,
        createdAt: now(),
      });
      setInteractionModal(false);
      setSuccess("Interaction added to the safety engine.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add interaction.");
    }
  };

  const handleDeleteInteraction = async (id: string) => {
    await pharmaDb.drugInteractions.delete(id);
  };

  const handleAddWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    clearMessages();
    try {
      await pharmaDb.medicineWarnings.add({
        id: uid(),
        medicineId: warningForm.medicineId,
        warningType: warningForm.warningType,
        condition: warningForm.condition.trim(),
        message: warningForm.message.trim(),
        severity: warningForm.severity,
        createdAt: now(),
      });
      setWarningModal(false);
      setSuccess("Warning added to the knowledge data.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add warning.");
    }
  };

  const handleDeleteWarning = async (id: string) => {
    await pharmaDb.medicineWarnings.delete(id);
  };

  return (
    <div>
      <PageHeader
        title="Drug Safety"
        subtitle="Safety engine — interactions, warnings & decision support"
        actions={
          <>
            <Button variant="outline" onClick={() => setInteractionModal(true)}>
              <Plus size={16} />
              Add Interaction
            </Button>
            <Button variant="outline" onClick={() => setWarningModal(true)}>
              <Plus size={16} />
              Add Warning
            </Button>
          </>
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

      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert size={16} className="text-pharma-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            Run a safety check
          </h2>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Decision-support only — the pharmacist remains responsible. Checks
          surface allergies, interactions, duplicate therapy, contraindications
          and age/pregnancy/lactation/dose warnings without stopping the flow.
        </p>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectInput
            label="Patient *"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">Select patient...</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)} · {p.patientNumber}
              </option>
            ))}
          </SelectInput>
          <div className="sm:pt-7">
            <Button onClick={handleRun}>
              <ShieldAlert size={16} />
              Run safety engine
            </Button>
          </div>
        </div>
        <p className="mb-2 text-sm font-medium text-slate-700">Medicines *</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {medicines.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                selectedMeds.has(m.id)
                  ? "border-pharma-500 bg-pharma-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedMeds.has(m.id)}
                onChange={() => toggleMed(m.id)}
                className="h-4 w-4 rounded border-slate-300 text-pharma-600 focus:ring-pharma-500"
              />
              <span className="font-medium text-slate-800">{m.name}</span>
            </label>
          ))}
        </div>

        {results.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-amber-800">
              <ShieldAlert size={16} />
              <p className="text-sm font-semibold">
                {results.length} alert{results.length === 1 ? "" : "s"} found
              </p>
            </div>
            <ul className="space-y-3">
              {results.map((r, i) => (
                <li key={i} className="text-sm">
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
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
                      placeholder="Override reason (recorded to audit)"
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
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={handleSaveRun}>
                Record run to audit
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Drug Interactions
            </h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInteractionModal(true)}
            >
              <Plus size={14} />
              Add
            </Button>
          </div>
          {interactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No interactions defined.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Pair</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                    <th className="px-3 py-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {interactions.map((x) => (
                    <tr key={x.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {medById.get(x.medicineAId)?.name ?? x.medicineAId}
                        <span className="text-slate-400"> + </span>
                        {medById.get(x.medicineBId)?.name ?? x.medicineBId}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={severityTone(x.severity)}>
                          {x.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {x.detail}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleDeleteInteraction(x.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete interaction"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Medicine Warnings
            </h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWarningModal(true)}
            >
              <Plus size={14} />
              Add
            </Button>
          </div>
          {warnings.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No warnings defined.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Medicine</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Condition</th>
                    <th className="px-3 py-2 font-medium">Message</th>
                    <th className="px-3 py-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {warnings.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {medById.get(w.medicineId)?.name ?? w.medicineId}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            w.severity === "SEVERE"
                              ? "red"
                              : w.severity === "WARNING"
                                ? "amber"
                                : "slate"
                          }
                        >
                          {w.warningType}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {w.condition || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{w.message}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleDeleteWarning(w.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete warning"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Recent safety checks
        </h2>
        {sortedChecks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No safety checks recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Check</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedChecks.slice(0, 30).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">
                      {formatDateTime(c.checkedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="blue">{c.checkType}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={severityTone(c.severity)}>
                        {c.severity}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          c.outcome === "PASS"
                            ? "green"
                            : c.outcome === "OVERRIDE"
                              ? "red"
                              : "amber"
                        }
                      >
                        {c.outcome}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {interactionModal && (
        <Modal
          title="Add Drug Interaction"
          subtitle="Medicine A + Medicine B"
          onClose={() => setInteractionModal(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setInteractionModal(false)}>
                Cancel
              </Button>
              <Button form="interaction-form" type="submit">
                Add
              </Button>
            </>
          }
        >
          <form
            id="interaction-form"
            onSubmit={handleAddInteraction}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectInput
                label="Medicine A *"
                value={interactionForm.medicineAId}
                onChange={(e) =>
                  setInteractionForm({
                    ...interactionForm,
                    medicineAId: e.target.value,
                  })
                }
              >
                <option value="">Select...</option>
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Medicine B *"
                value={interactionForm.medicineBId}
                onChange={(e) =>
                  setInteractionForm({
                    ...interactionForm,
                    medicineBId: e.target.value,
                  })
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
            <SelectInput
              label="Severity *"
              value={interactionForm.severity}
              onChange={(e) =>
                setInteractionForm({
                  ...interactionForm,
                  severity: e.target.value as InteractionSeverity,
                })
              }
            >
              {SEVERITIES.filter((s) => s !== "INFO").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
            <TextArea
              label="Detail *"
              rows={2}
              placeholder="What happens when combined"
              value={interactionForm.detail}
              onChange={(e) =>
                setInteractionForm({
                  ...interactionForm,
                  detail: e.target.value,
                })
              }
            />
            <TextArea
              label="Recommendation"
              rows={2}
              placeholder="Optional clinical guidance"
              value={interactionForm.recommendation}
              onChange={(e) =>
                setInteractionForm({
                  ...interactionForm,
                  recommendation: e.target.value,
                })
              }
            />
          </form>
        </Modal>
      )}

      {warningModal && (
        <Modal
          title="Add Medicine Warning"
          subtitle="Safety-engine knowledge data"
          onClose={() => setWarningModal(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setWarningModal(false)}>
                Cancel
              </Button>
              <Button form="warning-form" type="submit">
                Add
              </Button>
            </>
          }
        >
          <form
            id="warning-form"
            onSubmit={handleAddWarning}
            className="space-y-4"
          >
            <SelectInput
              label="Medicine *"
              value={warningForm.medicineId}
              onChange={(e) =>
                setWarningForm({
                  ...warningForm,
                  medicineId: e.target.value,
                })
              }
            >
              <option value="">Select...</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectInput>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectInput
                label="Warning type *"
                value={warningForm.warningType}
                onChange={(e) =>
                  setWarningForm({
                    ...warningForm,
                    warningType: e.target.value as MedicineWarningType,
                  })
                }
              >
                {WARNING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Severity *"
                value={warningForm.severity}
                onChange={(e) =>
                  setWarningForm({
                    ...warningForm,
                    severity: e.target.value as MedicineWarning["severity"],
                  })
                }
              >
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="SEVERE">SEVERE</option>
              </SelectInput>
            </div>
            <TextInput
              label="Condition"
              hint="For contraindications: a keyword that must appear on the patient's record (e.g. asthma). For age warnings: child / under 12 / pediatric."
              value={warningForm.condition}
              onChange={(e) =>
                setWarningForm({
                  ...warningForm,
                  condition: e.target.value,
                })
              }
              placeholder="e.g. asthma"
            />
            <TextArea
              label="Message *"
              rows={2}
              value={warningForm.message}
              onChange={(e) =>
                setWarningForm({ ...warningForm, message: e.target.value })
              }
              placeholder="Warning text shown to the pharmacist"
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
