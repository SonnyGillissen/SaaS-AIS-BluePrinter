/**
 * AIS BluePrinter - deployment configuration.
 *
 * Edit this file to configure a hosted instance. All settings are optional; without changes
 * the application runs completely in the browser and stores data in localStorage only.
 */
window.AISBP_CONFIG = {
  /**
   * Where projects are stored.
   *  - mode 'local'  : browser localStorage (default, nothing leaves the user's machine)
   *  - mode 'server' : the PHP API in /server/php backed by MySQL or Microsoft SQL Server.
   *                    Run /server/php/install.php once (or use the Docker one-click setup).
   */
  storage: {
    mode: 'local',
    apiUrl: 'server/php/api.php',
    apiKey: ''
  },

  /**
   * Default settings for new projects (merged into the built-in defaults), e.g.
   * { naming: { tokens: { org: 'contoso', workload: 'integration', env: 'dev' } },
   *   diagram: { style: 'classic' },
   *   icons: { baseUrl: 'icons/msicons/' } }   // self-hosted icon mirror, see tools/mirror-icons.js
   */
  defaults: {},

  /**
   * Default for the export popup's embedded-blueprint checkbox; users can override per file.
   * Set to false to default to sharing without hidden data (JSON remains a full package).
   */
  exports: {
    embedDiagram: true
  },

  /**
   * "Load from Azure": sign in with a Microsoft Entra app registration (single-page application
   * platform, delegated Azure Service Management user_impersonation permission) and read an
   * Azure environment into a new blueprint. Users can also enter their own client id in the
   * dialog; values below are only the defaults.
   *  - clientId    : Application (client) ID of the app registration
   *  - tenantId    : 'organizations' (home tenant of the user), a tenant domain or a tenant id
   *  - redirectUri : defaults to azure-callback.html next to index.html
   */
  azure: {
    clientId: '',
    tenantId: 'organizations',
    redirectUri: ''
  }
};
