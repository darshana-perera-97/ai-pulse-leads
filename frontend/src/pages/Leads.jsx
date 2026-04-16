import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLeadsStats, getSavedLeads } from '../api';
import PaginationControls from '../components/PaginationControls';

const EMPTY_STATS = {
  allLeads: 0,
  categories: 0,
  withContact: 0,
  landlines: 0,
};

const STAT_CARDS = [
  {
    label: 'All leads',
    statKey: 'allLeads',
    hint: 'Rows in savedLeads.json',
    tone: 'bg-indigo-50 text-indigo-700',
    surface:
      'bg-gradient-to-br from-indigo-50/95 via-indigo-50/35 to-white border-indigo-100/70 shadow-sm shadow-indigo-900/[0.04] ring-1 ring-inset ring-indigo-100/30',
  },
  {
    label: 'Categories',
    statKey: 'categories',
    hint: 'Entries in catogeries.json',
    tone: 'bg-violet-50 text-violet-700',
    surface:
      'bg-gradient-to-br from-violet-50/95 via-violet-50/35 to-white border-violet-100/70 shadow-sm shadow-violet-900/[0.04] ring-1 ring-inset ring-violet-100/30',
  },
  {
    label: 'Leads w/ contact',
    statKey: 'withContact',
    hint: 'Saved leads with a phone (6+ digits)',
    tone: 'bg-emerald-50 text-emerald-700',
    surface:
      'bg-gradient-to-br from-emerald-50/95 via-emerald-50/35 to-white border-emerald-100/70 shadow-sm shadow-emerald-900/[0.04] ring-1 ring-inset ring-emerald-100/30',
  },
  {
    label: 'Landline contacts',
    statKey: 'landlines',
    hint: 'Heuristic: not LK-style 07… mobile',
    tone: 'bg-amber-50 text-amber-700',
    surface:
      'bg-gradient-to-br from-amber-50/95 via-amber-50/35 to-white border-amber-100/70 shadow-sm shadow-amber-900/[0.04] ring-1 ring-inset ring-amber-100/30',
  },
];
const LEADS_PAGE_SIZE = 20;

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim();
}

/** Match if every whitespace-separated token appears somewhere in the lead fields. */
function leadMatchesQuery(row, rawQuery) {
  const q = norm(rawQuery);
  if (!q) return true;
  const haystack = norm(
    [
      row.category,
      row.companyName,
      row.contactNumber,
      row.email,
      row.searchPhrase,
      row.country,
    ].join(' ')
  );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}

export default function Leads() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [leadPage, setLeadPage] = useState(1);

  const filteredRows = useMemo(
    () => rows.filter((row) => leadMatchesQuery(row, searchQuery)),
    [rows, searchQuery]
  );
  const totalLeadPages = Math.max(1, Math.ceil(filteredRows.length / LEADS_PAGE_SIZE));
  useEffect(() => {
    setLeadPage(1);
  }, [searchQuery, rows.length]);
  useEffect(() => {
    setLeadPage((p) => Math.min(p, totalLeadPages));
  }, [totalLeadPages]);
  const safeLeadPage = Math.min(leadPage, totalLeadPages);
  const leadOffset = (safeLeadPage - 1) * LEADS_PAGE_SIZE;
  const pagedRows = filteredRows.slice(leadOffset, leadOffset + LEADS_PAGE_SIZE);

  const refresh = useCallback(async () => {
    setLoadError('');
    setLoading(true);

    const [savedRes, statsRes] = await Promise.allSettled([
      getSavedLeads(),
      getLeadsStats(),
    ]);

    if (savedRes.status === 'fulfilled') {
      const data = savedRes.value;
      setRows(Array.isArray(data?.leads) ? data.leads : []);
      setLoadError('');
    } else {
      setRows([]);
      setLoadError(
        typeof savedRes.reason?.message === 'string'
          ? savedRes.reason.message
          : 'Could not load saved leads'
      );
    }

    if (statsRes.status === 'fulfilled' && statsRes.value) {
      const v = statsRes.value;
      setStats({
        allLeads: Number(v.allLeads) || 0,
        categories: Number(v.categories) || 0,
        withContact: Number(v.withContact) || 0,
        landlines: Number(v.landlines) || 0,
      });
    } else {
      setStats(EMPTY_STATS);
    }

    setLoading(false);
  }, []);

  const downloadAllLeads = useCallback(() => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `savedLeads-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [rows]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Leads
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed max-w-2xl">
          A minimal view of your pipeline snapshot and leads persisted from Search.
        </p>
        <div
          className="h-px max-w-xs bg-gradient-to-r from-slate-200 via-slate-200/50 to-transparent"
          aria-hidden
        />
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {STAT_CARDS.map((s) => (
          <div
            key={s.label}
            className={`rounded-2xl border p-4 ${s.surface}`}
          >
            <div className="text-xs text-slate-600 font-semibold">{s.label}</div>
            <p className="mt-1 text-[11px] text-slate-500 leading-snug">{s.hint}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '…' : stats[s.statKey]}
              </div>
              <div
                className={`text-xs font-semibold px-2 py-1 rounded-xl shrink-0 ${s.tone}`}
              >
                Live
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative rounded-3xl bg-gradient-to-br from-slate-100/90 via-white to-indigo-50/40 p-[1px] shadow-[0_24px_48px_-12px_rgba(15,23,42,0.12),0_12px_24px_-8px_rgba(15,23,42,0.08)]">
        <div className="rounded-[calc(1.5rem-1px)] bg-white/95 backdrop-blur-sm overflow-hidden ring-1 ring-slate-200/60">
          <div className="relative px-6 sm:px-8 py-6 sm:py-7 border-b border-slate-200/70 bg-gradient-to-r from-slate-50/95 via-white to-indigo-50/25">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  'radial-gradient(ellipse 120% 80% at 100% -20%, rgba(99,102,241,0.12), transparent 55%)',
              }}
              aria-hidden
            />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                  Saved leads
                </h3>
                <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
                  Pulled from{' '}
                  <code className="text-xs font-medium text-slate-600 bg-slate-100/90 px-1.5 py-0.5 rounded-md">
                    savedLeads.json
                  </code>
                  . Append rows with{' '}
                  <span className="font-medium text-slate-700">Save leads</span> on Search
                  Leads.
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadAllLeads}
                  disabled={loading || rows.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 disabled:pointer-events-none"
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60 disabled:pointer-events-none"
                >
                  <svg
                    className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {loading ? 'Syncing…' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>

          {loadError ? (
            <div className="mx-6 sm:mx-8 my-6 rounded-2xl border border-red-100 bg-red-50/40 px-5 py-4 text-sm font-medium text-red-700">
              {loadError}
            </div>
          ) : loading ? (
            <div className="px-6 sm:px-8 py-16 text-center">
              <div className="inline-flex h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              <p className="mt-4 text-sm font-medium text-slate-500">
                Loading saved leads…
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 sm:px-8 py-14 text-center rounded-b-3xl">
              <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                No saved leads yet. Run a search, then use{' '}
                <span className="font-semibold text-slate-700">Save leads</span> with a
                category to build this list.
              </p>
            </div>
          ) : (
            <>
              <div className="px-6 sm:px-8 py-5 border-b border-slate-200/70 bg-slate-50/40">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <label
                      htmlFor="leads-search"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Search leads
                    </label>
                    <div className="flex flex-wrap items-stretch gap-2">
                      <div className="relative min-w-[min(100%,14rem)] flex-1 max-w-xl">
                        <span
                          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            />
                          </svg>
                        </span>
                        <input
                          id="leads-search"
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Company, phone, email, category, phrase, country…"
                          autoComplete="off"
                          className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                      {searchQuery.trim() ? (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">
                      Showing{' '}
                      <span className="font-semibold tabular-nums text-slate-700">
                        {filteredRows.length}
                      </span>{' '}
                      of{' '}
                      <span className="font-semibold tabular-nums text-slate-700">
                        {rows.length}
                      </span>
                      {searchQuery.trim() ? ' matching' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <div className="px-6 sm:px-8 py-14 text-center">
                  <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                    No leads match{' '}
                    <span className="font-semibold text-slate-800">
                      &ldquo;{searchQuery.trim()}&rdquo;
                    </span>
                    . Try different words or{' '}
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      clear the search
                    </button>
                    .
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto no-scrollbar">
                    <table className="min-w-full text-sm table-fixed">
                      <colgroup>
                        <col className="w-[8rem]" />
                        <col />
                        <col className="w-[9rem]" />
                        <col className="w-[11rem]" />
                        <col />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-slate-200/80 bg-slate-50/90">
                          {[
                            'Category',
                            'Company',
                            'Contact',
                            'Email',
                            'Search phrase',
                          ].map((label) => (
                            <th
                              key={label}
                              scope="col"
                              className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 first:pl-8 last:pr-8"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/90">
                        {pagedRows.map((row, idx) => (
                          <tr
                            key={`${row.companyName ?? ''}-${row.contactNumber ?? ''}-${row.savedAt ?? ''}-${leadOffset + idx}`}
                            className="group transition-colors duration-150 hover:bg-gradient-to-r hover:from-indigo-50/50 hover:via-violet-50/20 hover:to-transparent odd:bg-slate-50/40"
                          >
                            <td className="px-6 py-4 first:pl-8 align-middle">
                              <span className="inline-flex items-center rounded-full border border-indigo-200/70 bg-gradient-to-b from-white to-indigo-50/90 px-3 py-1 text-[11px] font-semibold text-indigo-900 shadow-sm shadow-indigo-900/5 ring-1 ring-white/80">
                                {row.category ?? '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 align-middle">
                              <span className="font-semibold text-slate-900 leading-snug line-clamp-2">
                                {row.companyName ?? '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 align-middle whitespace-nowrap font-mono text-[13px] text-slate-800 tracking-tight">
                              {row.contactNumber ?? '—'}
                            </td>
                            <td className="px-6 py-4 align-middle break-all text-slate-600 text-[13px] max-w-[11rem]">
                              {row.email ? (
                                <a
                                  href={`mailto:${row.email}`}
                                  className="text-indigo-600 hover:text-indigo-800 font-medium underline decoration-indigo-200/80 underline-offset-2"
                                >
                                  {row.email}
                                </a>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 last:pr-8 align-middle text-slate-600 text-[13px] leading-relaxed line-clamp-2">
                              {row.searchPhrase ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    page={safeLeadPage}
                    totalPages={totalLeadPages}
                    pageSizeLabel={`${LEADS_PAGE_SIZE} per page`}
                    className="px-6 sm:px-8 py-3 border-t border-slate-200/70 bg-slate-50/70"
                    onPrev={() => setLeadPage((p) => Math.max(1, p - 1))}
                    onNext={() => setLeadPage((p) => Math.min(totalLeadPages, p + 1))}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
