import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { TextInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { uid, now } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import type { MedicineCategory } from "../../types";

export function CategoriesPage() {
  const user = useAuthStore((s) => s.user);
  const categories =
    useLiveQuery(() => pharmaDb.medicineCategories.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MedicineCategory | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const countByCategory = (id: string) =>
    medicines.filter((m) => m.categoryId === id).length;

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setError(null);
    setShowModal(true);
  };

  const openEdit = (c: MedicineCategory) => {
    setEditing(c);
    setName(c.name);
    setDescription(c.description ?? "");
    setError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!name.trim()) {
      setError("Category name is required.");
      return;
    }
    try {
      if (editing) {
        await pharmaDb.medicineCategories.update(editing.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: user.id,
          action: "UPDATE",
          entityType: "medicine_category",
          entityId: editing.id,
          oldValues: { name: editing.name },
          newValues: { name: name.trim() },
          createdAt: now(),
        });
      } else {
        await pharmaDb.medicineCategories.add({
          id: uid(),
          name: name.trim(),
          description: description.trim() || undefined,
          createdAt: now(),
        });
      }
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category.");
    }
  };

  const handleDelete = async (c: MedicineCategory) => {
    if (!user) return;
    const used = countByCategory(c.id);
    if (used > 0) {
      setError(
        `Cannot delete "${c.name}" because ${used} medicine(s) use it.`,
      );
      return;
    }
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    await pharmaDb.medicineCategories.delete(c.id);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: "DELETE",
      entityType: "medicine_category",
      entityId: c.id,
      oldValues: { name: c.name },
      createdAt: now(),
    });
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Dosage form categories for medicines"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Add Category
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

      <Card>
        {categories.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No categories yet. Click 'Add Category' to create one.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-4"
              >
                <div>
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {countByCategory(c.id)} medicine(s)
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(c)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showModal && (
        <Modal
          title={editing ? "Edit Category" : "Add Category"}
          subtitle="Dosage form category"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button form="category-form" type="submit">
                {editing ? "Save Changes" : "Add Category"}
              </Button>
            </>
          }
        >
          <form id="category-form" onSubmit={handleSave} className="space-y-4">
            <TextInput
              label="Category Name *"
              placeholder="e.g. Tablet"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextInput
              label="Description"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
