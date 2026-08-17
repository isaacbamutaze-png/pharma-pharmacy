import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { uid, now } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import type { Supplier } from "../../types";

interface SupplierForm {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
}

const emptyForm: SupplierForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  taxNumber: "",
};

export function SuppliersPage() {
  const user = useAuthStore((s) => s.user);
  const suppliers = useLiveQuery(() => pharmaDb.suppliers.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      contactPerson: s.contactPerson ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      taxNumber: s.taxNumber ?? "",
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    const data = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      taxNumber: form.taxNumber.trim() || undefined,
      updatedAt: now(),
    };
    try {
      if (editingId) {
        await pharmaDb.suppliers.update(editingId, data);
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: user.id,
          action: "UPDATE",
          entityType: "supplier",
          entityId: editingId,
          oldValues: { name: form.name.trim() },
          newValues: { ...data },
          createdAt: now(),
        });
      } else {
        const id = uid();
        await pharmaDb.suppliers.add({
          id,
          ...data,
          status: "ACTIVE",
          createdAt: now(),
        });
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: user.id,
          action: "CREATE",
          entityType: "supplier",
          entityId: id,
          newValues: { ...data },
          createdAt: now(),
        });
      }
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save supplier.");
    }
  };

  const handleToggleStatus = async (s: Supplier) => {
    if (!user) return;
    const next = s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await pharmaDb.suppliers.update(s.id, { status: next, updatedAt: now() });
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: next === "INACTIVE" ? "DEACTIVATE" : "ACTIVATE",
      entityType: "supplier",
      entityId: s.id,
      oldValues: { status: s.status },
      newValues: { status: next },
      createdAt: now(),
    });
  };

  const handleDelete = async (s: Supplier) => {
    if (!user) return;
    const used = batches.filter((b) => b.supplierId === s.id).length;
    if (used > 0) {
      setError(
        `Cannot delete "${s.name}" because ${used} batch(es) reference it.`,
      );
      return;
    }
    if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
    await pharmaDb.suppliers.delete(s.id);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: "DELETE",
      entityType: "supplier",
      entityId: s.id,
      oldValues: { name: s.name },
      createdAt: now(),
    });
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Medicine suppliers and distributors"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Add Supplier
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
        {suppliers.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No suppliers yet. Click 'Add Supplier' to create one.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-pharma-50">
                      <Truck size={20} className="text-pharma-600" />
                    </span>
                    <div>
                      <p className="font-medium text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {s.contactPerson || "No contact person"}
                      </p>
                    </div>
                  </div>
                  <Badge tone={s.status === "ACTIVE" ? "green" : "slate"}>
                    {s.status}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {s.phone && <p>Phone: {s.phone}</p>}
                  {s.email && <p>Email: {s.email}</p>}
                  {s.address && <p>Address: {s.address}</p>}
                  {s.taxNumber && <p>Tax No: {s.taxNumber}</p>}
                </div>
                <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => openEdit(s)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(s)}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                  >
                    {s.status === "ACTIVE" ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${s.name}`}
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
          title={editingId ? "Edit Supplier" : "Add Supplier"}
          subtitle="Supplier details"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button form="supplier-form" type="submit">
                {editingId ? "Save Changes" : "Add Supplier"}
              </Button>
            </>
          }
        >
          <form id="supplier-form" onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput
                label="Supplier Name *"
                placeholder="e.g. Kampala Pharma Distributors"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextInput
                label="Contact Person"
                placeholder="e.g. Sarah Kato"
                value={form.contactPerson}
                onChange={(e) =>
                  setForm({ ...form, contactPerson: e.target.value })
                }
              />
              <TextInput
                label="Phone"
                placeholder="e.g. +256 700 000000"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <TextInput
                label="Email"
                type="email"
                placeholder="e.g. sales@supplier.ug"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <TextInput
                label="Tax Number"
                placeholder="e.g. TIN-000000"
                value={form.taxNumber}
                onChange={(e) =>
                  setForm({ ...form, taxNumber: e.target.value })
                }
              />
              <TextArea
                label="Address"
                rows={2}
                placeholder="Street, City"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
