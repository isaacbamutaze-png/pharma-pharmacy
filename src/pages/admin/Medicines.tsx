import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import {
  TextInput,
  SelectInput,
  Checkbox,
  TextArea,
} from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { formatMoney, uid, now } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import type { Medicine, MedicineCategory } from "../../types";

interface UnitDraft {
  key: string;
  unitName: string;
  conversion: string;
  sellingPrice: string;
  barcode: string;
  canSell: boolean;
  isDefault: boolean;
  isBase: boolean;
}

interface MedicineForm {
  name: string;
  genericName: string;
  strength: string;
  categoryId: string;
  therapeuticCategory: string;
  unit: string;
  baseUnit: string;
  prescriptionRequired: boolean;
  controlCategory: "GENERAL" | "CDR";
  sellingPrice: string;
  minimumStock: string;
  reorderLevel: string;
  description: string;
  barcodes: string;
  units: UnitDraft[];
}

function emptyUnit(): UnitDraft {
  return {
    key: uid(),
    unitName: "",
    conversion: "1",
    sellingPrice: "",
    barcode: "",
    canSell: true,
    isDefault: true,
    isBase: true,
  };
}

const emptyForm: MedicineForm = {
  name: "",
  genericName: "",
  strength: "",
  categoryId: "",
  therapeuticCategory: "",
  unit: "Box",
  baseUnit: "Box",
  prescriptionRequired: false,
  controlCategory: "GENERAL",
  sellingPrice: "",
  minimumStock: "10",
  reorderLevel: "20",
  description: "",
  barcodes: "",
  units: [emptyUnit()],
};

export function MedicinesPage() {
  const user = useAuthStore((s) => s.user);
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const categories =
    useLiveQuery(() => pharmaDb.medicineCategories.toArray(), []) ?? [];
  const barcodes =
    useLiveQuery(() => pharmaDb.medicineBarcodes.toArray(), []) ?? [];

  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MedicineForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [prefillBarcode, setPrefillBarcode] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem("prefill_barcode");
      if (raw) {
        sessionStorage.removeItem("prefill_barcode");
        const parsed = JSON.parse(raw) as { barcode?: string };
        return parsed?.barcode ?? null;
      }
    } catch {
      /* ignore malformed prefill */
    }
    return null;
  });

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const barcodeMap = new Map<string, string[]>();
  for (const b of barcodes) {
    const list = barcodeMap.get(b.medicineId) ?? [];
    list.push(b.barcode);
    barcodeMap.set(b.medicineId, list);
  }

  const filtered = medicines.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(m.name ?? "").toLowerCase().includes(q) ||
      String(m.genericName ?? "").toLowerCase().includes(q) ||
      String(m.strength ?? "").toLowerCase().includes(q)
    );
  });

  const openCreate = () => {
    setEditingId(null);
    const firstUnit = emptyUnit();
    if (prefillBarcode) {
      firstUnit.barcode = prefillBarcode;
      setPrefillBarcode(null);
    }
    setForm({
      ...emptyForm,
      categoryId: categories[0]?.id ?? "",
      units: [firstUnit],
    });
    setError(null);
    setShowModal(true);
  };

  useEffect(() => {
    if (prefillBarcode && categories.length > 0 && !showModal) {
      openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillBarcode, categories, showModal]);

  const openEdit = async (m: Medicine) => {
    const existing = await pharmaDb.medicineBarcodes
      .where("medicineId")
      .equals(m.id)
      .toArray();
    const unitRows =
      (await pharmaDb.medicineUnits
        .where("medicineId")
        .equals(m.id)
        .sortBy("sortOrder")) || [];
    const units: UnitDraft[] =
      unitRows.length > 0
        ? unitRows.map((u) => ({
            key: u.id,
            unitName: u.unitName,
            conversion: String(u.conversionToBase),
            sellingPrice: String(u.sellingPrice),
            barcode: u.barcode ?? "",
            canSell: u.canSell,
            isDefault: !!u.isDefault,
            isBase: !!u.isBase,
          }))
        : [
            {
              key: uid(),
              unitName: m.baseUnit || m.unit || "Unit",
              conversion: "1",
              sellingPrice: String(m.sellingPrice),
              barcode: "",
              canSell: true,
              isDefault: true,
              isBase: true,
            },
          ];
    setEditingId(m.id);
    setForm({
      name: m.name ?? "",
      genericName: m.genericName ?? "",
      strength: m.strength ?? "",
      categoryId: m.categoryId ?? "",
      therapeuticCategory: m.therapeuticCategory ?? "",
      unit: m.unit ?? "Box",
      baseUnit: m.baseUnit ?? m.unit ?? "Box",
      prescriptionRequired: m.prescriptionRequired,
      controlCategory: m.controlCategory ?? "GENERAL",
      sellingPrice: String(m.sellingPrice ?? ""),
      minimumStock: String(m.minimumStock ?? ""),
      reorderLevel: String(m.reorderLevel ?? ""),
      description: m.description ?? "",
      barcodes: existing.map((b) => b.barcode).join("\n"),
      units,
    });
    setError(null);
    setShowModal(true);
  };

  const updateUnit = (index: number, patch: Partial<UnitDraft>) => {
    setForm((prev) => {
      const units = prev.units.map((u, i) =>
        i === index ? { ...u, ...patch } : u,
      );
      const defaultIndex = units.findIndex((u) => u.isDefault);
      const hasDefault = defaultIndex >= 0;
      const baseIndex = units.findIndex((u) => u.isBase);
      return {
        ...prev,
        units,
        unit: hasDefault ? units[defaultIndex].unitName : prev.unit,
        baseUnit:
          baseIndex >= 0 && units[baseIndex].unitName
            ? units[baseIndex].unitName
            : prev.baseUnit,
      };
    });
  };

  const setDefaultUnit = (index: number) => {
    setForm((prev) => {
      const units = prev.units.map((u, i) => ({
        ...u,
        isDefault: i === index,
      }));
      return { ...prev, units, unit: units[index].unitName };
    });
  };

  const addUnit = () => {
    setForm((prev) => {
      const units = [
        ...prev.units,
        {
          key: uid(),
          unitName: "",
          conversion: "1",
          sellingPrice: "",
          barcode: "",
          canSell: true,
          isDefault: false,
          isBase: false,
        },
      ];
      return { ...prev, units };
    });
  };

  const removeUnit = (index: number) => {
    setForm((prev) => {
      const target = prev.units[index];
      if (target?.isBase) return prev;
      const units = prev.units.filter((_, i) => i !== index);
      if (target?.isDefault) {
        const nextDefault = units.findIndex((u) => u.canSell);
        if (nextDefault >= 0) {
          units[nextDefault] = { ...units[nextDefault], isDefault: true };
        }
      }
      const defaultIndex = units.findIndex((u) => u.isDefault);
      return {
        ...prev,
        units,
        unit: defaultIndex >= 0 ? units[defaultIndex].unitName : prev.unit,
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) {
      setError("Medicine name is required.");
      return;
    }
    if (!form.categoryId) {
      setError("Please select a category.");
      return;
    }
    const priceUnit =
      form.units.find((u) => u.isDefault && u.canSell) ??
      form.units.find((u) => u.isBase) ??
      form.units[0];
    const price = Number(priceUnit?.sellingPrice);
    if (Number.isNaN(price) || price <= 0) {
      setError("Selling price must be greater than 0.");
      return;
    }

    const baseUnit = form.units.find((u) => u.isBase);
    if (!baseUnit || !baseUnit.unitName.trim()) {
      setError("A base unit name is required (where stock is counted).");
      return;
    }
    const names = form.units.map((u) => u.unitName.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError("Each unit must have a unique name.");
      return;
    }
    for (const u of form.units) {
      const conv = Number(u.conversion);
      if (!Number.isFinite(conv) || conv <= 0) {
        setError(`Conversion to base must be greater than 0 for "${u.unitName}".`);
        return;
      }
      if (u.isBase && conv !== 1) {
        setError("The base unit must convert to itself (conversion = 1).");
        return;
      }
      if (u.canSell && (!u.unitName.trim() || Number(u.sellingPrice) <= 0)) {
        setError("Sellable units need a name and a selling price.");
        return;
      }
    }
    const defaultUnit =
      form.units.find((u) => u.isDefault && u.canSell) ?? baseUnit;
    const defaultPrice = Number(defaultUnit.sellingPrice);

    const data = {
      name: form.name.trim(),
      genericName: form.genericName.trim() || undefined,
      strength: form.strength.trim() || undefined,
      categoryId: form.categoryId,
      therapeuticCategory: form.therapeuticCategory.trim() || undefined,
      unit: defaultUnit.unitName.trim() || "Box",
      baseUnit: baseUnit.unitName.trim(),
      prescriptionRequired: form.prescriptionRequired,
      controlCategory: form.controlCategory,
      sellingPrice: defaultPrice,
      minimumStock: Number(form.minimumStock) || 0,
      reorderLevel: Number(form.reorderLevel) || 0,
      description: form.description.trim() || undefined,
      updatedAt: now(),
    };

    try {
      const submittedBarcodes = [
        ...new Set(
          [
            ...form.barcodes.split(/[\n,]/),
            ...form.units.map((u) => u.barcode),
          ]
            .map((b) => b.trim())
            .filter((b) => b.length > 0),
        ),
      ];
      if (submittedBarcodes.length > 0) {
        const allBarcodes = await pharmaDb.medicineBarcodes.toArray();
        for (const barcode of submittedBarcodes) {
          const owner = allBarcodes.find(
            (b) =>
              b.barcode === barcode &&
              b.medicineId !== editingId,
          );
          if (owner) {
            const ownerName = medicines.find((m) => m.id === owner.medicineId)
              ?.name;
            setError(
              `Barcode "${barcode}" is already registered to ${
                ownerName ? `"${ownerName}"` : "another medicine"
              }.`,
            );
            return;
          }
        }
      }

      const targetId = editingId ?? uid();
      if (editingId) {
        const old = medicines.find((m) => m.id === editingId);
        await pharmaDb.medicines.update(editingId, data);
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: user.id,
          action: "UPDATE",
          entityType: "medicine",
          entityId: editingId,
          oldValues: old ? { ...old } : undefined,
          newValues: { ...data },
          createdAt: now(),
        });
      } else {
        await pharmaDb.medicines.add({
          id: targetId,
          ...data,
          status: "ACTIVE",
          createdAt: now(),
        });
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: user.id,
          action: "CREATE",
          entityType: "medicine",
          entityId: targetId,
          newValues: { ...data },
          createdAt: now(),
        });
      }

      const barcodeList = [
        ...new Set(
          form.barcodes
            .split(/[\n,]/)
            .map((b) => b.trim())
            .filter((b) => b.length > 0),
        ),
      ];
      await pharmaDb.medicineBarcodes
        .where("medicineId")
        .equals(targetId)
        .delete();
      if (barcodeList.length > 0) {
        await pharmaDb.medicineBarcodes.bulkAdd(
          barcodeList.map((barcode, index) => ({
            id: uid(),
            medicineId: targetId,
            barcode,
            barcodeType: "EAN",
            isPrimary: index === 0,
            createdAt: now(),
          })),
        );
      }

      await pharmaDb.medicineUnits
        .where("medicineId")
        .equals(targetId)
        .delete();
      const unitRows = form.units.map((u, index) => ({
        id: u.key,
        medicineId: targetId,
        unitName: u.unitName.trim() || "Unit",
        unitCode: u.isBase
          ? "BASE"
          : u.unitName
              .trim()
              .replace(/[^a-zA-Z0-9]/g, "")
              .toUpperCase()
              .slice(0, 6) || "UNIT",
        conversionToBase: Number(u.conversion),
        sellingPrice: Number(u.sellingPrice) || 0,
        canSell: u.canSell,
        canPurchase: true,
        isDefault: !!u.isDefault,
        isBase: !!u.isBase,
        sortOrder: index,
        createdAt: now(),
        updatedAt: now(),
      }));
      await pharmaDb.medicineUnits.bulkAdd(unitRows);
      await pharmaDb.medicineBarcodes.bulkAdd(
        form.units
          .filter((u) => u.barcode.trim().length > 0)
          .map((u) => ({
            id: uid(),
            medicineId: targetId,
            barcode: u.barcode.trim(),
            barcodeType: "EAN",
            isPrimary: false,
            unitId: u.key,
            unitName: u.unitName.trim() || "Unit",
            createdAt: now(),
          })),
      );

      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save medicine.");
    }
  };

  const handleToggleStatus = async (m: Medicine) => {
    if (!user) return;
    const next = m.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await pharmaDb.medicines.update(m.id, { status: next, updatedAt: now() });
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: next === "INACTIVE" ? "DEACTIVATE" : "ACTIVATE",
      entityType: "medicine",
      entityId: m.id,
      oldValues: { status: m.status },
      newValues: { status: next },
      createdAt: now(),
    });
  };

  const handleDelete = async (m: Medicine) => {
    if (!user) return;
    if (
      !window.confirm(
        `Delete "${m.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await pharmaDb.medicines.delete(m.id);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: "DELETE",
      entityType: "medicine",
      entityId: m.id,
      oldValues: { ...m },
      createdAt: now(),
    });
  };

  const categoryName = (id: string) =>
    categoryMap.get(id)?.name ?? "Unknown";

  return (
    <div>
      <PageHeader
        title="Medicines"
        subtitle={`${medicines.length} registered medicines`}
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Add Medicine
          </Button>
        }
      />

      <Card>
        <div className="mb-4">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search by name, generic name, or strength..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {medicines.length === 0
              ? "No medicines registered yet. Click 'Add Medicine' to start."
              : "No medicines match your search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Barcodes</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Reorder Level</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-900">
                        {m.name || "Unnamed medicine"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {m.genericName || m.therapeuticCategory || "—"}
                        {m.strength ? ` • ${m.strength}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {(barcodeMap.get(m.id) ?? []).length > 0 ? (
                        <span className="font-mono text-[11px] text-slate-500">
                          {(barcodeMap.get(m.id) ?? []).join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge>{categoryName(m.categoryId)}</Badge>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {formatMoney(m.sellingPrice)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      min {m.minimumStock}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={m.status === "ACTIVE" ? "green" : "slate"}>
                        {m.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(m)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                          aria-label={`Edit ${m.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(m)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                          aria-label={`Toggle status for ${m.name}`}
                          title={m.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        >
                          <Badge tone={m.status === "ACTIVE" ? "slate" : "green"}>
                            {m.status === "ACTIVE" ? "Disable" : "Enable"}
                          </Badge>
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${m.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showModal && (
        <Modal
          title={editingId ? "Edit Medicine" : "Add Medicine"}
          subtitle="Medicine registration form"
          onClose={() => setShowModal(false)}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button form="medicine-form" type="submit">
                {editingId ? "Save Changes" : "Add Medicine"}
              </Button>
            </>
          }
        >
          <form id="medicine-form" onSubmit={handleSave} className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput
                label="Medicine Name *"
                placeholder="e.g. Amoxicillin"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextInput
                label="Generic Name"
                placeholder="e.g. Amoxicillin trihydrate"
                value={form.genericName}
                onChange={(e) =>
                  setForm({ ...form, genericName: e.target.value })
                }
              />
              <TextInput
                label="Strength"
                placeholder="e.g. 500 mg"
                value={form.strength}
                onChange={(e) => setForm({ ...form, strength: e.target.value })}
              />
              <SelectInput
                label="Category *"
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
              >
                {categories.map((c: MedicineCategory) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Therapeutic Category"
                placeholder="e.g. Antibiotic"
                value={form.therapeuticCategory}
                onChange={(e) =>
                  setForm({ ...form, therapeuticCategory: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Min Stock (base units)"
                  type="number"
                  min="0"
                  value={form.minimumStock}
                  onChange={(e) =>
                    setForm({ ...form, minimumStock: e.target.value })
                  }
                />
                <TextInput
                  label="Reorder Level (base units)"
                  type="number"
                  min="0"
                  value={form.reorderLevel}
                  onChange={(e) =>
                    setForm({ ...form, reorderLevel: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-800">
                  Packaging / Units
                </label>
                <Badge tone="blue">
                  Base: {form.baseUnit.trim() || "—"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Stock is counted in the base unit (conversion 1). Set a price
                per sellable unit and mark one as the default. Example: 1 Strip
                = 10 Tablets, 1 Box = 10 Strips.
              </p>
              <div className="mt-3 space-y-2">
                {form.units.map((u, index) => (
                  <div
                    key={u.key}
                    className="rounded-lg border border-slate-100 bg-slate-50 p-2"
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <TextInput
                        label={u.isBase ? "Base unit" : "Unit name"}
                        placeholder={u.isBase ? "e.g. Tablet" : "e.g. Strip"}
                        value={u.unitName}
                        onChange={(e) =>
                          updateUnit(index, { unitName: e.target.value })
                        }
                      />
                      <TextInput
                        label="= base"
                        type="number"
                        min="1"
                        disabled={u.isBase}
                        value={u.conversion}
                        onChange={(e) =>
                          updateUnit(index, { conversion: e.target.value })
                        }
                      />
                      <TextInput
                        label="Selling price"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={u.sellingPrice}
                        onChange={(e) =>
                          updateUnit(index, { sellingPrice: e.target.value })
                        }
                      />
                      <TextInput
                        label="Barcode (optional)"
                        placeholder="Unit barcode"
                        value={u.barcode}
                        onChange={(e) =>
                          updateUnit(index, { barcode: e.target.value })
                        }
                      />
                      <div className="flex items-end justify-between gap-2 pb-1">
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="radio"
                            name="default-unit"
                            checked={u.isDefault}
                            onChange={() => setDefaultUnit(index)}
                            className="accent-pharma-600"
                          />
                          Default
                        </label>
                        {!u.isBase && (
                          <button
                            type="button"
                            onClick={() => removeUnit(index)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Remove ${u.unitName || "unit"}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={addUnit}
              >
                <Plus size={14} />
                Add unit
              </Button>
            </div>
            <Checkbox
              label="Prescription required"
              checked={form.prescriptionRequired}
              onChange={(e) =>
                setForm({ ...form, prescriptionRequired: e.target.checked })
              }
            />
            <SelectInput
              label="Control category"
              hint="CDR medicines must be dispensed by an authorized pharmacist and are tracked on the Controlled Drug Register."
              value={form.controlCategory}
              onChange={(e) =>
                setForm({
                  ...form,
                  controlCategory: e.target.value as MedicineForm["controlCategory"],
                })
              }
            >
              <option value="GENERAL">General</option>
              <option value="CDR">Controlled / Restricted (CDR)</option>
            </SelectInput>
            <TextArea
              label="Barcodes"
              rows={2}
              placeholder="One barcode per line, e.g.&#10;8901234567890&#10;8909876543210"
              hint="Used for scanner lookup. One per line or comma separated."
              value={form.barcodes}
              onChange={(e) =>
                setForm({ ...form, barcodes: e.target.value })
              }
            />
            <TextArea
              label="Description"
              rows={2}
              placeholder="Optional notes"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
