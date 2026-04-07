import { useCallback, useEffect, useMemo, useState } from 'react';
import SectionPage from './SectionPage';
import {
  createMessage,
  deleteMessage,
  getMessages,
  messageAssetUrl,
  updateMessage,
} from '../api';
import PaginationControls from '../components/PaginationControls';
const MESSAGES_PAGE_SIZE = 6;

function fileToBase64Payload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Read failed'));
        return;
      }
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error('Invalid image'));
        return;
      }
      resolve({ imageMime: match[1], imageBase64: match[2] });
    };
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

function MessageEditorModal({
  open,
  onClose,
  message,
  onSave,
  saving,
  error,
  onClearError,
  onSaveError,
}) {
  const isEdit = Boolean(message?.id);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [removeImageRequested, setRemoveImageRequested] = useState(false);

  useEffect(() => {
    if (!open) return;
    onClearError?.();
    if (message?.id) {
      setText(message.text ?? '');
      setFile(null);
      setRemoveImageRequested(false);
    } else {
      setText('');
      setFile(null);
      setRemoveImageRequested(false);
    }
  }, [open, message?.id, onClearError]);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!open) return null;

  const keepsImage =
    Boolean(message?.imageFile) && !removeImageRequested && !file;
  const canSubmit = Boolean(text.trim()) || Boolean(file) || keepsImage;

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
        aria-labelledby="message-editor-title"
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30 px-6 py-5 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2
              id="message-editor-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              {isEdit ? 'Edit message' : 'Add message'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Stored in <code className="text-[10px] font-medium">data/messages.json</code>
              {', '}
              images in <code className="text-[10px] font-medium">data/assets/</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-white/80 hover:text-slate-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0"
          onSubmit={async (e) => {
            e.preventDefault();
            onClearError?.();
            if (!canSubmit) return;

            let imageBase64 = null;
            let imageMime = '';
            if (file) {
              try {
                const p = await fileToBase64Payload(file);
                imageBase64 = p.imageBase64;
                imageMime = p.imageMime;
              } catch {
                onSaveError?.('Could not read image file');
                return;
              }
            }

            if (isEdit) {
              await onSave({
                id: message.id,
                text: text.trim(),
                imageBase64,
                imageMime,
                removeImage: removeImageRequested && !file,
              });
            } else {
              await onSave({
                text: text.trim(),
                imageBase64,
                imageMime,
              });
            }
          }}
        >
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Message</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Write something…"
              className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200/80 focus:border-indigo-200"
            />
          </label>

          <div>
            <span className="text-xs font-semibold text-slate-700">Image (optional)</span>

            {isEdit &&
            message.imageFile &&
            !file &&
            !removeImageRequested ? (
              <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
                <img
                  src={messageAssetUrl(message.imageFile)}
                  alt=""
                  className="max-h-40 w-full rounded-xl object-contain"
                />
                <button
                  type="button"
                  onClick={() => setRemoveImageRequested(true)}
                  className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Remove image
                </button>
              </div>
            ) : null}

            {isEdit && removeImageRequested && !file ? (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50/80 rounded-xl px-3 py-2 border border-amber-100">
                Image will be removed when you save.{' '}
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={() => setRemoveImageRequested(false)}
                >
                  Undo
                </button>
              </p>
            ) : null}

            <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 px-4 py-8 transition hover:border-indigo-200 hover:bg-indigo-50/20">
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFile(f ?? null);
                  if (f) setRemoveImageRequested(false);
                }}
              />
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  className="max-h-40 rounded-xl object-contain shadow-sm ring-1 ring-slate-200/80"
                />
              ) : (
                <p className="text-sm text-slate-500 text-center">
                  {isEdit ? 'Replace with a new image (optional)' : 'Click to choose JPEG, PNG, GIF, or WebP (max 6MB)'}
                </p>
              )}
            </label>
            {file ? (
              <button
                type="button"
                onClick={() => setFile(null)}
                className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Clear new image
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm font-medium text-red-600">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewMessageModal({ open, message, onClose }) {
  if (!open || !message) return null;

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
        aria-labelledby="view-message-title"
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3 shrink-0">
          <h2 id="view-message-title" className="text-lg font-semibold text-slate-900">
            Message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4">
          <time className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 tabular-nums block">
            {formatWhen(message.createdAt)}
          </time>
          {message.imageFile ? (
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
              <img
                src={messageAssetUrl(message.imageFile)}
                alt=""
                className="w-full max-h-[50vh] object-contain"
              />
            </div>
          ) : null}
          {message.text ? (
            <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">{message.text}</p>
          ) : (
            <p className="text-sm italic text-slate-400">No text</p>
          )}
        </div>
        <div className="border-t border-slate-100 px-6 py-4 flex justify-end shrink-0 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteMessageModal({ open, message, onClose, onConfirm, deleting }) {
  if (!open || !message) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" aria-hidden />
      <div
        role="alertdialog"
        aria-labelledby="delete-message-title"
        aria-describedby="delete-message-desc"
        className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)] p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="delete-message-title" className="text-lg font-semibold text-slate-900">
          Delete message?
        </h2>
        <p id="delete-message-desc" className="mt-2 text-sm text-slate-600">
          This removes the message from <code className="text-xs">messages.json</code> and deletes its image file
          from the server if present. This cannot be undone.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Compact stamp for card chrome */
function formatCardStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normMsgField(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim();
}

/** Every whitespace-separated token must appear in body text, id, dates, or type hints. */
function messageMatchesQuery(m, rawQuery) {
  const q = normMsgField(rawQuery);
  if (!q) return true;
  const dateStr = formatWhen(m.createdAt);
  const iso = String(m.createdAt ?? '');
  const hay = normMsgField(
    [
      m.text,
      m.id,
      iso,
      dateStr,
      m.imageFile ? 'image photo media attachment' : 'text',
    ].join(' ')
  );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

function ViewIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function PencilIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function TrashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function MessageCard({ m, onView, onEdit, onDelete }) {
  const [idCopied, setIdCopied] = useState(false);
  const hasImage = Boolean(m.imageFile);
  const stamp = formatCardStamp(m.createdAt);
  const idShort = m.id ? String(m.id).replace(/-/g, '').slice(0, 8) : '';

  async function handleCopyId() {
    if (!m.id || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(m.id));
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <article
      className={[
        'group relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl',
        'border border-gray-100 bg-white',
        'shadow-sm ring-1 ring-black/[0.03]',
        'transition duration-200',
        'hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:ring-indigo-100/50',
      ].join(' ')}
    >
      {/* Card chrome */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-50 bg-gray-50/80 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              hasImage
                ? 'bg-indigo-100 text-indigo-800'
                : 'bg-slate-200/80 text-slate-700'
            }`}
          >
            {hasImage ? 'Image' : 'Text'}
          </span>
          {stamp ? (
            <time
              dateTime={m.createdAt ? String(m.createdAt) : undefined}
              className="truncate text-[11px] font-medium tabular-nums text-gray-500"
            >
              {stamp}
            </time>
          ) : null}
        </div>
        {idShort ? (
          <button
            type="button"
            onClick={handleCopyId}
            title="Copy full message ID"
            className="shrink-0 rounded-lg border border-transparent px-2 py-1 text-[10px] font-mono font-semibold uppercase tracking-wide text-gray-500 transition hover:border-gray-200 hover:bg-white hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            {idCopied ? 'Copied' : idShort}
          </button>
        ) : null}
      </div>

      {hasImage ? (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-gray-100">
          <img
            src={messageAssetUrl(m.imageFile)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 ease-out group-hover:scale-[1.02]"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-70"
            aria-hidden
          />
        </div>
      ) : (
        <div className="relative flex h-24 shrink-0 items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50/50 px-4">
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="h-8 w-8 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span className="text-xs font-medium text-gray-500">Text-only template</span>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col px-4 pb-0 pt-3 min-h-0">
        <div className="min-h-[3.5rem] flex-1">
          {m.text ? (
            <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap line-clamp-4 text-pretty">
              {m.text}
            </p>
          ) : (
            <p className="text-sm italic text-gray-400">No caption or body text</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex divide-x divide-gray-100 border-t border-gray-100 bg-gray-50/50">
        <button
          type="button"
          onClick={onView}
          className="flex flex-1 flex-col items-center gap-1 py-3 text-gray-600 transition hover:bg-white hover:text-indigo-700 focus:outline-none focus-visible:bg-indigo-50 focus-visible:text-indigo-800"
        >
          <ViewIcon className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-semibold">View</span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-1 flex-col items-center gap-1 py-3 text-gray-600 transition hover:bg-white hover:text-indigo-700 focus:outline-none focus-visible:bg-indigo-50 focus-visible:text-indigo-800"
        >
          <PencilIcon className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-semibold">Edit</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex flex-1 flex-col items-center gap-1 py-3 text-gray-600 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:bg-red-50 focus-visible:text-red-800"
        >
          <TrashIcon className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-semibold">Delete</span>
        </button>
      </div>
    </article>
  );
}

export default function Messages() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewMessage, setViewMessage] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [messagePage, setMessagePage] = useState(1);

  const filteredItems = useMemo(
    () => items.filter((m) => messageMatchesQuery(m, searchQuery)),
    [items, searchQuery]
  );
  const totalMessagePages = Math.max(1, Math.ceil(filteredItems.length / MESSAGES_PAGE_SIZE));
  useEffect(() => {
    setMessagePage(1);
  }, [searchQuery, items.length]);
  useEffect(() => {
    setMessagePage((p) => Math.min(p, totalMessagePages));
  }, [totalMessagePages]);
  const safeMessagePage = Math.min(messagePage, totalMessagePages);
  const messageOffset = (safeMessagePage - 1) * MESSAGES_PAGE_SIZE;
  const pagedMessages = filteredItems.slice(messageOffset, messageOffset + MESSAGES_PAGE_SIZE);

  const load = useCallback(async () => {
    setListError('');
    setLoading(true);
    try {
      const data = await getMessages();
      setItems(Array.isArray(data.messages) ? data.messages : []);
    } catch (err) {
      setListError(
        typeof err?.message === 'string' ? err.message : 'Could not load messages'
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEditorSave(payload) {
    setSaveError('');
    setSaving(true);
    try {
      if (payload.id) {
        await updateMessage({
          id: payload.id,
          text: payload.text,
          imageBase64: payload.imageBase64,
          imageMime: payload.imageMime,
          removeImage: payload.removeImage,
        });
      } else {
        await createMessage({
          text: payload.text,
          imageBase64: payload.imageBase64 || null,
          imageMime: payload.imageMime || '',
        });
      }
      setEditorOpen(false);
      setEditingMessage(null);
      await load();
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not save message';
      setSaveError(typeof msg === 'string' ? msg : 'Could not save message');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget?.id) return;
    const id = deleteTarget.id;
    setDeleting(true);
    try {
      await deleteMessage(id);
      setDeleteTarget(null);
      if (viewMessage?.id === id) {
        setViewOpen(false);
        setViewMessage(null);
      }
      await load();
    } catch (err) {
      const msg =
        err?.data?.error || err?.message || 'Could not delete message';
      setListError(typeof msg === 'string' ? msg : 'Could not delete message');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SectionPage
      title="Messages"
      description="Compose notes with optional images. Everything is stored on the server under data/messages.json and data/assets/."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Card view</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Newest first · click a card header ID to copy the full UUID
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSaveError('');
            setEditingMessage(null);
            setEditorOpen(true);
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add message
        </button>
      </div>

      <div className="mt-5 relative rounded-3xl bg-gradient-to-br from-slate-100/90 via-white to-indigo-50/40 p-[1px] shadow-[0_20px_40px_-12px_rgba(15,23,42,0.1)]">
        <div className="rounded-[calc(1.5rem-1px)] bg-white/95 ring-1 ring-slate-200/60 overflow-hidden">
          {listError ? (
            <div className="px-6 py-5 text-sm font-medium text-red-600 bg-red-50/40">
              {listError}
            </div>
          ) : loading ? (
            <div className="px-6 py-16 text-center">
              <div className="inline-flex h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              <p className="mt-3 text-sm text-slate-500">Loading messages…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              No messages yet. Use <span className="font-semibold text-slate-700">Add message</span> to create one.
            </div>
          ) : (
            <>
              <div className="px-5 sm:px-7 pt-5 pb-4 border-b border-slate-200/70 bg-slate-50/40">
                <label
                  htmlFor="messages-search"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Search messages
                </label>
                <div className="mt-2 flex flex-wrap items-stretch gap-2">
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
                      id="messages-search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Text, date, id, image or text-only…"
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
                <p className="mt-2 text-xs text-slate-500">
                  Showing{' '}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {filteredItems.length}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {items.length}
                  </span>
                  {searchQuery.trim() ? ' matching' : ''}
                </p>
              </div>

              {filteredItems.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-slate-600">
                  No messages match{' '}
                  <span className="font-semibold text-slate-800">
                    &ldquo;{searchQuery.trim()}&rdquo;
                  </span>
                  .{' '}
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="p-5 sm:p-7 pt-5">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-5 lg:gap-6 xl:grid-cols-3">
                    {pagedMessages.map((m) => (
                      <MessageCard
                        key={m.id}
                        m={m}
                        onView={() => {
                          setViewMessage(m);
                          setViewOpen(true);
                        }}
                        onEdit={() => {
                          setSaveError('');
                          setEditingMessage(m);
                          setEditorOpen(true);
                        }}
                        onDelete={() => setDeleteTarget(m)}
                      />
                    ))}
                  </div>
                  <PaginationControls
                    page={safeMessagePage}
                    totalPages={totalMessagePages}
                    pageSizeLabel={`${MESSAGES_PAGE_SIZE} per page`}
                    className="mt-4"
                    onPrev={() => setMessagePage((p) => Math.max(1, p - 1))}
                    onNext={() => setMessagePage((p) => Math.min(totalMessagePages, p + 1))}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MessageEditorModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingMessage(null);
          setSaveError('');
        }}
        message={editingMessage}
        onSave={handleEditorSave}
        saving={saving}
        error={saveError}
        onClearError={() => setSaveError('')}
        onSaveError={(msg) => setSaveError(msg)}
      />

      <ViewMessageModal
        open={viewOpen}
        message={viewMessage}
        onClose={() => {
          setViewOpen(false);
          setViewMessage(null);
        }}
      />

      <DeleteMessageModal
        open={Boolean(deleteTarget)}
        message={deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </SectionPage>
  );
}
