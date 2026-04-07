import { API_BASE_URL } from './config';

const API_BASE = String(API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

export async function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  const headers = { ...options.headers };
  if (
    options.body != null &&
    typeof options.body === 'string' &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function searchPlacesLeads({ q, gl }) {
  return apiFetch('/search/places', {
    method: 'POST',
    body: JSON.stringify({ q, gl }),
  });
}

export function getLastSearch() {
  return apiFetch('/search/last');
}

export function getProfile() {
  return apiFetch('/profile');
}

export function saveProfile({ name, email, organization }) {
  return apiFetch('/profile', {
    method: 'POST',
    body: JSON.stringify({ name, email, organization }),
  });
}

export function getCategories() {
  return apiFetch('/categories');
}

export function addCategory({ name }) {
  return apiFetch('/categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getSavedLeads() {
  return apiFetch('/saved-leads');
}

export function getLeadsStats() {
  return apiFetch('/leads/stats');
}

export function getAnalyticsOverview() {
  return apiFetch('/analytics/overview');
}

export function getMessages() {
  return apiFetch('/messages');
}

export function createMessage({ text, imageBase64, imageMime }) {
  return apiFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({
      text: text ?? '',
      imageBase64: imageBase64 ?? null,
      imageMime: imageMime ?? '',
    }),
  });
}

export function updateMessage({ id, text, imageBase64, imageMime, removeImage }) {
  return apiFetch('/messages', {
    method: 'PUT',
    body: JSON.stringify({
      id,
      text: text ?? '',
      imageBase64: imageBase64 ?? null,
      imageMime: imageMime ?? '',
      removeImage: Boolean(removeImage),
    }),
  });
}

export function deleteMessage(id) {
  return apiFetch(`/messages?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function messageAssetUrl(filename) {
  if (!filename) return '';
  return `${apiUrl('/messages/asset')}?f=${encodeURIComponent(filename)}`;
}

export function saveLeads({ category, searchPhrase, country, leads }) {
  return apiFetch('/saved-leads', {
    method: 'POST',
    body: JSON.stringify({ category, searchPhrase, country, leads }),
  });
}

export function getCampaigns() {
  return apiFetch('/campaigns');
}

export function createCampaign({
  name,
  startMode,
  scheduledAt,
  messageId,
  leads,
}) {
  return apiFetch('/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name,
      startMode,
      scheduledAt: scheduledAt ?? null,
      messageId,
      leads,
    }),
  });
}

/** @param {'pause' | 'start'} action */
export function patchCampaignAction(campaignId, action) {
  return apiFetch(`/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

export function deleteCampaign(campaignId) {
  return apiFetch(`/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'DELETE',
  });
}

export function getRailStats() {
  return apiFetch('/dashboard/rail-stats');
}

/** Queues background WhatsApp send with server-side pacing (202 Accepted). */
export function queueCampaignWhatsAppSend(campaignId) {
  return apiFetch(
    `/campaigns/${encodeURIComponent(campaignId)}/send-whatsapp`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}
