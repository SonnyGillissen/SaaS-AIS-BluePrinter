/**
 * AIS BluePrinter - sign in with Microsoft Entra ID, in the browser only.
 *
 * Implements the OAuth 2.0 authorization code flow with PKCE for single-page applications
 * against the Microsoft identity platform (v2.0 endpoints), without any library:
 *  1. a popup opens the Microsoft sign-in page with your own app registration (client id),
 *  2. Microsoft redirects the popup to `azure-callback.html` (same origin as the app), which hands
 *     the authorization code back to this window,
 *  3. the code is exchanged for an access token for Azure Resource Manager.
 *
 * The token is kept in memory only (never written to localStorage or a server) and is used by
 * AISBP.AzureArm to read the environment. No client secret is involved.
 *
 * @module AISBP.AzureAuth
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});

  const AUTHORITY = 'https://login.microsoftonline.com/';
  const SCOPE = 'openid profile https://management.azure.com/user_impersonation';
  const CHANNEL = 'aisbp-azure-auth';
  const TIMEOUT_MS = 5 * 60 * 1000;

  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Tenant: a GUID, a domain name, or organizations / common. */
  const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;

  const isClientId = (v) => GUID.test(String(v || '').trim());
  const isTenant = (v) => TENANT.test(String(v || '').trim());

  function base64Url(bytes) {
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return root.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Cryptographically random URL-safe string. */
  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength || 32);
    root.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  /** PKCE S256 code challenge for a verifier. */
  async function codeChallenge(verifier) {
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(digest);
  }

  /** Default redirect URI: azure-callback.html next to the app. */
  function defaultRedirectUri(location) {
    const loc = location || root.location;
    if (!loc || !/^https?:$/.test(loc.protocol)) return '';
    return new URL('azure-callback.html', loc.href.split(/[?#]/)[0]).href;
  }

  /**
   * Authorization URL for the sign-in popup.
   * @param {object} o { tenantId, clientId, redirectUri, state, nonce, challenge, loginHint? }
   */
  function authorizeUrl(o) {
    if (!isClientId(o.clientId)) throw new Error('Enter the application (client) ID of your app registration (a GUID).');
    const tenant = String(o.tenantId || 'organizations').trim();
    if (!isTenant(tenant)) throw new Error('Enter a valid tenant: a tenant ID, a domain name or "organizations".');
    const params = new URLSearchParams({
      client_id: o.clientId.trim(),
      response_type: 'code',
      redirect_uri: o.redirectUri,
      response_mode: 'fragment',
      scope: SCOPE,
      state: o.state,
      nonce: o.nonce,
      code_challenge: o.challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    if (o.loginHint) params.set('login_hint', o.loginHint);
    return AUTHORITY + encodeURIComponent(tenant) + '/oauth2/v2.0/authorize?' + params.toString();
  }

  /** Parameters of the redirect (fragment and query). */
  function parseCallback(search, hash) {
    const out = {};
    [search, hash].forEach((part) => {
      const s = String(part || '').replace(/^[?#]/, '');
      new URLSearchParams(s).forEach((v, k) => { out[k] = v; });
    });
    return out;
  }

  /** Claims of an id_token, for display only (not verified, never used for decisions). */
  function decodeIdToken(token) {
    try {
      const part = String(token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(Array.prototype.map.call(root.atob(part), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) {
      return {};
    }
  }

  /** Exchange the authorization code for tokens. */
  async function exchangeCode(o) {
    const body = new URLSearchParams({
      client_id: o.clientId.trim(),
      grant_type: 'authorization_code',
      code: o.code,
      redirect_uri: o.redirectUri,
      code_verifier: o.verifier,
      scope: SCOPE
    });
    const fetchFn = o.fetch || root.fetch.bind(root);
    const res = await fetchFn(AUTHORITY + encodeURIComponent(String(o.tenantId || 'organizations').trim()) + '/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (!res.ok || !data.access_token) {
      const desc = String(data.error_description || data.error || 'HTTP ' + res.status).split(/\r?\n/)[0];
      const hint = /AADSTS9002326|AADSTS9002327|Cross-origin token redemption/i.test(desc)
        ? ' Register the redirect URI under the "Single-page application" platform of your app registration.'
        : '';
      throw new Error('Sign-in failed: ' + desc + hint);
    }
    const claims = decodeIdToken(data.id_token);
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      account: { name: claims.name || '', username: claims.preferred_username || claims.upn || '', tenantId: claims.tid || '' }
    };
  }

  /**
   * Wait for the redirect to reach the callback page in the popup.
   * `popup.closed` is not treated as cancellation: when the sign-in page sets a
   * Cross-Origin-Opener-Policy, the browser detaches the popup and reports it as closed while
   * the user is still signing in. The callback page then reports back via BroadcastChannel.
   * Cancel with `signal` (AbortSignal) instead.
   */
  function waitForCallback(popup, redirectUri, signal) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let channel = null;
      const onAbort = () => finish(reject, new Error('Sign-in was cancelled.'));
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onAbort);
        root.removeEventListener('message', onMessage);
        if (channel) channel.close();
        try { if (!popup.closed) popup.close(); } catch (e) { /* ignore */ }
        fn(value);
      };
      const accept = (data) => {
        if (data && data.type === CHANNEL) finish(resolve, parseCallback(data.search, data.hash));
      };
      const onMessage = (e) => { if (e.origin === root.location.origin) accept(e.data); };
      root.addEventListener('message', onMessage);
      if (typeof root.BroadcastChannel === 'function') {
        channel = new root.BroadcastChannel(CHANNEL);
        channel.onmessage = (e) => accept(e.data);
      }
      const timer = setInterval(() => {
        try {
          const href = popup.location.href;
          if (href && href.indexOf(redirectUri) === 0 && /[#?&](code|error)=/.test(href)) {
            finish(resolve, parseCallback(popup.location.search, popup.location.hash));
            return;
          }
        } catch (e) {
          /* still on the Microsoft sign-in page (cross-origin) or detached */
        }
      }, 250);
      const timeout = setTimeout(() => finish(reject, new Error('Sign-in timed out.')), TIMEOUT_MS);
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort);
      }
    });
  }

  /**
   * Sign in. Must be called directly from a click handler (the popup is opened synchronously).
   * @param {object} o { clientId, tenantId, redirectUri?, signal?: AbortSignal to cancel }
   * @returns {Promise<{accessToken: string, expiresAt: number, account: object, tenantId: string}>}
   */
  function signIn(o) {
    const redirectUri = o.redirectUri || defaultRedirectUri();
    if (!redirectUri) return Promise.reject(new Error('Signing in requires the app to be served over http(s), e.g. http://localhost:8080 or your hosted instance (not opened from file://).'));
    const tenantId = String(o.tenantId || 'organizations').trim();
    // Validate before opening the popup.
    try {
      authorizeUrl({ clientId: o.clientId, tenantId, redirectUri, state: 'x', nonce: 'x', challenge: 'x' });
    } catch (e) {
      return Promise.reject(e);
    }
    const popup = root.open('', 'aisbp-azure-signin', 'popup=yes,width=520,height=700');
    if (!popup) return Promise.reject(new Error('The sign-in window was blocked. Allow popups for this site and try again.'));
    return (async () => {
      const verifier = randomString(48);
      const state = randomString(16);
      const nonce = randomString(16);
      const challenge = await codeChallenge(verifier);
      popup.location.href = authorizeUrl({ clientId: o.clientId, tenantId, redirectUri, state, nonce, challenge, loginHint: o.loginHint });
      const params = await waitForCallback(popup, redirectUri, o.signal);
      if (params.state !== state) throw new Error('Sign-in failed: the response did not match the request (state).');
      if (params.error) throw new Error('Sign-in failed: ' + String(params.error_description || params.error).split(/\r?\n/)[0]);
      if (!params.code) throw new Error('Sign-in failed: no authorization code was returned.');
      const session = await exchangeCode({ clientId: o.clientId, tenantId, redirectUri, code: params.code, verifier });
      session.tenantId = session.account.tenantId || tenantId;
      return session;
    })().catch((e) => {
      try { if (!popup.closed) popup.close(); } catch (err) { /* ignore */ }
      throw e;
    });
  }

  AISBP.AzureAuth = { AUTHORITY, SCOPE, CHANNEL, isClientId, isTenant, randomString, codeChallenge, defaultRedirectUri, authorizeUrl, parseCallback, decodeIdToken, exchangeCode, signIn };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.AzureAuth;
})(typeof globalThis !== 'undefined' ? globalThis : this);
