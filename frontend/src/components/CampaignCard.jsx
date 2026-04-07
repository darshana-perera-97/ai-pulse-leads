function stateTone(state) {
  const s = String(state ?? '').toLowerCase();
  if (s === 'running') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (s === 'scheduled') return 'bg-violet-50 text-violet-700 ring-violet-100';
  if (s === 'draft') return 'bg-indigo-50 text-indigo-700 ring-indigo-100';
  if (s === 'paused') return 'bg-amber-50 text-amber-700 ring-amber-100';
  if (s === 'completed') return 'bg-slate-100 text-slate-700 ring-slate-200';
  return 'bg-gray-50 text-gray-700 ring-gray-100';
}

function formatStateLabel(state) {
  const s = String(state ?? '').toLowerCase();
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {{
 *   campaign: Record<string, unknown>,
 *   meta?: {
 *     templatePreview: string,
 *     templateSubtitle?: string,
 *     withPhone: number,
 *     leadTotal: number,
 *     sentCount?: number,
 *     sendPercent?: number,
 *     scheduleLine: string,
 *     updatedLine: string,
 *     createdLine?: string,
 *   },
 *   busy?: boolean,
 *   onOpenAnalytics?: () => void,
 *   onPause?: () => void,
 *   onStart?: () => void,
 *   onDelete?: () => void,
 * }} props
 */
export default function CampaignCard({
  campaign,
  meta,
  busy = false,
  onOpenAnalytics,
  onPause,
  onStart,
  onDelete,
}) {
  const name = String(campaign?.name ?? 'Untitled');
  const state = String(campaign?.state ?? '').toLowerCase();
  const pctMeta = meta?.sendPercent;
  const pctFromCampaign = Math.min(100, Math.max(0, Number(campaign?.completedPercent) || 0));
  const pct = Number.isFinite(pctMeta) ? pctMeta : pctFromCampaign;
  const storedTotal = Number(campaign?.totalLeads);
  const leadTotal =
    meta?.leadTotal ??
    (Number.isFinite(storedTotal) && storedTotal > 0
      ? storedTotal
      : Array.isArray(campaign?.leads)
        ? campaign.leads.length
        : 0);
  const withPhone =
    meta?.withPhone ??
    (Array.isArray(campaign?.leads)
      ? campaign.leads.filter((l) => String(l?.contactNumber ?? '').trim()).length
      : 0);
  const sentFromMeta = meta?.sentCount;
  const sentCount =
    Number.isFinite(sentFromMeta) && sentFromMeta >= 0
      ? sentFromMeta
      : leadTotal > 0
        ? Math.min(leadTotal, Math.round((leadTotal * pct) / 100))
        : 0;
  const canPause = state === 'running' || state === 'scheduled';
  const canStart =
    state === 'draft' || state === 'paused' || state === 'scheduled';

  return (
    <article
      className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col min-h-[220px] cursor-pointer hover:border-indigo-200 transition-colors"
      role="button"
      tabIndex={0}
      onClick={() => onOpenAnalytics?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenAnalytics?.();
        }
      }}
      aria-label={`Open analytics for ${name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 leading-snug min-w-0">{name}</div>
        <span
          className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-xl ring-1 ${stateTone(state)}`}
        >
          {formatStateLabel(state)}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Send progress</div>
            <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
              {sentCount} of {leadTotal} saved lead{leadTotal === 1 ? '' : 's'}
              {withPhone < leadTotal ? ` · ${withPhone} with phone` : ''}
            </div>
          </div>
          <div className="text-xs font-semibold text-gray-900 tabular-nums shrink-0">{pct}%</div>
        </div>
        <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex-1" />

      <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
        {canStart ? (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onStart?.();
            }}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            Start
          </button>
        ) : null}
        {canPause ? (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onPause?.();
            }}
            className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            Pause
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
