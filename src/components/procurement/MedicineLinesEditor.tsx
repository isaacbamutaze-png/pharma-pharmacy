import { Plus, Trash2 } from "lucide-react";
import { SelectInput, TextInput } from "../ui/Input";
import { Button } from "../ui/Button";
import { uid } from "../../lib/utils";
import type { Medicine, MedicineUnit } from "../../types";

export interface LineDraft {
  key: string;
  medicineId: string;
  unitId: string;
  unitName: string;
  unitConversion: number;
  qty: string;
  cost?: string;
}

interface MedicineLinesEditorProps {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  medicines: Medicine[];
  unitsByMedicine: Map<string, MedicineUnit[]>;
  showCost?: boolean;
  costLabel?: string;
  addLine?: () => LineDraft;
}

function defaultUnit(
  unitsByMedicine: Map<string, MedicineUnit[]>,
  medicineId: string,
): MedicineUnit | undefined {
  const units = unitsByMedicine.get(medicineId) ?? [];
  return (
    units.find((u) => u.isDefault) ??
    units.find((u) => u.isBase) ??
    units[0]
  );
}

export function MedicineLinesEditor({
  lines,
  onChange,
  medicines,
  unitsByMedicine,
  showCost = false,
  costLabel = "Unit Cost",
  addLine,
}: MedicineLinesEditorProps) {
  const addLineFn = addLine ?? (() => {
    const first = medicines[0];
    const unit = first ? defaultUnit(unitsByMedicine, first.id) : undefined;
    return {
      key: uid(),
      medicineId: first?.id ?? "",
      unitId: unit?.id ?? "",
      unitName: unit?.unitName ?? "",
      unitConversion: unit?.conversionToBase ?? 1,
      qty: "1",
      cost: showCost ? "" : undefined,
    };
  });

  const handleAdd = () => onChange([...lines, addLineFn()]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const unitsFor = (medicineId: string): MedicineUnit[] =>
    unitsByMedicine.get(medicineId) ?? [];

  return (
    <div>
      <div className="space-y-2">
        {lines.map((line) => {
          const units = unitsFor(line.medicineId);
          return (
            <div
              key={line.key}
              className="grid grid-cols-12 items-end gap-2 rounded-lg border border-slate-200 p-2"
            >
              <div className="col-span-12 sm:col-span-4">
                <SelectInput
                  label="Medicine"
                  value={line.medicineId}
                  onChange={(e) => {
                    const unit = defaultUnit(unitsByMedicine, e.target.value);
                    updateLine(line.key, {
                      medicineId: e.target.value,
                      unitId: unit?.id ?? "",
                      unitName: unit?.unitName ?? "",
                      unitConversion: unit?.conversionToBase ?? 1,
                    });
                  }}
                >
                  {medicines
                    .filter((m) => m.status === "ACTIVE")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.strength ? ` (${m.strength})` : ""}
                      </option>
                    ))}
                </SelectInput>
              </div>
              {units.length > 1 && (
                <div className="col-span-6 sm:col-span-2">
                  <SelectInput
                    label="Unit"
                    value={line.unitId}
                    onChange={(e) => {
                      const u = units.find((x) => x.id === e.target.value);
                      updateLine(line.key, {
                        unitId: e.target.value,
                        unitName: u?.unitName ?? "",
                        unitConversion: u?.conversionToBase ?? 1,
                      });
                    }}
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitName}
                        {u.conversionToBase !== 1
                          ? ` (1 = ${u.conversionToBase})`
                          : ""}
                      </option>
                    ))}
                  </SelectInput>
                </div>
              )}
              <div className="col-span-6 sm:col-span-2">
                <TextInput
                  label="Qty"
                  type="number"
                  min="1"
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                />
              </div>
              {showCost && (
                <div className="col-span-6 sm:col-span-3">
                  <TextInput
                    label={costLabel}
                    type="number"
                    min="0"
                    value={line.cost ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      updateLine(line.key, { cost: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="col-span-12 flex justify-end sm:col-span-1 sm:justify-center">
                <button
                  onClick={() =>
                    onChange(lines.filter((l) => l.key !== line.key))
                  }
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove line"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus size={14} />
          Add Medicine
        </Button>
      </div>
    </div>
  );
}
