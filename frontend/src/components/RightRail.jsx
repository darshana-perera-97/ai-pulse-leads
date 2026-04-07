import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, getRailStats } from '../api';
import PaginationControls from './PaginationControls';

function CardShell({ children, className = '' }) {
  return (
    <div
      className={`bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

function formatWaStatusLabel(state) {
  if (!state) return '…';
  return String(state).replace(/_/g, ' ');
}

function formatActivityTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function RightRail() {
  const [waStatus, setWaStatus] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [railSummary, setRailSummary] = useState({
    completionRatePct: 0,
    completionDetail: '',
    estTimeToComplete: '—',
    estTimeDetail: '',
  });
  const [recentSentContacts, setRecentSentContacts] = useState([]);
  const [recentSentContactsIsMock, setRecentSentContactsIsMock] = useState(false);
  const [railLoading, setRailLoading] = useState(true);
  const [railError, setRailError] = useState(false);
  const [recentPage, setRecentPage] = useState(1);

  const refresh = useCallback(async () => {
    try {
      const s = await apiFetch('/whatsapp/status');
      setWaStatus(s);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setWaStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadRail() {
      try {
        const data = await getRailStats();
        if (cancelled) return;
        setRailSummary(
          data.summary && typeof data.summary === 'object'
            ? data.summary
            : {
                completionRatePct: 0,
                completionDetail: '',
                estTimeToComplete: '—',
                estTimeDetail: '',
              }
        );
        setRecentSentContacts(
          Array.isArray(data.recentSentContacts) ? data.recentSentContacts : []
        );
        setRecentSentContactsIsMock(Boolean(data.recentSentContactsIsMock));
        setRailError(false);
      } catch {
        if (!cancelled) {
          setRailError(true);
          setRecentSentContacts([]);
        }
      } finally {
        if (!cancelled) setRailLoading(false);
      }
    }
    setRailLoading(true);
    loadRail();
    const id = setInterval(loadRail, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const ready = waStatus?.state === 'ready';
  const info = waStatus?.info;
  const displayName = info?.pushname || (ready ? 'WhatsApp' : 'WhatsApp');
  const phoneLine = info?.wid
    ? `+${String(info.wid).replace(/^\+/, '')}`
    : null;
  const RECENT_PAGE_SIZE = 5;
  const totalRecentPages = Math.max(
    1,
    Math.ceil((recentSentContacts?.length || 0) / RECENT_PAGE_SIZE)
  );
  useEffect(() => {
    setRecentPage((p) => Math.min(p, totalRecentPages));
  }, [totalRecentPages]);
  const safeRecentPage = Math.min(recentPage, totalRecentPages);
  const pagedRecentContacts = recentSentContacts.slice(
    (safeRecentPage - 1) * RECENT_PAGE_SIZE,
    safeRecentPage * RECENT_PAGE_SIZE
  );

  return (
    <aside className="space-y-4">
      <CardShell>
        <div className="p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              WhatsApp
            </div>
            <div className="text-xs text-gray-500 mt-1 truncate">
              {loadError
                ? 'Backend unreachable'
                : ready
                  ? 'Connected account'
                  : `Session: ${formatWaStatusLabel(waStatus?.state)}`}
            </div>
          </div>
          <Link
            to="/dashboard/integration"
            className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-gray-50"
          >
            Manage
          </Link>
        </div>

        <div className="px-5 pb-5">
          <div
            className={`relative overflow-hidden rounded-2xl border shadow-lg ${
              ready
                ? 'border-emerald-200/80 shadow-emerald-900/10 ring-1 ring-emerald-100/90'
                : 'border-slate-200/85 shadow-slate-900/8 ring-1 ring-slate-100/95'
            }`}
          >
            {ready ? (
              <>
                <div
                  className="absolute inset-0 bg-[linear-gradient(145deg,rgb(209,250,229)_0%,rgb(167,243,208)_38%,rgb(186,230,253)_72%,rgb(224,231,255)_100%)]"
                  aria-hidden
                />
                <div
                  className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-emerald-400/42 blur-3xl"
                  aria-hidden
                />
                <div
                  className="absolute -bottom-14 -left-8 h-36 w-36 rounded-full bg-cyan-300/48 blur-2xl"
                  aria-hidden
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-white/42 via-transparent to-white/28"
                  aria-hidden
                />
              </>
            ) : (
              <>
                <div
                  className="absolute inset-0 bg-[linear-gradient(145deg,rgb(241,245,249)_0%,rgb(226,232,240)_45%,rgb(237,233,254)_100%)]"
                  aria-hidden
                />
                <div
                  className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-indigo-200/52 blur-3xl"
                  aria-hidden
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-white/48 via-transparent to-white/22"
                  aria-hidden
                />
              </>
            )}
            <div className="relative p-5">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm ring-1 backdrop-blur-[2px] ${
                    ready
                      ? 'bg-white/78 text-emerald-800 shadow-sm ring-emerald-200/85'
                      : 'bg-white/85 text-slate-700 shadow-sm ring-slate-200/95'
                  }`}
                >
                  WA
                </div>
                <div className="min-w-0">
                  <div
                    className={`text-xs font-medium ${
                      ready ? 'text-emerald-900/80' : 'text-slate-600'
                    }`}
                  >
                    Account
                  </div>
                  <div
                    className={`text-sm font-semibold truncate ${
                      ready ? 'text-emerald-950' : 'text-gray-900'
                    }`}
                  >
                    {loadError
                      ? '—'
                      : ready
                        ? displayName
                        : formatWaStatusLabel(waStatus?.state)}
                  </div>
                </div>
              </div>

              <div
                className={`mt-4 text-lg font-bold tracking-wide truncate ${
                  ready ? 'text-emerald-900' : 'text-gray-800'
                }`}
              >
                {loadError
                  ? 'Check server'
                  : phoneLine || (ready ? '—' : 'Not linked yet')}
              </div>

              <div className="mt-5 flex items-center justify-between text-xs gap-2">
                <div className="min-w-0">
                  <div
                    className={`uppercase tracking-wide text-[10px] font-semibold ${
                      ready ? 'text-emerald-900/65' : 'text-slate-600'
                    }`}
                  >
                    Platform
                  </div>
                  <span
                    className={`truncate block font-medium ${
                      ready ? 'text-emerald-950' : 'text-slate-800'
                    }`}
                  >
                    {loadError ? '—' : info?.platform || '—'}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`uppercase tracking-wide text-[10px] font-semibold ${
                      ready ? 'text-emerald-900/65' : 'text-slate-600'
                    }`}
                  >
                    Status
                  </div>
                  <span
                    className={`font-semibold ${
                      ready ? 'text-emerald-800' : 'text-slate-700'
                    }`}
                  >
                    {ready ? 'Active' : 'Idle'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-gray-500">
            Live from your backend (
            <code className="text-[10px]">/whatsapp/status</code>
            ). Scan QR under{' '}
            <Link
              to="/dashboard/integration"
              className="font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Integration
            </Link>
            .
          </p>
        </div>
      </CardShell>

      <CardShell>
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Profit Estimation
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Campaign progress ·{' '}
                <code className="text-[10px]">/dashboard/rail-stats</code>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl bg-gradient-to-br from-indigo-50/90 to-white border border-indigo-100/80 p-4 shadow-sm">
                <div className="text-xs font-semibold text-indigo-800/80 uppercase tracking-wide">
                  Campaign completion
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <div className="text-3xl font-bold tabular-nums text-gray-900">
                    {railLoading ? (
                      <span className="text-gray-400">…</span>
                    ) : railError ? (
                      '—'
                    ) : (
                      `${Number(railSummary.completionRatePct) || 0}%`
                    )}
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-[width] duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(railSummary.completionRatePct) || 0))}%`,
                    }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-gray-600 leading-snug">
                  {railError
                    ? 'Could not load campaigns'
                    : railSummary.completionDetail ||
                      'Weighted by lead count across non-draft campaigns'}
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Est. time to complete
                </div>
                <div className="mt-2 text-xl font-bold text-gray-900 leading-tight">
                  {railLoading ? (
                    <span className="text-gray-400">…</span>
                  ) : (
                    railSummary.estTimeToComplete ?? '—'
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500 leading-snug">
                  {railError
                    ? 'Could not load campaigns'
                    : railSummary.estTimeDetail ?? ''}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Recent message sends
                </div>
                {recentSentContactsIsMock ? (
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg">
                    Mock data
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-gray-500 leading-snug mb-3">
                Last 10 contacts that received an outbound WhatsApp send
              </p>
              <div className="space-y-2.5 max-h-[22rem] overflow-y-auto overflow-x-hidden pr-1 scrollbar-thin">
                {railLoading && recentSentContacts.length === 0 ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : recentSentContacts.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No sent-message contacts to show yet.
                  </p>
                ) : (
                  pagedRecentContacts.map((row, idx) => (
                    <div
                      key={`${row.contactNumber}-${row.sentAt ?? idx}-${safeRecentPage}`}
                      className="rounded-xl border border-gray-100 bg-white/80 px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-gray-900 truncate min-w-0">
                          {row.contactName || '—'}
                        </span>
                        <time
                          className="text-[10px] text-gray-500 tabular-nums shrink-0"
                          dateTime={row.sentAt}
                        >
                          {formatActivityTime(row.sentAt)}
                        </time>
                      </div>
                      <div className="mt-1 text-xs font-semibold text-gray-800 tabular-nums">
                        {row.contactNumber || '—'}
                      </div>
                      <div className="mt-1 text-[11px] font-medium text-indigo-700 truncate">
                        {row.campaignName || 'Campaign'}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <PaginationControls
                page={safeRecentPage}
                totalPages={totalRecentPages}
                pageSizeLabel={`${RECENT_PAGE_SIZE} per page`}
                className="mt-3"
                onPrev={() => setRecentPage((p) => Math.max(1, p - 1))}
                onNext={() => setRecentPage((p) => Math.min(totalRecentPages, p + 1))}
              />
            </div>
          </div>
        </div>
      </CardShell>
    </aside>
  );
}
