/** Stub: nfewizard usa validateSchemaJsBased; este pacote só evita post-install com Java. */
function validateXML(_xml, _xsd, callback) {
  if (typeof callback === 'function') {
    callback(null, { valid: true });
    return;
  }
  return Promise.resolve({ valid: true });
}

function setup() {
  return Promise.resolve();
}

module.exports = {
  validateXML,
  setup,
};
