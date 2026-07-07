const https = require('https');

let relaxed = false;
let previousTlsReject;

/** Homologação ADN: evita falha de cadeia ICP no serverless (Vercel). */
function withHomologTlsRelaxed(run) {
  if (relaxed) return run();

  relaxed = true;
  previousTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const OriginalAgent = https.Agent;
  class HomologHttpsAgent extends OriginalAgent {
    constructor(options = {}) {
      super({ ...options, rejectUnauthorized: false });
    }
  }
  https.Agent = HomologHttpsAgent;

  return Promise.resolve()
    .then(run)
    .finally(() => {
      relaxed = false;
      https.Agent = OriginalAgent;
      if (previousTlsReject === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsReject;
      }
    });
}

module.exports = { withHomologTlsRelaxed };
