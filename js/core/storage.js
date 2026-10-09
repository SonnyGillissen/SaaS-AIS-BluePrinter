/**
 * AIS BluePrinter - persistence.
 *
 * By default everything is stored in the browser's localStorage: nothing ever leaves the
 * user's machine. Optionally (see js/config.js) projects can be stored in a MySQL or
 * Microsoft SQL Server database through the small PHP API in /server/php.
 *
 * Both adapters share the same promise-based interface:
 *   list()        -> [{ id, name, modified }]
 *   load(id)      -> project (validated with Model.normalize)
 *   save(project) -> void
 *   remove(id)    -> void
 *
 * localStorage keys:
 *   aisbp.index          JSON array of { id, name, modified }
 *   aisbp.project.<id>   JSON project
 *   aisbp.last           id of the last opened project
 *   aisbp.prefs          user preferences (UI)
 *
 * @module AISBP.Storage
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('./util.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('./model.js') : null);

  const PREFIX = 'aisbp.';
  const INDEX_KEY = PREFIX + 'index';
  const LAST_KEY = PREFIX + 'last';
  const PREFS_KEY = PREFIX + 'prefs';
  const projectKey = (id) => PREFIX + 'project.' + id;

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (e) {
      const err = new Error('Your browser storage is full. Export your blueprints as configuration packages and delete projects you no longer need.');
      err.cause = e;
      throw err;
    }
  }

  /** Validate a stored project (stored data is treated as untrusted as well). */
  function revive(data) {
    return Model.normalize(data).project;
  }

  /**
   * localStorage adapter.
   * @param {Storage} [storage] defaults to window.localStorage (injectable for tests)
   */
  function LocalAdapter(storage) {
    const s = storage || root.localStorage;
    const index = () => {
      const list = readJson(s, INDEX_KEY, []);
      return Array.isArray(list) ? list.filter((e) => e && Util.isValidId(e.id)) : [];
    };
    return {
      kind: 'local',
      label: 'This browser (localStorage)',
      async list() {
        return index().sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
      },
      async load(id) {
        if (!Util.isValidId(id)) throw new Error('Invalid project id.');
        const data = readJson(s, projectKey(id), null);
        if (!data) throw new Error('Project not found.');
        return revive(data);
      },
      async save(project) {
        writeJson(s, projectKey(project.meta.id), project);
        const list = index().filter((e) => e.id !== project.meta.id);
        list.push({ id: project.meta.id, name: project.meta.name, modified: project.meta.modified });
        writeJson(s, INDEX_KEY, list);
      },
      async remove(id) {
        s.removeItem(projectKey(id));
        writeJson(s, INDEX_KEY, index().filter((e) => e.id !== id));
      },
      /** Approximate number of bytes used by AIS BluePrinter in localStorage. */
      usage() {
        let bytes = 0;
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.indexOf(PREFIX) === 0) bytes += (k.length + (s.getItem(k) || '').length) * 2;
        }
        return bytes;
      }
    };
  }

  /**
   * Server adapter (PHP API backed by MySQL or SQL Server).
   * @param {string} apiUrl e.g. 'server/php/api.php'
   * @param {string} [apiKey] optional shared key (sent as X-API-Key header)
   */
  function ApiAdapter(apiUrl, apiKey) {
    const call = async (action, params, body) => {
      const qs = new URLSearchParams(Object.assign({ action }, params || {}));
      const headers = { Accept: 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await root.fetch(apiUrl + (apiUrl.indexOf('?') === -1 ? '?' : '&') + qs.toString(), {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin'
      });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
      if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || 'Server error (HTTP ' + res.status + ').');
      return data;
    };
    return {
      kind: 'server',
      label: 'Database server',
      async list() {
        const data = await call('list');
        return (data.projects || []).filter((e) => e && Util.isValidId(e.id));
      },
      async load(id) {
        const data = await call('load', { id });
        return revive(data.project);
      },
      async save(project) {
        await call('save', { id: project.meta.id }, project);
      },
      async remove(id) {
        await call('delete', { id }, {});
      },
      usage() {
        return 0;
      }
    };
  }

  /** Create the adapter configured in AISBP_CONFIG.storage. */
  function create(config) {
    const c = (config && config.storage) || {};
    if (c.mode === 'server' && c.apiUrl) return ApiAdapter(c.apiUrl, c.apiKey);
    return LocalAdapter();
  }

  function lastProjectId(storage) {
    try {
      return (storage || root.localStorage).getItem(LAST_KEY);
    } catch (e) {
      return null;
    }
  }

  function setLastProjectId(id, storage) {
    try {
      (storage || root.localStorage).setItem(LAST_KEY, id);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Preferences (UI state). Kept per browser, not per project.
  // ---------------------------------------------------------------------------

  function loadPrefs(storage) {
    const p = readJson(storage || root.localStorage, PREFS_KEY, {});
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  }

  function savePrefs(prefs, storage) {
    writeJson(storage || root.localStorage, PREFS_KEY, prefs);
  }

  AISBP.Storage = { LocalAdapter, ApiAdapter, create, lastProjectId, setLastProjectId, loadPrefs, savePrefs, PREFIX };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Storage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
