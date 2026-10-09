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
   * Footer branding: "Community Project by <footerText>". Set `footerLogo` to an image URL
   * (or relative path such as 'assets/logo.svg') to show a logo instead of the text; the text
   * is then used as the logo's alternative text. Users can override this in Options > Branding.
   */
  branding: {
    footerText: 'Sonny Gillissen',
    footerLogo: '',
    footerLink: ''
  },

  /**
   * Default settings for new projects (merged into the built-in defaults), e.g.
   * { naming: { tokens: { org: 'contoso', workload: 'integration', env: 'dev' } },
   *   diagram: { style: 'classic' },
   *   icons: { baseUrl: 'icons/msicons/' } }   // self-hosted icon mirror, see tools/mirror-icons.js
   */
  defaults: {}
};
