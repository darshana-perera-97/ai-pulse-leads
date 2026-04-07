import { useCallback, useEffect, useMemo, useState } from 'react';
import SectionPage from './SectionPage';
import CampaignCard from '../components/CampaignCard';
import PaginationControls from '../components/PaginationControls';
import {
  createCampaign,
  deleteCampaign,
  getCampaigns,
  getCategories,
  getMessages,
  getSavedLeads,
  messageAssetUrl,
  patchCampaignAction,
} from '../api';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * @param {Record<string, unknown>} campaign
 * @param {object[]} messages
 */
function getCampaignCardMeta(campaign, messages) {
  const leads = Array.isArray(campaign?.leads) ? campaign.leads : [];
  const storedTotal = Number(campaign?.totalLeads);
  const leadTotal =
    Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : leads.length;
  const withPhone = leads.filter((l) => String(l?.contactNumber ?? '').trim()).length;
  const sentRaw = Number(campaign?.sentCount);
  const sentCount = Number.isFinite(sentRaw)
    ? Math.max(0, Math.min(leadTotal, sentRaw))
    : null;
  const pctRaw = Number(campaign?.sendPercent);
  const pctFromLog = Number.isFinite(pctRaw)
    ? Math.min(100, Math.max(0, pctRaw))
    : null;
  const pctFromCampaign = Math.min(100, Math.max(0, Number(campaign?.completedPercent) || 0));
  const pct = Number.isFinite(pctFromLog) ? pctFromLog : pctFromCampaign;
  const sentCountResolved = Number.isFinite(sentCount)
    ? sentCount
    : leadTotal > 0
      ? Math.min(leadTotal, Math.round((leadTotal * pct) / 100))
      : 0;

  const msgList = Array.isArray(messages) ? messages : [];
  const tmpl = msgList.find((m) => m.id === campaign?.messageId);
  let templatePreview = 'No template linked';
  let templateSubtitle = '';
  if (tmpl) {
    templateSubtitle = tmpl.createdAt ? `Saved ${formatWhen(tmpl.createdAt)}` : '';
    const t = String(tmpl.text ?? '').trim();
    if (t) templatePreview = t.length > 90 ? `${t.slice(0, 90)}…` : t;
    else if (tmpl.imageFile) templatePreview = 'Image template (no caption text)';
    else templatePreview = '(Empty template)';
  } else if (campaign?.messageId) {
    templateSubtitle = `ID ${String(campaign.messageId).slice(0, 8)}…`;
  }

  const st = String(campaign?.state ?? '').toLowerCase();
  let scheduleLine = '—';
  if (st === 'draft') scheduleLine = 'Draft — not started';
  else if (st === 'running') {
    if (campaign?.endsAt) scheduleLine = `Running · window ends ${formatWhen(campaign.endsAt)}`;
    else scheduleLine = 'Running';
  } else if (st === 'scheduled' && campaign?.scheduledAt)
    scheduleLine = `Starts ${formatWhen(campaign.scheduledAt)}`;
  else if (st === 'paused') {
    if (campaign?.scheduledAt) scheduleLine = `Paused · was due ${formatWhen(campaign.scheduledAt)}`;
    else scheduleLine = 'Paused';
  } else if (st === 'completed') scheduleLine = 'Completed';
  else if (campaign?.startMode === 'scheduled' && campaign?.scheduledAt)
    scheduleLine = `Scheduled ${formatWhen(campaign.scheduledAt)}`;
  else scheduleLine = 'Run when started';

  const updatedLine = campaign?.updatedAt ? formatWhen(campaign.updatedAt) : '—';
  const createdLine = campaign?.createdAt ? formatWhen(campaign.createdAt) : '—';

  return {
    templatePreview,
    templateSubtitle,
    withPhone,
    leadTotal,
    sentCount: sentCountResolved,
    sendPercent: pct,
    scheduleLine,
    updatedLine,
    createdLine,
  };
}

/**
 * @param {object[]} savedLeads
 * @param {string[]} selectedCats
 * @param {string[]} selectedPhrases
 */
const CAMPAIGN_STATE_FILTERS = [
  { id: 'draft', label: 'Draft' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
];
const CAMPAIGNS_PAGE_SIZE = 6;

function normCampaign(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim();
}

function campaignMatchesBoardFilters(campaign, rawSearch, statusFilter) {
  const st = normCampaign(campaign.state);
  const filt = normCampaign(statusFilter);
  if (filt && st !== filt) return false;
  const q = normCampaign(rawSearch);
  if (!q) return true;
  const haystack = normCampaign(
    [
      campaign.name,
      campaign.state,
      campaign.startMode,
      campaign.id,
    ].join(' ')
  );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}

function filterLeads(savedLeads, selectedCats, selectedPhrases) {
  const cats = selectedCats.map((c) => String(c).toLowerCase());
  const phrases = selectedPhrases.map((p) => String(p).trim()).filter(Boolean);
  return savedLeads.filter((lead) => {
    const lc = String(lead.category ?? '').toLowerCase();
    const sp = String(lead.searchPhrase ?? '');
    const catOk = cats.length === 0 || cats.includes(lc);
    const phraseOk = phrases.length === 0 || phrases.some((p) => sp === p || sp.includes(p));
    if (cats.length === 0 && phrases.length === 0) return true;
    if (cats.length && phrases.length) return cats.includes(lc) && phraseOk;
    if (cats.length) return cats.includes(lc);
    return phraseOk;
  });
}

function CampaignAnalyticsModal({ open, campaign, meta, onClose }) {
  if (!open || !campaign) return null;
  const pct = Math.min(100, Math.max(0, Number(meta?.sendPercent) || 0));
  const total = Number(meta?.leadTotal) || 0;
  const withPhone = Number(meta?.withPhone) || 0;
  const sent = Number(meta?.sentCount) || 0;
  const withoutPhone = Math.max(0, total - withPhone);
  const replies = Number(campaign?.seenCount) || 0;
  const state = String(campaign?.state ?? '—');
  const name = String(campaign?.name ?? 'Campaign');
  const id = String(campaign?.id ?? '—');
  const created = campaign?.createdAt ? formatWhen(campaign.createdAt) : '—';
  const updated = campaign?.updatedAt ? formatWhen(campaign.updatedAt) : '—';
  const ends = campaign?.endsAt ? formatWhen(campaign.endsAt) : '—';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-analytics-title"
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="campaign-analytics-title" className="text-lg font-semibold text-slate-900 truncate">
              {name}
            </h3>
            <p className="mt-1 text-xs text-slate-500 font-mono">ID: {id}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-xl p-2 text-slate-500 hover:bg-white/80 hover:text-slate-800"
            aria-label="Close analytics"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-88px)]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Send progress</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{pct}%</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Sent</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{sent}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">State</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{state}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Total leads</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">With phone</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{withPhone}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">No phone</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{withoutPhone}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Replies seen</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{replies}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 col-span-2 sm:col-span-2">
              <div className="text-xs text-slate-500">Schedule</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{meta?.scheduleLine ?? '—'}</div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Message template</div>
            <p className="mt-2 text-sm text-slate-900 whitespace-pre-wrap break-words">
              {meta?.templatePreview ?? '—'}
            </p>
            {meta?.templateSubtitle ? (
              <p className="mt-1 text-xs text-slate-500">{meta.templateSubtitle}</p>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Created</div>
              <div className="mt-1 text-sm font-medium text-slate-900 tabular-nums">{created}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Updated</div>
              <div className="mt-1 text-sm font-medium text-slate-900 tabular-nums">{updated}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Campaign window end</div>
              <div className="mt-1 text-sm font-medium text-slate-900 tabular-nums">{ends}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewCampaignWizard({
  open,
  onClose,
  savedLeads,
  categories,
  messages,
  onCreated,
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [startMode, setStartMode] = useState('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedCats, setSelectedCats] = useState([]);
  const [selectedPhrases, setSelectedPhrases] = useState([]);
  const [messageId, setMessageId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName('');
    setStartMode('draft');
    setScheduledAt('');
    setSelectedCats([]);
    setSelectedPhrases([]);
    setMessageId('');
    setSaving(false);
    setError('');
  }, [open]);

  const phraseOptions = useMemo(() => {
    const s = new Set();
    for (const l of savedLeads) {
      const p = String(l.searchPhrase ?? '').trim();
      if (p) s.add(p);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [savedLeads]);

  const filteredLeads = useMemo(
    () => filterLeads(savedLeads, selectedCats, selectedPhrases),
    [savedLeads, selectedCats, selectedPhrases]
  );

  function toggleCat(c) {
    setSelectedCats((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function togglePhrase(p) {
    setSelectedPhrases((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function canGoNextFromStep1() {
    if (!name.trim()) return false;
    if (startMode === 'scheduled' && !scheduledAt.trim()) return false;
    return true;
  }

  async function handleSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }
    if (startMode === 'scheduled' && !scheduledAt.trim()) {
      setError('Pick a start date and time');
      return;
    }
    if (!messageId) {
      setError('Select a message');
      return;
    }
    if (filteredLeads.length === 0) {
      setError('No leads match your filters — adjust categories or phrases');
      return;
    }

    setSaving(true);
    try {
      await createCampaign({
        name: name.trim(),
        startMode,
        scheduledAt:
          startMode === 'scheduled'
            ? new Date(scheduledAt).toISOString()
            : null,
        messageId,
        leads: filteredLeads,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not create campaign';
      setError(typeof msg === 'string' ? msg : 'Could not create campaign');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const steps = ['Details', 'Leads', 'Message'];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-campaign-title"
        className="relative w-full max-w-3xl max-h-[90vh] rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30 px-6 py-5 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="new-campaign-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              New campaign
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Step {step} of 3 — {steps[step - 1]}
            </p>
            <div className="mt-3 flex gap-2">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`h-1.5 flex-1 rounded-full max-w-[72px] ${
                    n <= step ? 'bg-indigo-600' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-white/80 hover:text-slate-800 shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error ? (
            <div className="mb-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Campaign name
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q2 salon outreach"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Start
                </legend>
                <div className="mt-3 space-y-3">
                  {[
                    { id: 'draft', label: 'Draft', hint: 'Save without sending yet' },
                    { id: 'now', label: 'Start now', hint: 'Mark as running immediately' },
                    { id: 'scheduled', label: 'Schedule', hint: 'Pick date and time' },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                        startMode === opt.id
                          ? 'border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="startMode"
                        value={opt.id}
                        checked={startMode === opt.id}
                        onChange={() => setStartMode(opt.id)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{opt.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{opt.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              {startMode === 'scheduled' ? (
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Start date &amp; time
                  </span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="mt-2 w-full max-w-xs rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              <p className="text-sm text-slate-600">
                Narrow saved leads by category and/or search phrase. Leave both empty to include{' '}
                <span className="font-semibold text-slate-800">all</span> saved leads.
              </p>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Categories
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.length === 0 ? (
                    <span className="text-sm text-slate-400">No categories — add some in Settings.</span>
                  ) : (
                    categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCat(c)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                          selectedCats.includes(c)
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {c}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search phrases
                </div>
                <div className="mt-2 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {phraseOptions.length === 0 ? (
                    <span className="text-sm text-slate-400">No phrases found in saved leads.</span>
                  ) : (
                    phraseOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePhrase(p)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors max-w-full truncate ${
                          selectedPhrases.includes(p)
                            ? 'bg-violet-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                        title={p}
                      >
                        {p}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold text-slate-500">Matching leads</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                  {filteredLeads.length}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Choose the message to send to {filteredLeads.length} lead
                {filteredLeads.length === 1 ? '' : 's'}.
              </p>
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                  No messages yet. Create one under <span className="font-semibold">Messages</span> first.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {messages.map((m) => {
                    const selected = messageId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMessageId(m.id)}
                        className={`text-left rounded-2xl border overflow-hidden transition-all duration-200 flex flex-col ${
                          selected
                            ? 'border-indigo-500 ring-2 ring-indigo-400 shadow-md shadow-indigo-900/10'
                            : 'border-slate-200/70 hover:border-indigo-200/60 hover:shadow-md'
                        } bg-gradient-to-b from-white via-white to-slate-50/60`}
                      >
                        {m.imageFile ? (
                          <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100/80">
                            <img
                              src={messageAssetUrl(m.imageFile)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-slate-100/90 to-indigo-50/40">
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                              Text only
                            </span>
                          </div>
                        )}
                        <div className="p-3">
                          <time className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 tabular-nums">
                            {formatWhen(m.createdAt)}
                          </time>
                          {m.text ? (
                            <p className="mt-1 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap line-clamp-4">
                              {m.text}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs italic text-slate-400">No text</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 shrink-0">
          <div className="text-xs text-slate-500">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setStep((s) => Math.max(1, s - 1));
                }}
                className="font-semibold text-indigo-700 hover:text-indigo-900"
              >
                Back
              </button>
            ) : (
              <span />
            )}
          </div>
          <div className="flex gap-2">
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 && !canGoNextFromStep1()}
                onClick={() => {
                  setError('');
                  if (step === 1 && !canGoNextFromStep1()) {
                    setError(
                      startMode === 'scheduled'
                        ? 'Enter a name and schedule date'
                        : 'Enter a campaign name'
                    );
                    return;
                  }
                  if (step === 2 && filteredLeads.length === 0) {
                    setError('Need at least one matching lead — widen filters or save leads first.');
                    return;
                  }
                  setStep((s) => s + 1);
                }}
                className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:pointer-events-none"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || !messageId || messages.length === 0}
                onClick={() => handleSubmit()}
                className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:pointer-events-none"
              >
                {saving ? 'Creating…' : 'Create campaign'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [savedLeads, setSavedLeads] = useState([]);
  const [categories, setCategories] = useState([]);
  const [messages, setMessages] = useState([]);
  const [boardSearch, setBoardSearch] = useState('');
  /** @type {string} '' = all statuses */
  const [boardStatusFilter, setBoardStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [boardActionError, setBoardActionError] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignPage, setCampaignPage] = useState(1);

  const filteredCampaigns = useMemo(
    () =>
      campaigns.filter((c) =>
        campaignMatchesBoardFilters(c, boardSearch, boardStatusFilter)
      ),
    [campaigns, boardSearch, boardStatusFilter]
  );
  const selectedCampaign = useMemo(
    () => campaigns.find((c) => String(c?.id) === String(selectedCampaignId)) ?? null,
    [campaigns, selectedCampaignId]
  );
  const selectedCampaignMeta = useMemo(
    () => (selectedCampaign ? getCampaignCardMeta(selectedCampaign, messages) : null),
    [selectedCampaign, messages]
  );
  const totalCampaignPages = Math.max(1, Math.ceil(filteredCampaigns.length / CAMPAIGNS_PAGE_SIZE));
  useEffect(() => {
    setCampaignPage(1);
  }, [boardSearch, boardStatusFilter, campaigns.length]);
  useEffect(() => {
    setCampaignPage((p) => Math.min(p, totalCampaignPages));
  }, [totalCampaignPages]);
  const safeCampaignPage = Math.min(campaignPage, totalCampaignPages);
  const campaignOffset = (safeCampaignPage - 1) * CAMPAIGNS_PAGE_SIZE;
  const pagedCampaigns = filteredCampaigns.slice(
    campaignOffset,
    campaignOffset + CAMPAIGNS_PAGE_SIZE
  );

  function clearBoardFilters() {
    setBoardSearch('');
    setBoardStatusFilter('');
  }

  const hasBoardFilters =
    boardSearch.trim().length > 0 || Boolean(boardStatusFilter.trim());

  const loadCampaigns = useCallback(async () => {
    setListError('');
    setLoading(true);
    try {
      const data = await getCampaigns();
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch (err) {
      setListError(
        typeof err?.message === 'string' ? err.message : 'Could not load campaigns'
      );
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadCampaignsQuiet = useCallback(async () => {
    try {
      const data = await getCampaigns();
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch {
      /* keep existing list; avoid flashing errors during background poll */
    }
  }, []);

  const handlePauseCampaign = useCallback(
    async (id) => {
      setBusyId(id);
      setBoardActionError('');
      try {
        await patchCampaignAction(id, 'pause');
        await loadCampaigns();
      } catch (err) {
        const msg =
          err?.data?.error ||
          (typeof err?.message === 'string' ? err.message : null) ||
          'Could not pause campaign';
        setBoardActionError(typeof msg === 'string' ? msg : 'Could not pause campaign');
      } finally {
        setBusyId(null);
      }
    },
    [loadCampaigns]
  );

  const handleStartCampaign = useCallback(
    async (id) => {
      setBusyId(id);
      setBoardActionError('');
      try {
        await patchCampaignAction(id, 'start');
        await loadCampaigns();
      } catch (err) {
        const msg =
          err?.data?.error ||
          (typeof err?.message === 'string' ? err.message : null) ||
          'Could not start campaign';
        setBoardActionError(typeof msg === 'string' ? msg : 'Could not start campaign');
      } finally {
        setBusyId(null);
      }
    },
    [loadCampaigns]
  );

  const handleDeleteCampaign = useCallback(
    async (c) => {
      const id = c?.id;
      const name = String(c?.name ?? 'this campaign');
      if (!id) return;
      if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
      setBusyId(id);
      setBoardActionError('');
      try {
        await deleteCampaign(id);
        await loadCampaigns();
      } catch (err) {
        const msg =
          err?.data?.error ||
          (typeof err?.message === 'string' ? err.message : null) ||
          'Could not delete campaign';
        setBoardActionError(typeof msg === 'string' ? msg : 'Could not delete campaign');
      } finally {
        setBusyId(null);
      }
    },
    [loadCampaigns]
  );

  const loadWizardData = useCallback(async () => {
    try {
      const [leadsRes, catRes, msgRes] = await Promise.all([
        getSavedLeads(),
        getCategories(),
        getMessages(),
      ]);
      setSavedLeads(Array.isArray(leadsRes.leads) ? leadsRes.leads : []);
      setCategories(Array.isArray(catRes.categories) ? catRes.categories : []);
      setMessages(Array.isArray(msgRes.messages) ? msgRes.messages : []);
    } catch {
      setSavedLeads([]);
      setCategories([]);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    const hasRunning = campaigns.some(
      (c) => String(c?.state ?? '').toLowerCase() === 'running'
    );
    if (!hasRunning) return undefined;
    const intervalMs = 12000;
    const id = window.setInterval(() => {
      reloadCampaignsQuiet();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [campaigns, reloadCampaignsQuiet]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMessages();
        if (!cancelled) setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (wizardOpen) loadWizardData();
  }, [wizardOpen, loadWizardData]);

  return (
    <SectionPage
      title="Campaigns"
      description="Build, schedule, and monitor outreach campaigns with a premium overview."
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Campaign board</div>
          <div className="text-xs text-gray-500 mt-1">Live from the server · sample rows ship on first run</div>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New campaign
        </button>
      </div>

      <div className="mt-5 relative rounded-3xl bg-gradient-to-br from-slate-100/90 via-white to-indigo-50/40 p-[1px] shadow-[0_20px_40px_-12px_rgba(15,23,42,0.1)]">
        <div className="rounded-[calc(1.5rem-1px)] bg-white/95 ring-1 ring-slate-200/60 overflow-hidden">
          {listError ? (
            <div className="px-6 py-5 text-sm font-medium text-red-600 bg-red-50/40">{listError}</div>
          ) : loading ? (
            <div className="px-6 py-16 text-center">
              <div className="inline-flex h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              <p className="mt-3 text-sm text-slate-500">Loading campaigns…</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              No campaigns yet. Use <span className="font-semibold text-slate-700">New campaign</span> to
              create one.
            </div>
          ) : (
            <>
              {boardActionError ? (
                <div className="px-6 py-3 text-sm text-red-700 bg-red-50/80 border-b border-red-100 flex items-start justify-between gap-3">
                  <span>{boardActionError}</span>
                  <button
                    type="button"
                    onClick={() => setBoardActionError('')}
                    className="shrink-0 text-xs font-semibold text-red-800 underline underline-offset-2"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200/70 bg-slate-50/40">
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="campaign-board-search"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Filter campaigns
                    </label>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Search and choose a status, or leave status on &ldquo;All statuses&rdquo;.
                    </p>
                    <div className="mt-2 flex flex-wrap items-stretch gap-2">
                      <div className="relative min-w-[min(100%,12rem)] flex-1 max-w-xl">
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
                          id="campaign-board-search"
                          type="search"
                          value={boardSearch}
                          onChange={(e) => setBoardSearch(e.target.value)}
                          placeholder="Search by name, state, start mode…"
                          autoComplete="off"
                          className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                      <div className="flex w-full min-w-[10.5rem] shrink-0 sm:w-auto">
                        <label htmlFor="campaign-status-filter" className="sr-only">
                          Filter by status
                        </label>
                        <select
                          id="campaign-status-filter"
                          value={boardStatusFilter}
                          onChange={(e) => setBoardStatusFilter(e.target.value)}
                          className="min-h-[42px] w-full cursor-pointer rounded-2xl border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm font-medium text-slate-900 shadow-sm outline-none hover:border-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 appearance-none bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat"
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                          }}
                        >
                          <option value="">All statuses</option>
                          {CAMPAIGN_STATE_FILTERS.map(({ id, label }) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {hasBoardFilters ? (
                        <button
                          type="button"
                          onClick={clearBoardFilters}
                          className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Showing{' '}
                    <span className="font-semibold tabular-nums text-slate-800">
                      {filteredCampaigns.length}
                    </span>{' '}
                    of{' '}
                    <span className="font-semibold tabular-nums text-slate-800">
                      {campaigns.length}
                    </span>
                    {hasBoardFilters ? ' matching' : ''}
                  </p>
                </div>
              </div>

              {filteredCampaigns.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-slate-600">
                  No campaigns match your filters.{' '}
                  <button
                    type="button"
                    onClick={clearBoardFilters}
                    className="font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="p-5 sm:p-6 pt-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {pagedCampaigns.map((c) => (
                      <CampaignCard
                        key={c.id}
                        campaign={c}
                        meta={getCampaignCardMeta(c, messages)}
                        busy={busyId === c.id}
                        onOpenAnalytics={() => setSelectedCampaignId(String(c.id))}
                        onPause={() => handlePauseCampaign(c.id)}
                        onStart={() => handleStartCampaign(c.id)}
                        onDelete={() => handleDeleteCampaign(c)}
                      />
                    ))}
                  </div>
                  <PaginationControls
                    page={safeCampaignPage}
                    totalPages={totalCampaignPages}
                    pageSizeLabel={`${CAMPAIGNS_PAGE_SIZE} per page`}
                    className="mt-4"
                    onPrev={() => setCampaignPage((p) => Math.max(1, p - 1))}
                    onNext={() => setCampaignPage((p) => Math.min(totalCampaignPages, p + 1))}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <NewCampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        savedLeads={savedLeads}
        categories={categories}
        messages={messages}
        onCreated={loadCampaigns}
      />
      <CampaignAnalyticsModal
        open={Boolean(selectedCampaign)}
        campaign={selectedCampaign}
        meta={selectedCampaignMeta}
        onClose={() => setSelectedCampaignId('')}
      />
    </SectionPage>
  );
}
