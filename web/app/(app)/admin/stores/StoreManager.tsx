"use client";

import { useState } from "react";

import { Banner, EmptyState, Modal, Spinner } from "@/components/ui";
import { del, get, patch, post } from "@/lib/client";
import type { Store } from "@/lib/types";

type Draft = { code: string; name: string; city: string; is_active: boolean };

const EMPTY: Draft = { code: "", name: "", city: "", is_active: true };

export function StoreManager({ initial }: { initial: Store[] }) {
  const [stores, setStores] = useState(initial);
  const [editing, setEditing] = useState<Store | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setStores(await get<Store[]>("/stores"));

  function openCreate() {
    setDraft(EMPTY);
    setEditing(null);
    setError(null);
    setCreating(true);
  }

  function openEdit(store: Store) {
    setDraft({
      code: store.code,
      name: store.name,
      city: store.city ?? "",
      is_active: store.is_active,
    });
    setError(null);
    setEditing(store);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await patch<Store>(`/stores/${editing.id}`, {
          name: draft.name,
          city: draft.city || null,
          is_active: draft.is_active,
        });
      } else {
        await post<Store>("/stores", {
          code: draft.code,
          name: draft.name,
          city: draft.city || null,
          is_active: draft.is_active,
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

  async function toggleActive(store: Store) {
    setPageError(null);
    try {
      await patch<Store>(`/stores/${store.id}`, { is_active: !store.is_active });
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(store: Store) {
    if (!confirm(`Delete store ${store.code}? This cannot be undone.`)) return;
    setPageError(null);
    try {
      await del(`/stores/${store.id}`);
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const open = creating || editing !== null;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary btn-sm">
          + New store
        </button>
      </div>

      {pageError && <Banner kind="error">{pageError}</Banner>}

      <div className="card overflow-hidden">
        {stores.length === 0 ? (
          <EmptyState title="No stores yet" hint="Create your first store to start routing orders." icon="🏪" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="border-b border-cream-200 bg-cream/60">
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th">City</th>
                  <th className="th text-center">Users</th>
                  <th className="th text-center">Pending</th>
                  <th className="th">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id} className="border-b border-cream-200 last:border-0">
                    <td className="td font-black">{store.code}</td>
                    <td className="td">{store.name}</td>
                    <td className="td text-ink-400">{store.city || "—"}</td>
                    <td className="td text-center font-bold">{store.user_count ?? 0}</td>
                    <td className="td text-center font-bold">{store.pending_orders ?? 0}</td>
                    <td className="td">
                      <span
                        className={`chip ${
                          store.is_active ? "bg-emerald-100 text-emerald-800" : "bg-cream-200 text-ink-400"
                        }`}
                      >
                        {store.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openEdit(store)} className="btn-ghost btn-sm">
                          Edit
                        </button>
                        <button onClick={() => toggleActive(store)} className="btn-ghost btn-sm">
                          {store.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => remove(store)}
                          className="btn-ghost btn-sm text-brand-500 hover:bg-brand-50"
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
        title={editing ? `Edit ${editing.code}` : "New store"}
        subtitle={editing ? undefined : "The code is permanent — it is what CSV rows match on."}
      >
        <div className="space-y-4">
          {error && <Banner kind="error">{error}</Banner>}

          <div>
            <label className="label" htmlFor="store-code">
              Store code
            </label>
            <input
              id="store-code"
              className="input font-mono uppercase"
              placeholder="MUM01"
              value={draft.code}
              disabled={editing !== null}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
          </div>

          <div>
            <label className="label" htmlFor="store-name">
              Name
            </label>
            <input
              id="store-name"
              className="input"
              placeholder="Bandra Flagship"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="store-city">
              City
            </label>
            <input
              id="store-city"
              className="input"
              placeholder="Mumbai"
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm font-bold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand-500)]"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            />
            Active — inactive stores reject new CSV rows
          </label>

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
            <button
              className="btn-primary"
              onClick={save}
              disabled={busy || !draft.code.trim() || !draft.name.trim()}
            >
              {busy && <Spinner />}
              {editing ? "Save changes" : "Create store"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
