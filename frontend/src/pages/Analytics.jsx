import { useCallback, useEffect, useState } from 'react';
import SectionPage from './SectionPage';
import { getAnalyticsOverview } from '../api';
import PaginationControls from '../components/PaginationControls';

const EMPTY = {
  totalLeads: 0,
  leadsWithContact: 0,
  campaignCount: 0,
  outboundCampaignCount: 0,
  sentContacts: 0,
  repliedContacts: 0,
  replyRatePct: 0,
  messageSendsByDay: [],
  messageSendsLast10DaysTotal: 0,
  messageSendsChartIsDemo: false,
  recentSearches: [],
  projectStatusCampaigns: [],
  liveCampaignCount: 0,
};
const ANALYTICS_LIST_PAGE_SIZE = 4;

const PROJECT_BUCKET_META = {
  live: {
    label: 'Live',
    pill: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    bar: 'bg-emerald-600',
  },
  upcoming: {
    label: 'Upcoming',
    pill: 'text-indigo-700 bg-indigo-50 border-indigo-100',
    bar: 'bg-indigo-600',
  },
  completed: {
    label: 'Completed',
    pill: 'text-slate-600 bg-slate-50 border-slate-100',
    bar: 'bg-slate-500',
  },
  draft: {
    label: 'Draft',
    pill: 'text-amber-800 bg-amber-50 border-amber-100',
    bar: 'bg-amber-500',
  },
  paused: {
    label: 'Paused',
    pill: 'text-amber-900 bg-amber-100/80 border-amber-200',
    bar: 'bg-amber-600',
  },
};

function formatSendChartDayLabel(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  if (
    dt.getFullYear() === today.getFullYear() &&
    dt.getMonth() === today.getMonth() &&
    dt.getDate() === today.getDate()
  ) {
    return 'Today';
  }
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function formatSearchHistoryWhen(iso) {
  if (!iso || typeof iso !== 'string') return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Analytics() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectPage, setProjectPage] = useState(1);
  const [searchesPage, setSearchesPage] = useState(1);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await getAnalyticsOverview();
      setData({
        totalLeads: Number(res.totalLeads) || 0,
        leadsWithContact: Number(res.leadsWithContact) || 0,
        campaignCount: Number(res.campaignCount) || 0,
        outboundCampaignCount: Number(res.outboundCampaignCount) || 0,
        sentContacts: Number(res.sentContacts) || 0,
        repliedContacts: Number(res.repliedContacts) || 0,
        replyRatePct: Number(res.replyRatePct) || 0,
        messageSendsByDay: Array.isArray(res.messageSendsByDay)
          ? res.messageSendsByDay
          : [],
        messageSendsLast10DaysTotal:
          Number(res.messageSendsLast10DaysTotal) || 0,
        messageSendsChartIsDemo: Boolean(res.messageSendsChartIsDemo),
        recentSearches: Array.isArray(res.recentSearches)
          ? res.recentSearches
          : [],
        projectStatusCampaigns: Array.isArray(res.projectStatusCampaigns)
          ? res.projectStatusCampaigns
          : [],
        liveCampaignCount: Number(res.liveCampaignCount) || 0,
      });
    } catch (e) {
      setError(
        typeof e?.message === 'string' ? e.message : 'Could not load analytics'
      );
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replyPct = data.replyRatePct;
  const totalProjectPages = Math.max(
    1,
    Math.ceil((data.projectStatusCampaigns?.length || 0) / ANALYTICS_LIST_PAGE_SIZE)
  );
  const totalSearchPages = Math.max(
    1,
    Math.ceil((data.recentSearches?.length || 0) / ANALYTICS_LIST_PAGE_SIZE)
  );
  useEffect(() => {
    setProjectPage((p) => Math.min(p, totalProjectPages));
  }, [totalProjectPages]);
  useEffect(() => {
    setSearchesPage((p) => Math.min(p, totalSearchPages));
  }, [totalSearchPages]);
  const safeProjectPage = Math.min(projectPage, totalProjectPages);
  const safeSearchesPage = Math.min(searchesPage, totalSearchPages);
  const pagedProjectStatus = data.projectStatusCampaigns.slice(
    (safeProjectPage - 1) * ANALYTICS_LIST_PAGE_SIZE,
    safeProjectPage * ANALYTICS_LIST_PAGE_SIZE
  );
  const pagedRecentSearches = data.recentSearches.slice(
    (safeSearchesPage - 1) * ANALYTICS_LIST_PAGE_SIZE,
    safeSearchesPage * ANALYTICS_LIST_PAGE_SIZE
  );

  return (
    <SectionPage
      title="Analytics"
      description="A premium overview of performance, conversion, and outreach impact."
    >
      {error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3 text-sm text-red-700 mb-4">
          {error}{' '}
          <button
            type="button"
            onClick={() => load()}
            className="font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Total leads</div>
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <span className="font-bold">L</span>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900 tabular-nums">
            {loading ? '…' : data.totalLeads.toLocaleString()}
          </div>
          <div className="mt-2 text-sm text-gray-600">
            <span className="font-semibold text-gray-800 tabular-nums">
              {loading ? '…' : data.leadsWithContact.toLocaleString()}
            </span>{' '}
            with phone · from{' '}
            <code className="text-[10px] bg-gray-100 px-1 rounded">savedLeads.json</code>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Conversion rate</div>
            <div className="w-9 h-9 rounded-2xl bg-violet-50 text-violet-700 flex items-center justify-center">
              <span className="font-bold">C</span>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900 tabular-nums">
            {loading ? '…' : `${replyPct}%`}
          </div>
          <div className="mt-2 text-sm text-gray-600 leading-snug">
            <span className="font-semibold text-gray-800 tabular-nums">
              {loading ? '…' : data.repliedContacts.toLocaleString()}
            </span>{' '}
            replied /{' '}
            <span className="font-semibold text-gray-800 tabular-nums">
              {loading ? '…' : data.sentContacts.toLocaleString()}
            </span>{' '}
            system send contacts
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Campaigns</div>
            <div className="w-9 h-9 rounded-2xl bg-fuchsia-50 text-fuchsia-700 flex items-center justify-center">
              <span className="font-bold">#</span>
            </div>
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900 tabular-nums">
            {loading ? '…' : data.campaignCount.toLocaleString()}
          </div>
          <div className="mt-2 text-sm text-gray-600 leading-snug">
            <span className="font-semibold text-emerald-700 tabular-nums">
              {loading ? '…' : data.outboundCampaignCount.toLocaleString()}
            </span>{' '}
            outbound (system) ·{' '}
            <span className="font-semibold text-gray-800 tabular-nums">
              {loading ? '…' : data.campaignCount.toLocaleString()}
            </span>{' '}
            total in{' '}
            <code className="text-[10px] font-medium text-gray-600 bg-gray-100 px-1 rounded">
              campaigns.json
            </code>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Message sends
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Last 10 days · successful WhatsApp deliveries (
                <code className="text-[10px]">messageSendLog.json</code>)
                {data.messageSendsChartIsDemo ? (
                  <span className="text-amber-700 font-medium">
                    {' '}
                    · Mock preview (no sends logged yet)
                  </span>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-xl tabular-nums">
              {loading
                ? '…'
                : `${data.messageSendsLast10DaysTotal.toLocaleString()} sends${
                    data.messageSendsChartIsDemo ? ' (demo)' : ''
                  }`}
            </span>
          </div>

          <div className="mt-5 flex min-h-[11rem] items-end gap-1 px-0.5 sm:gap-2 sm:px-1">
            {loading ? (
              Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-lg bg-slate-100"
                  style={{ height: '32px' }}
                />
              ))
            ) : (
              data.messageSendsByDay.map((day) => {
                const maxC = Math.max(
                  1,
                  ...data.messageSendsByDay.map((x) => x.count)
                );
                const hPx =
                  day.count === 0 ? 6 : 8 + (day.count / maxC) * 104;
                return (
                  <div
                    key={day.date}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  >
                    <div
                      className="w-full max-w-[2.75rem] rounded-t-lg bg-gradient-to-t from-indigo-600/25 to-indigo-600 mx-auto transition-[height] duration-300"
                      style={{ height: `${hPx}px` }}
                      title={`${day.count} message(s) · ${day.date}`}
                    />
                    <span className="w-full truncate text-center text-[10px] font-medium text-gray-500 leading-tight">
                      {formatSendChartDayLabel(day.date)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500 px-1">
            <span>
              {loading || !data.messageSendsByDay[0]
                ? '…'
                : data.messageSendsByDay[0].date}
            </span>
            <span>
              {loading ||
              !data.messageSendsByDay[data.messageSendsByDay.length - 1]
                ? '…'
                : data.messageSendsByDay[data.messageSendsByDay.length - 1].date}
            </span>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Project status
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Last 4 campaigns · live, upcoming, paused, completed, draft
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-xl tabular-nums">
              {loading
                ? '…'
                : data.liveCampaignCount > 0
                  ? `${data.liveCampaignCount} live`
                  : `${data.campaignCount} campaigns`}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-gray-100 bg-gray-50 p-4 animate-pulse"
                >
                  <div className="h-4 w-3/4 rounded bg-gray-200" />
                  <div className="mt-3 h-2 w-full rounded-full bg-gray-200" />
                </div>
              ))
            ) : data.projectStatusCampaigns.length === 0 ? (
              <div className="sm:col-span-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center text-sm text-gray-500">
                No campaigns yet. Create one under Campaigns.
              </div>
            ) : (
              pagedProjectStatus.map((item) => {
                const meta =
                  PROJECT_BUCKET_META[item.bucket] ??
                  PROJECT_BUCKET_META.draft;
                const pct = Number(item.completedPercent) || 0;
                return (
                  <div
                    key={item.id || item.name}
                    className="rounded-2xl border border-gray-100 bg-gray-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 truncate min-w-0">
                        {item.name}
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide border px-2 py-0.5 rounded-lg ${meta.pill}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs text-gray-500">Progress</div>
                      <div className="text-xs font-semibold text-gray-900 tabular-nums">
                        {pct}%
                      </div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={`h-full ${meta.bar} transition-[width] duration-300`}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <PaginationControls
            page={safeProjectPage}
            totalPages={totalProjectPages}
            pageSizeLabel={`${ANALYTICS_LIST_PAGE_SIZE} per page`}
            className="mt-4"
            onPrev={() => setProjectPage((p) => Math.max(1, p - 1))}
            onNext={() => setProjectPage((p) => Math.min(totalProjectPages, p + 1))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Most visited pages
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Up to 4 recent searches from Search Leads (phrase and result count)
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
              <div>Search phrase</div>
              <div className="text-right tabular-nums">Results</div>
              <div className="text-right">Country</div>
              <div className="text-right whitespace-nowrap">When</div>
            </div>
            {loading ? (
              <div className="px-4 py-8 text-sm text-gray-500 text-center border-t border-gray-100">
                …
              </div>
            ) : data.recentSearches.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-500 text-center border-t border-gray-100">
                No searches yet. Run a search on Search Leads to see history here.
              </div>
            ) : (
              pagedRecentSearches.map((row, idx) => (
                <div
                  key={`${row.searchPhrase ?? ''}-${row.searchedAt ?? (idx + (safeSearchesPage - 1) * ANALYTICS_LIST_PAGE_SIZE)}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-3 text-sm text-gray-700 border-t border-gray-100 items-center"
                >
                  <div className="truncate min-w-0" title={row.searchPhrase}>
                    {row.searchPhrase || '—'}
                  </div>
                  <div className="text-right font-semibold text-gray-900 tabular-nums">
                    {Number(row.resultCount) || 0}
                  </div>
                  <div className="text-right font-semibold text-gray-900 uppercase text-xs">
                    {row.country ? String(row.country) : '—'}
                  </div>
                  <div className="text-right text-xs text-gray-600 whitespace-nowrap">
                    {formatSearchHistoryWhen(row.searchedAt)}
                  </div>
                </div>
              ))
            )}
          </div>
          <PaginationControls
            page={safeSearchesPage}
            totalPages={totalSearchPages}
            pageSizeLabel={`${ANALYTICS_LIST_PAGE_SIZE} per page`}
            className="mt-3"
            onPrev={() => setSearchesPage((p) => Math.max(1, p - 1))}
            onNext={() => setSearchesPage((p) => Math.min(totalSearchPages, p + 1))}
          />
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <div className="text-sm font-semibold text-gray-900">
            Engagement overview
          </div>
          <div className="text-xs text-gray-500 mt-1">Replied ÷ sent</div>

          <div className="mt-5 flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-gray-900 tabular-nums">
                {loading ? '…' : `${replyPct}%`}
              </div>
              <div className="text-xs text-gray-500 mt-1">Replied ÷ sent</div>
            </div>
            <div
              className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-indigo-100"
              style={{
                background: loading
                  ? 'rgb(224 231 255)'
                  : `conic-gradient(rgb(79 70 229) ${Math.min(100, replyPct)}%, rgb(224 231 255) 0)`,
              }}
            >
              <div className="absolute inset-[6px] flex items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-800 tabular-nums shadow-sm">
                {loading ? '…' : `${replyPct}%`}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Send contacts (est.)</span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {loading ? '…' : data.sentContacts.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Replied (seen)</span>
              <span className="font-semibold text-indigo-700 tabular-nums">
                {loading ? '…' : data.repliedContacts.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </SectionPage>
  );
}
