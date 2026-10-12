/**
 * AIS BluePrinter - configuration package (JSON) export and import.
 *
 * A configuration package is the complete blueprint (hierarchy, resources, attributes,
 * connections, naming conventions and diagram options) as a single, human-readable JSON
 * document. JSON was chosen because it is an open standard, diff-able in source control and
 * natively supported by every platform and by the browser.
 *
 * @module AISBP.Package
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('../core/model.js') : null);

  const APP_VERSION = '1.1.0';
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

  /**
   * Serialize a project to a configuration package (pretty-printed JSON string).
   */
  function toJson(project) {
    const pkg = Util.clone(project);
    pkg.package = { generator: 'AIS BluePrinter', generatorVersion: APP_VERSION, exported: Util.now(), schema: 'https://github.com/SonnyGillissen/SaaS-AIS-BluePrinter/wiki/Configuration-Package' };
    return JSON.stringify(pkg, null, 2);
  }

  /**
   * Parse and validate a configuration package.
   * @param {string} text JSON text
   * @returns {{project: object, warnings: string[]}}
   * @throws {Error} with a user friendly message when the package is invalid.
   */
  function fromJson(text) {
    if (typeof text !== 'string') throw new Error('Nothing to import.');
    if (text.length > MAX_IMPORT_BYTES) throw new Error('The file is too large to import.');
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('The file is not valid JSON: ' + e.message);
    }
    return Model.normalize(data);
  }

  AISBP.Package = { APP_VERSION, toJson, fromJson };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Package;
})(typeof globalThis !== 'undefined' ? globalThis : this);
