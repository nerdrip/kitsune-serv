'use strict';

// Node.js normally uses its bundled Mozilla roots. Adding the operating-system
// store keeps normal public roots while also supporting managed/corporate PCs
// where antivirus or an enterprise proxy installs a trusted local root CA.
function configureTlsTrust() {
  try {
    const tls = require('node:tls');
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
      return { configured: false, reason: 'unsupported-runtime' };
    }
    const defaults = tls.getCACertificates('default');
    const system = tls.getCACertificates('system');
    tls.setDefaultCACertificates([...defaults, ...system]);
    return { configured: true, defaultCount: defaults.length, systemCount: system.length };
  } catch (error) {
    return { configured: false, reason: error.message };
  }
}

module.exports = configureTlsTrust();
