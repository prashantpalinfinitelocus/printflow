"use client";

import { useState } from "react";

import { Banner, EmptyState, Modal, Spinner } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { del, get, patch, post } from "@/lib/client";
import type { Role, Store, User } from "@/lib/types";

type Draft = {
  email: string;
  full_name: string;
  password: string;
  role: Role;
  store_id: string;
};

const EMPTY: Draft = { email: "", full_name: "", password: "", role: "OPERATOR", store_id: "" };

export function UserManager({
  initial,
  stores,
  currentUserId,
}: {
  initial: User[];
  stores: Store[];
  currentUserId: number;
}) {
  const [users, setUsers] = useState(initial);
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setUsers(await get<User[]>("/users"));
  const activeStores = stores.filter((s) => s.is_active);

  function openCreate() {
    setDraft({ ...EMPTY, store_id: activeStores[0] ? String(activeStores[0].id) : "" });
    setEditing(null);
    setError(null);
    setCreating(true);
  }

  function openEdit(user: User) {
    setDraft({
      email: user.email,
      full_name: user.full_name ?? "",
      password: "",
      role: user.role,
      store_id: user.store_id ? String(user.store_id) : "",
    });
    setError(null);
    setEditing(user);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const storeId = draft.role === "OPERATOR" ? Number(draft.store_id) || null : null;
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          full_name: draft.full_name || null,
          role: draft.role,
          store_id: storeId,
        };
        if (draft.password) body.password = draft.password;
        await patch<User>(`/users/${editing.id}`, body);
      } else {
        await post<User>("/users", {
          email: draft.email,
          password: draft.password,
          full_name: draft.full_name || null,
          role: draft.role,
          store_id: storeId,
        });
      }
      await refresh();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: User) {
    setPageError(null);
    try {
      await patch<User>(`/users/${user.id}`, { is_active: !user.is_active });
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(user: User) {
    if (!confirm(`Delete ${user.email}? Their print history stays, but the login is removed.`)) return;
    setPageError(null);
    try {
      await del(`/users/${user.id}`);
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const open = creating || editing !== null;
  const canSave =
    draft.full_name !== undefined &&
    (editing
      ? draft.password === "" || draft.password.length >= 6
      : draft.email.includes("@") && draft.password.length >= 6) &&
    (draft.role === "ADMIN" || draft.store_id !== "");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary btn-sm">
          + New user
        </button>
      </div>

      {pageError && <Banner kind="error">{pageError}</Banner>}
      {activeStores.length === 0 && (
        <Banner kind="info">
          There are no active stores yet. Create a store before adding operators — every operator
          must be assigned to one.
        </Banner>
      )}

      <div className="card overflow-hidden">
        {users.length === 0 ? (
          <EmptyState title="No users" icon="👤" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="border-b border-cream-200 bg-cream/60">
                <tr>
                  <th className="th">User</th>
                  <th className="th">Role</th>
                  <th className="th">Store</th>
                  <th className="th">Status</th>
                  <th className="th">Last login</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-cream-200 last:border-0">
                    <td className="td">
                      <p className="font-bold">
                        {user.full_name || user.email}
                        {user.id === currentUserId && (
                          <span className="ml-2 chip bg-brand-50 text-brand-600">you</span>
                        )}
                      </p>
                      <p className="text-xs text-ink-400">{user.email}</p>
                    </td>
                    <td className="td">
                      <span
                        className={`chip ${
                          user.role === "ADMIN"
                            ? "bg-brand-50 text-brand-600"
                            : "bg-cream-200 text-ink-600"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="td font-bold">
                      {user.store ? `${user.store.code}` : <span className="text-ink-400">—</span>}
                    </td>
                    <td className="td">
                      <span
                        className={`chip ${
                          user.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-cream-200 text-ink-400"
                        }`}
                      >
                        {user.is_active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td className="td text-ink-400">{dateTime(user.last_login_at)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openEdit(user)} className="btn-ghost btn-sm">
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(user)}
                          className="btn-ghost btn-sm"
                          disabled={user.id === currentUserId}
                          title={user.id === currentUserId ? "You cannot deactivate yourself" : ""}
                        >
                          {user.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => remove(user)}
                          className="btn-ghost btn-sm text-brand-500 hover:bg-brand-50"
                          disabled={user.id === currentUserId}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.email}` : "New user"}
        subtitle={editing ? "Leave the password blank to keep the current one." : undefined}
      >
        <div className="space-y-4">
          {error && <Banner kind="error">{error}</Banner>}

          <div>
            <label className="label" htmlFor="user-email">
              Email
            </label>
            <input
              id="user-email"
              type="email"
              className="input"
              placeholder="operator@company.com"
              value={draft.email}
              disabled={editing !== null}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="user-name">
              Full name
            </label>
            <input
              id="user-name"
              className="input"
              value={draft.full_name}
              onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="user-password">
              {editing ? "New password" : "Password"}
            </label>
            <input
              id="user-password"
              type="password"
              className="input"
              placeholder={editing ? "Leave blank to keep unchanged" : "At least 6 characters"}
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="user-role">
                Role
              </label>
              <select
                id="user-role"
                className="input"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
              >
                <option value="OPERATOR">Operator</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="user-store">
                Store
              </label>
              <select
                id="user-store"
                className="input"
                value={draft.store_id}
                disabled={draft.role === "ADMIN"}
                onChange={(e) => setDraft({ ...draft, store_id: e.target.value })}
              >
                <option value="">
                  {draft.role === "ADMIN" ? "All stores" : "Select a store…"}
                </option>
                {activeStores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.code} — {store.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-ink-400">
            One operator, one store. Admins are never tied to a store and can see every queue.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
            <button className="btn-primary" onClick={save} disabled={busy || !canSave}>
              {busy && <Spinner />}
              {editing ? "Save changes" : "Create user"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
