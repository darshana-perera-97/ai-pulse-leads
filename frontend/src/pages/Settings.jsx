import { useCallback, useEffect, useState } from 'react';
import SectionPage from './SectionPage';
import { addCategory, getCategories, getProfile, saveProfile } from '../api';

function AddCategoryModal({ open, onClose, onAdded, saving, error }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-modal-title"
        className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="category-modal-title"
              className="text-base font-semibold text-gray-900"
            >
              Add category
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Saved to <code className="text-[10px]">backend/data/catogeries.json</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onAdded(value);
          }}
        >
          <label className="block">
            <span className="text-xs font-semibold text-gray-700">Category name</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Salons, Retail…"
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          {error ? <p className="text-sm text-red-600 font-medium">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !value.trim()}
              className="rounded-2xl bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Settings() {
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileOrg, setProfileOrg] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedOk, setProfileSavedOk] = useState(false);

  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileSaveError('');
    try {
      const data = await getProfile();
      const p = data?.profile;
      if (p && typeof p === 'object') {
        setProfileName(String(p.name ?? ''));
        setProfileEmail(String(p.email ?? ''));
        setProfileOrg(String(p.organization ?? ''));
      }
    } catch {
      setProfileName('Adela Pearson');
      setProfileEmail('adela@example.com');
      setProfileOrg('Horizon Pro');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const refreshCategories = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getCategories();
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (err) {
      setLoadError(
        typeof err?.message === 'string' ? err.message : 'Could not load categories'
      );
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  async function handleSaveProfile(e) {
    e?.preventDefault?.();
    setProfileSaveError('');
    setProfileSavedOk(false);
    setProfileSaving(true);
    try {
      const data = await saveProfile({
        name: profileName.trim(),
        email: profileEmail.trim(),
        organization: profileOrg.trim(),
      });
      const p = data?.profile;
      if (p && typeof p === 'object') {
        setProfileName(String(p.name ?? ''));
        setProfileEmail(String(p.email ?? ''));
        setProfileOrg(String(p.organization ?? ''));
      }
      setProfileSavedOk(true);
      window.setTimeout(() => setProfileSavedOk(false), 2500);
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not save profile';
      setProfileSaveError(typeof msg === 'string' ? msg : 'Could not save profile');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleAddCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setModalError('');
    setSaving(true);
    try {
      const data = await addCategory({ name: trimmed });
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      setModalOpen(false);
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not save category';
      setModalError(typeof msg === 'string' ? msg : 'Could not save category');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionPage
      title="Settings"
      description="Control your workspace, security, and integrations."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <form
          className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl shadow-sm p-5"
          onSubmit={handleSaveProfile}
        >
          <div className="text-sm font-semibold text-gray-900">Profile</div>
          <div className="text-xs text-gray-500 mt-1">
            Update personal details — stored in{' '}
            <code className="text-[10px]">backend/data/profile.json</code>
          </div>

          {profileLoading ? (
            <p className="mt-5 text-sm text-gray-500">Loading profile…</p>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Name</div>
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    autoComplete="name"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Email</div>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    autoComplete="email"
                  />
                </label>
              </div>

              <div className="mt-4">
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    Organization
                  </div>
                  <input
                    value={profileOrg}
                    onChange={(e) => setProfileOrg(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    autoComplete="organization"
                  />
                </label>
              </div>
            </>
          )}

          {profileSaveError ? (
            <p className="mt-3 text-sm text-red-600 font-medium">{profileSaveError}</p>
          ) : null}
          {profileSavedOk ? (
            <p className="mt-3 text-sm text-emerald-700 font-medium">Profile saved.</p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={profileLoading || profileSaving}
              className="rounded-2xl bg-indigo-600 text-white px-5 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {profileSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-900">Categories</div>
              <div className="text-xs text-gray-500 mt-1">
                Tags for organizing leads and campaigns
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setModalError('');
                setModalOpen(true);
              }}
              className="shrink-0 rounded-2xl bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              Add category
            </button>
          </div>

          {loadError ? (
            <p className="mt-3 text-xs text-red-600 font-medium">{loadError}</p>
          ) : null}

          <div className="mt-4 flex-1 min-h-[8rem]">
            {categories.length === 0 && !loadError ? (
              <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-6 text-center">
                No categories yet. Click <span className="font-semibold text-gray-700">Add category</span> to create one.
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {categories.map((c) => (
                  <li
                    key={c}
                    className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <AddCategoryModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModalError('');
        }}
        onAdded={handleAddCategory}
        saving={saving}
        error={modalError}
      />
    </SectionPage>
  );
}
