/** Ajustes de ambiente para Vercel / AWS Lambda (OpenSSL do SO vs libssl do Node). */
function prepareServerlessCryptoEnv() {
  if (
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV
  ) {
    process.env.LD_LIBRARY_PATH = '';
  }
}

/** Opções recomendadas da lib nfewizard em serverless (evita `openssl` CLI). */
const NFEWIZARD_LIB_SERVERLESS = {
  useOpenSSL: false,
  useForSchemaValidation: 'validateSchemaJsBased',
  log: { exibirLogNoConsole: false, armazenarLogs: false },
};

module.exports = { prepareServerlessCryptoEnv, NFEWIZARD_LIB_SERVERLESS };
