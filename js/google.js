/**
 * Google integration: sign-in (Google Identity Services), the file picker,
 * and an authenticated fetch wrapper for Google REST APIs.
 *
 * Auth model: drive.file scope — the app can only touch spreadsheets it
 * created or that the user explicitly picked in the Google picker.
 */

import { GOOGLE_CLIENT_ID, GOOGLE_API_KEY, GOOGLE_APP_ID } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY);
}

/** Thrown when a call needs the user to go through interactive sign-in. */
export class NeedsSignIn extends Error {
  constructor() { super('Sign-in required'); this.name = 'NeedsSignIn'; }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

let tokenClient = null;
let token = null; // { accessToken, expiresAt }

async function ensureGis() {
  await loadScript('https://accounts.google.com/gsi/client');
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: () => {}, // replaced per request
    });
  }
}

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      token = {
        accessToken: resp.access_token,
        // refresh a minute before Google expires it
        expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000,
      };
      resolve(token.accessToken);
    };
    tokenClient.error_callback = (err) =>
      reject(new Error(err && err.type ? err.type : 'Sign-in failed'));
    tokenClient.requestAccessToken({ prompt });
  });
}

/** Try to get a token without user interaction. Returns null if not possible. */
export async function signInSilent() {
  await ensureGis();
  try {
    return await requestToken('');
  } catch {
    return null;
  }
}

/** Interactive sign-in — call from a click handler. */
export async function signIn() {
  await ensureGis();
  return requestToken('');
}

export function signOut() {
  if (token) google.accounts.oauth2.revoke(token.accessToken, () => {});
  token = null;
}

async function ensureToken() {
  if (token && Date.now() < token.expiresAt) return token.accessToken;
  const t = await signInSilent();
  if (!t) throw new NeedsSignIn();
  return t;
}

/** Email of the signed-in user (for the log's "logged by" column). */
export async function fetchUserEmail() {
  try {
    const info = await apiFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    return info.email || '';
  } catch {
    return '';
  }
}

/**
 * Authenticated fetch for Google REST APIs. Retries once on 401 (expired
 * token) and turns API errors into readable messages.
 */
export async function apiFetch(url, options = {}, isRetry = false) {
  const accessToken = await ensureToken();
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (resp.status === 401 && !isRetry) {
    token = null;
    return apiFetch(url, options, true);
  }
  if (!resp.ok) {
    let message = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      if (body.error && body.error.message) message = body.error.message;
    } catch { /* keep the status text */ }
    if (resp.status === 403) {
      message = "You don't have access to this spreadsheet. " +
        'Ask the owner to share it with you, then pick it again.';
    }
    throw new Error(message);
  }
  return resp.json();
}

/**
 * Open the Google picker on the user's spreadsheets. Picking a file is what
 * grants this app access to it under the drive.file scope.
 * Resolves with the spreadsheet ID, or null if the user cancelled.
 */
export async function pickSpreadsheet() {
  const accessToken = await ensureToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => gapi.load('picker', resolve));
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false);
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_APP_ID)
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(data.docs[0].id);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
