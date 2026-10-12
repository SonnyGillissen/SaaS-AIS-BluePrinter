/**
 * AIS BluePrinter - sign-in redirect page (azure-callback.html).
 *
 * Microsoft redirects the sign-in popup here. This script hands the response (authorization
 * code and state, in the URL fragment) to the app window on the same origin and closes the
 * popup. The code is useless without the PKCE verifier that only the app window holds.
 */
(function () {
  'use strict';

  var CHANNEL = 'aisbp-azure-auth';
  var data = { type: CHANNEL, search: window.location.search, hash: window.location.hash };
  try {
    if (typeof BroadcastChannel === 'function') {
      var channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(data);
      channel.close();
    }
  } catch (e) { /* ignore */ }
  try {
    if (window.opener && window.opener !== window) window.opener.postMessage(data, window.location.origin);
  } catch (e) { /* ignore */ }
  // Remove the code from the address bar and history of this window.
  try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
  setTimeout(function () { window.close(); }, 300);
})();
