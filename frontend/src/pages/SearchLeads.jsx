import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SectionPage from './SectionPage';
import {
  getCategories,
  getLastSearch,
  saveLeads,
  searchPlacesLeads,
} from '../api';

const PAGE_SIZE = 15;

const COUNTRY_OPTIONS = [
  { code: 'lk', label: 'Sri Lanka' },
  { code: 'us', label: 'United States' },
  { code: 'gb', label: 'United Kingdom' },
  { code: 'in', label: 'India' },
  { code: 'au', label: 'Australia' },
  { code: 'ca', label: 'Canada' },
  { code: 'de', label: 'Germany' },
  { code: 'fr', label: 'France' },
  { code: 'ae', label: 'United Arab Emirates' },
  { code: 'sg', label: 'Singapore' },
  { code: 'nz', label: 'New Zealand' },
  { code: 'ie', label: 'Ireland' },
  { code: 'nl', label: 'Netherlands' },
  { code: 'it', label: 'Italy' },
  { code: 'es', label: 'Spain' },
  { code: 'jp', label: 'Japan' },
  { code: 'br', label: 'Brazil' },
  { code: 'mx', label: 'Mexico' },
  { code: 'za', label: 'South Africa' },
];

function SaveLeadsModal({
  open,
  onClose,
  onConfirm,
  categories,
  categoriesLoading,
  categoriesError,
  selectedCategory,
  onSelectCategory,
  saving,
  saveError,
  resultsCount,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-leads-modal-title"
        className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl max-h-[85vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2
              id="save-leads-modal-title"
              className="text-base font-semibold text-gray-900"
            >
              Save leads
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Choose a category (from{' '}
              <code className="text-[10px]">data/catogeries.json</code>). {resultsCount}{' '}
              lead{resultsCount === 1 ? '' : 's'} will be saved.
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

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {categoriesLoading ? (
            <p className="text-sm text-gray-500">Loading categories…</p>
          ) : categoriesError ? (
            <p className="text-sm text-red-600 font-medium">{categoriesError}</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-600">
              No categories yet. Add them under{' '}
              <Link
                to="/dashboard/settings"
                className="font-semibold text-indigo-600 hover:text-indigo-800"
                onClick={onClose}
              >
                Settings
              </Link>
              .
            </p>
          ) : (
            <fieldset>
              <legend className="text-xs font-semibold text-gray-700 mb-2 block">
                Category
              </legend>
              <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {categories.map((c) => (
                  <li key={c}>
                    <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 cursor-pointer hover:bg-gray-100/80 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
                      <input
                        type="radio"
                        name="save-leads-category"
                        value={c}
                        checked={selectedCategory === c}
                        onChange={() => onSelectCategory(c)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-medium text-gray-800">{c}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {saveError ? (
            <p className="text-sm text-red-600 font-medium">{saveError}</p>
          ) : null}
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex justify-end gap-2 shrink-0 bg-gray-50/80 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              saving || !selectedCategory || categories.length === 0 || categoriesLoading
            }
            onClick={onConfirm}
            className="rounded-2xl bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SearchLeads() {
  const [phrase, setPhrase] = useState('');
  const [country, setCountry] = useState('lk');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [pagesFetched, setPagesFetched] = useState(0);
  const [maxApiPages, setMaxApiPages] = useState(40);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [saveSaving, setSaveSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fromLastSearchFile, setFromLastSearchFile] = useState(false);

  const loadCategoriesForModal = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError('');
    try {
      const data = await getCategories();
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (err) {
      setCategoriesError(
        typeof err?.message === 'string' ? err.message : 'Could not load categories'
      );
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!saveModalOpen) return;
    setSelectedCategory('');
    setSaveError('');
    loadCategoriesForModal();
  }, [saveModalOpen, loadCategoriesForModal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getLastSearch();
        const rows = Array.isArray(data.results) ? data.results : [];
        if (cancelled || rows.length === 0) return;
        setResults(rows);
        setPhrase(String(data.searchPhrase ?? '').trim());
        const gl = String(data.country ?? '').trim().toLowerCase();
        if (gl.length === 2) setCountry(gl);
        setListPage(1);
        setPagesFetched(0);
        setSearched(true);
        setFromLastSearchFile(true);
        setError('');
      } catch {
        // No snapshot yet or backend unreachable — leave empty state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveLeadsConfirm() {
    if (!selectedCategory || results.length === 0) return;
    setSaveError('');
    setSaveSaving(true);
    try {
      await saveLeads({
        category: selectedCategory,
        searchPhrase: phrase.trim(),
        country,
        leads: results,
      });
      setSaveModalOpen(false);
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not save leads';
      setSaveError(typeof msg === 'string' ? msg : 'Could not save leads');
    } finally {
      setSaveSaving(false);
    }
  }

  async function handleSearch(e) {
    e?.preventDefault?.();
    const q = phrase.trim();
    if (!q) {
      setError('Enter a search phrase.');
      setResults([]);
      return;
    }
    if (!country || country.length !== 2) {
      setError('Select a country.');
      setResults([]);
      return;
    }

    setError('');
    setLoading(true);
    setResults([]);
    setListPage(1);
    setPagesFetched(0);
    setMaxApiPages(40);
    setSearched(true);
    setFromLastSearchFile(false);
    try {
      const data = await searchPlacesLeads({ q, gl: country });
      setResults(Array.isArray(data.results) ? data.results : []);
      setPagesFetched(
        typeof data.pagesFetched === 'number' ? data.pagesFetched : 0
      );
      if (typeof data.maxPages === 'number' && data.maxPages > 0) {
        setMaxApiPages(data.maxPages);
      }
    } catch (err) {
      const msg =
        err?.data?.error ||
        err?.data?.details?.message ||
        err?.message ||
        'Search failed';
      setError(typeof msg === 'string' ? msg : 'Search failed');
      setResults([]);
      setPagesFetched(0);
      setMaxApiPages(40);
      setFromLastSearchFile(false);
    } finally {
      setLoading(false);
    }
  }

  const totalListPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));

  useEffect(() => {
    setListPage((p) => Math.min(p, totalListPages));
  }, [totalListPages]);

  const safeListPage = Math.min(listPage, totalListPages);
  const pageOffset = (safeListPage - 1) * PAGE_SIZE;
  const pagedResults = results.slice(pageOffset, pageOffset + PAGE_SIZE);

  return (
    <SectionPage
      title="Search Leads"
      description="We load every API page until no more places are returned, then you can browse results here with pagination."
    >
      <form
        onSubmit={handleSearch}
        className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3"
      >
        <div className="flex min-w-0 flex-row flex-nowrap items-end gap-3 overflow-x-auto pb-0.5">
          <label className="block min-w-[12rem] flex-1">
            <span className="text-sm font-semibold text-gray-700">
              Search phrase
            </span>
            <input
              type="search"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="e.g. salons in Chilaw"
              autoComplete="off"
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="block w-44 shrink-0 md:w-48">
            <span className="text-sm font-semibold text-gray-700">Country</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-2xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? 'Loading all pages…' : 'Search'}
          </button>
        </div>

        {error ? (
          <p className="text-sm text-red-600 font-medium">{error}</p>
        ) : null}
      </form>

      {searched && !loading && !error && results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-5 py-8 text-center text-sm text-gray-600">
          No businesses with a phone number or email matched this query. Try a
          different phrase or country.
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold text-gray-900">
                  Results ({results.length})
                </h3>
                {fromLastSearchFile ? (
                  <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-0.5">
                    From last search file
                  </span>
                ) : null}
                {pagesFetched > 0 ? (
                  <span className="text-xs text-gray-500">
                    API pages loaded: {pagesFetched}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSaveModalOpen(true)}
                className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100/90"
              >
                Save leads
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Listings without a phone number and without an email are hidden.
              Email appears when the API or snippet includes one.
            </p>
            {pagesFetched > 0 &&
            results.length > 0 &&
            pagesFetched >= maxApiPages ? (
              <p className="text-xs text-amber-700 mt-2 font-medium">
                Reached the server page limit ({maxApiPages}). Increase{' '}
                <code className="text-[10px]">SERPER_PLACES_MAX_PAGES</code> in
                backend <code className="text-[10px]">.env</code> if you need more
                API pages per search.
              </p>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Business name</th>
                  <th className="px-5 py-3">Contact number</th>
                  <th className="px-5 py-3">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedResults.map((row, idx) => (
                  <tr
                    key={`${row.businessName}-${row.phone}-${pageOffset + idx}`}
                    className="hover:bg-gray-50/80"
                  >
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {row.businessName || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {row.phone || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-700 break-all max-w-[14rem]">
                      {row.email || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalListPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 bg-gray-50/80">
              <p className="text-xs text-gray-600">
                Page {safeListPage} of {totalListPages}
                <span className="text-gray-400 mx-1">·</span>
                {PAGE_SIZE} per page
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeListPage <= 1}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safeListPage >= totalListPages}
                  onClick={() =>
                    setListPage((p) => Math.min(totalListPages, p + 1))
                  }
                  className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <SaveLeadsModal
        open={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setSaveError('');
        }}
        onConfirm={handleSaveLeadsConfirm}
        categories={categories}
        categoriesLoading={categoriesLoading}
        categoriesError={categoriesError}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        saving={saveSaving}
        saveError={saveError}
        resultsCount={results.length}
      />
    </SectionPage>
  );
}
