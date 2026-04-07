import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import SectionPage from './SectionPage';

function WhatsAppIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function MailIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className={`relative w-full max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl ${
          wide ? 'max-w-lg' : 'max-w-md'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2
            id="integration-modal-title"
            className="text-base font-semibold text-gray-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function whatsappConnected(wa) {
  return wa?.state === 'ready';
}

function qrImageUrl(qrString) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrString)}`;
}

export default function Integration() {
  const [waStatus, setWaStatus] = useState(null);
  const [emailState, setEmailState] = useState({
    connected: false,
    email: '',
    smtp: null,
  });
  const [apiError, setApiError] = useState(null);
  const [modal, setModal] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [waActionLoading, setWaActionLoading] = useState(false);

  const waOk = whatsappConnected(waStatus);

  const refresh = useCallback(async () => {
    try {
      const [wa, em] = await Promise.all([
        apiFetch('/whatsapp/status'),
        apiFetch('/email/status'),
      ]);
      setWaStatus(wa);
      setEmailState({
        connected: Boolean(em?.connected),
        email: String(em?.email || ''),
        smtp: em?.smtp && typeof em.smtp === 'object' ? em.smtp : null,
      });
      setApiError(null);
    } catch {
      setApiError(
        'Cannot reach the backend. Run the server (npm start in /backend, port 369) and keep the frontend proxy or set REACT_APP_API_BASE.'
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      await refresh();
    }
    tick();
    const ms = modal === 'whatsapp' ? 1500 : 4000;
    const id = setInterval(tick, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [modal, refresh]);

  useEffect(() => {
    if (modal !== 'email') return;
    if (emailState.connected && emailState.email) {
      setEmailInput(emailState.email);
    }
    if (!emailState.connected) {
      setEmailInput('');
      setSmtpHost('');
      setSmtpPort('587');
      setSmtpUser('');
      setSmtpPassword('');
      setSmtpSecure(true);
    }
  }, [modal, emailState.connected, emailState.email]);

  const openWhatsApp = useCallback(() => setModal('whatsapp'), []);
  const openEmail = useCallback(() => setModal('email'), []);
  const closeModal = useCallback(() => setModal(null), []);

  const disconnectWhatsApp = useCallback(async () => {
    setWaActionLoading(true);
    try {
      await apiFetch('/whatsapp/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh();
      closeModal();
    } catch {
      setApiError('Logout request failed.');
    } finally {
      setWaActionLoading(false);
    }
  }, [refresh, closeModal]);

  const connectEmail = useCallback(async () => {
    const email = emailInput.trim();
    const host = smtpHost.trim();
    const user = smtpUser.trim();
    const port = Number(smtpPort) || 587;
    if (!email || !host || !user || !smtpPassword) return;
    try {
      await apiFetch('/email/connect', {
        method: 'POST',
        body: JSON.stringify({
          email,
          smtpHost: host,
          smtpPort: port,
          smtpUser: user,
          smtpPassword,
          smtpSecure,
        }),
      });
      await refresh();
      setSmtpPassword('');
      closeModal();
    } catch (e) {
      setApiError(e?.message || 'Email connect failed.');
    }
  }, [
    emailInput,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpSecure,
    refresh,
    closeModal,
  ]);

  const disconnectEmail = useCallback(async () => {
    try {
      await apiFetch('/email/disconnect', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh();
      setEmailInput('');
      setSmtpHost('');
      setSmtpPort('587');
      setSmtpUser('');
      setSmtpPassword('');
      setSmtpSecure(true);
      closeModal();
    } catch (e) {
      setApiError(e?.message || 'Email disconnect failed.');
    }
  }, [refresh, closeModal]);

  const state = waStatus?.state;
  const showQr = state === 'qr' && waStatus?.qr;

  return (
    <SectionPage
      title="Integration"
      description="Connect WhatsApp and email to capture and reply to leads (data from your backend)."
    >
      {apiError ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {apiError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-emerald-50/90 via-teal-50/60 to-white border border-emerald-100/80 rounded-2xl shadow-sm p-6 flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100/80 flex items-center justify-center shrink-0 ring-1 ring-emerald-100">
                <WhatsAppIcon className="w-7 h-7 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-emerald-950">
                  WhatsApp
                </div>
                <div className="text-sm text-emerald-900/55 mt-1">
                  Linked via whatsapp-web.js on the server. Status updates live.
                </div>
              </div>
            </div>
            <span
              className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-xl border ${
                waOk
                  ? 'border-emerald-300/80 bg-emerald-100/90 text-emerald-800'
                  : 'border-emerald-200/70 bg-emerald-50/80 text-emerald-700'
              }`}
            >
              {waOk ? 'Connected' : state ? String(state).replace(/_/g, ' ') : '…'}
            </span>
          </div>
          <div className="mt-6 pt-5 border-t border-emerald-100/70 flex items-center justify-between gap-3">
            <span className="text-xs text-emerald-800/50">
              {waStatus?.info?.wid
                ? `+${String(waStatus.info.wid).replace(/^\+/, '')}`
                : 'WhatsApp Web session'}
            </span>
            <button
              type="button"
              onClick={openWhatsApp}
              className="rounded-2xl bg-emerald-100/90 text-emerald-800 border border-emerald-200/80 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-200/80 shadow-sm"
            >
              {waOk ? 'View' : 'Connect'}
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50/90 via-violet-50/50 to-white border border-indigo-100/80 rounded-2xl shadow-sm p-6 flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-indigo-100/80 flex items-center justify-center shrink-0 ring-1 ring-indigo-100">
                <MailIcon className="w-7 h-7 text-indigo-500" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-indigo-950">
                  Email
                </div>
                <div className="text-sm text-indigo-900/55 mt-1">
                  Mailbox stored on the server for this demo.
                </div>
              </div>
            </div>
            <span
              className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-xl border ${
                emailState.connected
                  ? 'border-indigo-300/80 bg-indigo-100/90 text-indigo-800'
                  : 'border-indigo-200/70 bg-indigo-50/80 text-indigo-700'
              }`}
            >
              {emailState.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="mt-6 pt-5 border-t border-indigo-100/70 flex items-center justify-between gap-3">
            <span className="text-xs text-indigo-800/50 truncate max-w-[55%]">
              {emailState.connected && emailState.smtp?.host
                ? `${emailState.smtp.host}:${emailState.smtp.port || 587}`
                : emailState.connected
                  ? emailState.email
                  : 'SMTP — configure in Connect'}
            </span>
            <button
              type="button"
              onClick={openEmail}
              className="rounded-2xl bg-indigo-100/90 text-indigo-800 border border-indigo-200/80 px-5 py-2.5 text-sm font-semibold hover:bg-indigo-200/80 shadow-sm shrink-0"
            >
              {emailState.connected ? 'View' : 'Connect'}
            </button>
          </div>
        </div>
      </div>

      {modal === 'whatsapp' ? (
        <Modal
          title={waOk ? 'WhatsApp — connected' : 'Connect WhatsApp'}
          onClose={closeModal}
        >
          {!waOk ? (
            <div className="space-y-4 text-center">
              {state === 'initializing' ? (
                <p className="text-sm text-gray-600">Starting WhatsApp session…</p>
              ) : null}
              {state === 'authenticated' ? (
                <p className="text-sm text-gray-600">
                  Authenticating… keep this window open.
                </p>
              ) : null}
              {state === 'auth_failure' ? (
                <p className="text-sm text-rose-600">
                  Auth failed: {waStatus?.message || 'Unknown error'}
                </p>
              ) : null}
              {state === 'init_error' ? (
                <p className="text-sm text-rose-600">
                  Init error: {waStatus?.message || 'Check server logs'}
                </p>
              ) : null}
              {state === 'disconnected' ? (
                <p className="text-sm text-gray-600">
                  Disconnected{waStatus?.reason ? `: ${waStatus.reason}` : ''}.
                  Restart the backend or wait for a new QR from the server.
                </p>
              ) : null}

              {showQr ? (
                <>
                  <p className="text-sm text-gray-600">
                    Open WhatsApp on your phone → Linked devices → Link a device,
                    then scan this code.
                  </p>
                  <div className="flex justify-center">
                    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                      <img
                        src={qrImageUrl(waStatus.qr)}
                        alt="WhatsApp QR code from server"
                        width={220}
                        height={220}
                        className="mx-auto"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    QR refreshes on the server; this dialog polls every few seconds.
                  </p>
                </>
              ) : null}

              {!showQr &&
              state !== 'initializing' &&
              state !== 'authenticated' &&
              state !== 'auth_failure' &&
              state !== 'init_error' &&
              state !== 'disconnected' ? (
                <p className="text-sm text-gray-600">
                  Current status:{' '}
                  <span className="font-semibold">
                    {state ? String(state).replace(/_/g, ' ') : 'unknown'}
                  </span>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-emerald-800/70">
                    Display name
                  </div>
                  <div className="text-sm font-semibold text-gray-900 mt-0.5">
                    {waStatus?.info?.pushname || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-emerald-800/70">
                    Number (wid user)
                  </div>
                  <div className="text-sm font-semibold text-gray-900 mt-0.5">
                    {waStatus?.info?.wid
                      ? `+${String(waStatus.info.wid).replace(/^\+/, '')}`
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-emerald-800/70">
                    Platform
                  </div>
                  <div className="text-sm font-mono text-gray-900 mt-0.5">
                    {waStatus?.info?.platform || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Active
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={waActionLoading}
                onClick={disconnectWhatsApp}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {waActionLoading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          )}
        </Modal>
      ) : null}

      {modal === 'email' ? (
        <Modal
          wide
          title={
            emailState.connected ? 'Email — connected' : 'Connect email (SMTP)'
          }
          onClose={closeModal}
        >
          {!emailState.connected ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter your mailbox and SMTP settings. The password is kept on
                the server and is not returned to the browser after saving.
              </p>
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">
                  From email
                </span>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-gray-700">
                    SMTP host
                  </span>
                  <input
                    type="text"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="smtp.gmail.com"
                    autoComplete="off"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-700">
                    Port
                  </span>
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="587"
                    min={1}
                    max={65535}
                  />
                </label>
                <label className="flex items-end pb-1">
                  <span className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-200"
                    />
                    TLS / STARTTLS
                  </span>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">
                  SMTP username
                </span>
                <input
                  type="text"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="Often the same as your email"
                  autoComplete="username"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">
                  SMTP password
                </span>
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="App password if using Gmail"
                  autoComplete="new-password"
                />
              </label>
              <button
                type="button"
                onClick={connectEmail}
                className="w-full rounded-2xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                Save & connect
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-indigo-800/70">
                    From email
                  </div>
                  <div className="text-sm font-semibold text-gray-900 mt-1 break-all">
                    {emailState.email}
                  </div>
                </div>
                {emailState.smtp ? (
                  <>
                    <div>
                      <div className="text-xs font-semibold text-indigo-800/70">
                        SMTP server
                      </div>
                      <div className="text-sm font-mono text-gray-900 mt-1">
                        {emailState.smtp.host}:{emailState.smtp.port}
                        {emailState.smtp.secure ? ' (TLS)' : ' (plain)'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-indigo-800/70">
                        SMTP user
                      </div>
                      <div className="text-sm font-semibold text-gray-900 mt-1 break-all">
                        {emailState.smtp.user}
                      </div>
                    </div>
                  </>
                ) : null}
                <div>
                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                    Password stored on server only
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={disconnectEmail}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Disconnect
              </button>
            </div>
          )}
        </Modal>
      ) : null}
    </SectionPage>
  );
}
