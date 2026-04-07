import { apiFetch } from './api';

const AUTH_KEY = 'ai_pulse_auth';

export function isAuthenticated() {
  try {
    return Boolean(window.localStorage.getItem(AUTH_KEY));
  } catch {
    return false;
  }
}

export function login() {
  try {
    window.localStorage.setItem(AUTH_KEY, '1');
  } catch {
    // If localStorage is blocked, the UI will still work in-memory, but protected routing won't.
  }
}

export async function loginRequest(username, password) {
  await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  login();
}

export function logout() {
  try {
    window.localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
}

