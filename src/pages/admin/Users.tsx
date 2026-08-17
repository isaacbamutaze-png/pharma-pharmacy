import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Pencil, Trash2, ShieldCheck, UserCircle2 } from "lucide-react";
import { pharmaDb } from "../../db";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput, Checkbox } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { hashPassword } from "../../lib/password";
import { uid, now, formatDateTime } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import type { Role, UserRecord } from "../../types";

interface UserForm {
  fullName: string;
  username: string;
  roleId: string;
  phone: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  newPassword: string;
}

const emptyForm: UserForm = {
  fullName: "",
  username: "",
  roleId: "",
  phone: "",
  email: "",
  status: "ACTIVE",
  newPassword: "",
};

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const users = useLiveQuery(() => pharmaDb.users.toArray(), []) ?? [];
  const roles = useLiveQuery(() => pharmaDb.roles.toArray(), []) ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const roleIcon = (role: Role) =>
    role === "ADMIN" ? (
      <ShieldCheck size={18} className="text-pharma-600" />
    ) : (
      <UserCircle2 size={18} className="text-blue-600" />
    );

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, roleId: roles.find((r) => r.name === "USER")?.id ?? "" });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (u: UserRecord) => {
    setEditingId(u.id);
    setForm({
      fullName: u.fullName,
      username: u.username,
      roleId: u.roleId,
      phone: u.phone ?? "",
      email: u.email ?? "",
      status: u.status,
      newPassword: "",
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!form.fullName.trim() || !form.username.trim() || !form.roleId) {
      setError("Full name, username, and role are required.");
      return;
    }

    const usernameTaken = users.some(
      (u) =>
        u.username.toLowerCase() === form.username.trim().toLowerCase() &&
        u.id !== editingId,
    );
    if (usernameTaken) {
      setError("That username is already in use.");
      return;
    }

    const base = {
      fullName: form.fullName.trim(),
      username: form.username.trim().toLowerCase(),
      roleId: form.roleId,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      status: form.status,
      updatedAt: now(),
    };

    try {
      if (editingId) {
        await pharmaDb.users.update(editingId, base);
        if (form.newPassword.trim()) {
          const passwordHash = await hashPassword(form.newPassword);
          await pharmaDb.users.update(editingId, { passwordHash });
        }
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: currentUser.id,
          action: "UPDATE",
          entityType: "user",
          entityId: editingId,
          oldValues: { username: base.username },
          newValues: { ...base },
          createdAt: now(),
        });
      } else {
        if (!form.newPassword.trim()) {
          setError("A password is required for new users.");
          return;
        }
        const passwordHash = await hashPassword(form.newPassword);
        const id = uid();
        await pharmaDb.users.add({
          id,
          ...base,
          passwordHash,
          createdAt: now(),
        });
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: currentUser.id,
          action: "CREATE",
          entityType: "user",
          entityId: id,
          newValues: { ...base },
          createdAt: now(),
        });
      }
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user.");
    }
  };

  const handleToggleStatus = async (u: UserRecord) => {
    if (!currentUser) return;
    if (u.id === currentUser.id) {
      setError("You cannot deactivate your own account.");
      return;
    }
    const next = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await pharmaDb.users.update(u.id, { status: next, updatedAt: now() });
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: currentUser.id,
      action: next === "INACTIVE" ? "DEACTIVATE" : "ACTIVATE",
      entityType: "user",
      entityId: u.id,
      oldValues: { status: u.status },
      newValues: { status: next },
      createdAt: now(),
    });
  };

  const handleDelete = async (u: UserRecord) => {
    if (!currentUser) return;
    if (u.id === currentUser.id) {
      setError("You cannot delete your own account.");
      return;
    }
    if (!window.confirm(`Delete user "${u.fullName}"?`)) return;
    await pharmaDb.users.delete(u.id);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: currentUser.id,
      action: "DELETE",
      entityType: "user",
      entityId: u.id,
      oldValues: { username: u.username },
      createdAt: now(),
    });
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage pharmacy staff accounts"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Add User
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
        {users.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No users found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Last Login</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const role = roleMap.get(u.roleId);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                            {roleIcon(role?.name ?? "USER")}
                          </span>
                          <div>
                            <p className="font-medium text-slate-900">
                              {u.fullName}
                            </p>
                            <p className="text-xs text-slate-500">
                              @{u.username}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={role?.name === "ADMIN" ? "green" : "blue"}>
                          {role?.name ?? "USER"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {u.phone || u.email || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {u.lastLogin ? formatDateTime(u.lastLogin) : "Never"}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={u.status === "ACTIVE" ? "green" : "slate"}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openEdit(u)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                            aria-label={`Edit ${u.fullName}`}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(u)}
                            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                          >
                            {u.status === "ACTIVE" ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Delete ${u.fullName}`}
                          >
                            <Trash2 size={16} />
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

      {showModal && (
        <Modal
          title={editingId ? "Edit User" : "Add User"}
          subtitle="Staff account details"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button form="user-form" type="submit">
                {editingId ? "Save Changes" : "Add User"}
              </Button>
            </>
          }
        >
          <form id="user-form" onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput
                label="Full Name *"
                placeholder="e.g. John Mukasa"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
              <TextInput
                label="Username *"
                placeholder="e.g. jmukasa"
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value })
                }
              />
              <SelectInput
                label="Role *"
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Password"
                type="password"
                placeholder={
                  editingId ? "Leave blank to keep current" : "Set password *"
                }
                value={form.newPassword}
                onChange={(e) =>
                  setForm({ ...form, newPassword: e.target.value })
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
                placeholder="e.g. user@pharmacy.ug"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            {editingId && (
              <Checkbox
                label="Account active"
                checked={form.status === "ACTIVE"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.checked ? "ACTIVE" : "INACTIVE",
                  })
                }
              />
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
