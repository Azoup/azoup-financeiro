const { cleanupTemp, cancelarBoletoC6Api } = require('./c6Client');
const { loadC6Credentials } = require('./c6Credentials');
const { baixarBoletoSicoobApi, cleanupCert } = require('./sicoobClient');
const { loadSicoobCredentials } = require('./sicoobCredentials');

function precisaCancelarNoBanco(boleto) {
  if (!boleto) return false;
  if (boleto.status_registro === 'pago' || boleto.status_registro === 'baixado') return false;
  if (boleto.tipo_emissao === 'c6' && boleto.c6_boleto_id) return true;
  if (boleto.tipo_emissao === 'sicoob' && boleto.nosso_numero_banco) return true;
  if (boleto.status_registro === 'registrado') {
    return Boolean(boleto.c6_boleto_id || boleto.nosso_numero_banco);
  }
  return false;
}

/**
 * Cancela/baixa o título no banco (C6 ou Sicoob). Não altera o status da mensalidade.
 * @returns {{ success: boolean, cancelado_banco: boolean, skipped?: boolean, message?: string, banco?: string }}
 */
async function cancelarUmBoletoNoBanco(admin, userId, boletoId) {
  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!boleto) throw new Error('Boleto não encontrado.');

  if (!precisaCancelarNoBanco(boleto)) {
    return {
      success: true,
      boletoId,
      cancelado_banco: false,
      skipped: true,
      message: 'Boleto sem registro bancário — só cancelamento interno.',
    };
  }

  if (boleto.tipo_emissao === 'c6' || boleto.c6_boleto_id) {
    const creds = await loadC6Credentials(admin, userId, boleto.emitente_id);
    if (!creds) throw new Error('Credenciais C6 indisponíveis para cancelar o boleto no banco.');
    try {
      const raw = await cancelarBoletoC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        c6BoletoId: boleto.c6_boleto_id,
      });
      await admin.from('historico_boleto_sicoob').insert({
        boleto_id: boleto.id,
        acao: 'CANCELAMENTO_BANCO_C6',
        usuario_id: userId,
        detalhes: 'Boleto cancelado na API C6.',
        payload_resposta: raw ?? null,
      });
      return { success: true, boletoId, cancelado_banco: true, banco: 'c6', status: raw?.status };
    } finally {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }

  const creds = await loadSicoobCredentials(admin, userId, boleto.emitente_id);
  if (!creds) throw new Error('Sicoob inativo ou sem certificado — não foi possível baixar o boleto no banco.');
  try {
    const raw = await baixarBoletoSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      nossoNumero: boleto.nosso_numero_banco,
    });
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boleto.id,
      acao: 'BAIXA_BANCO_SICOOB',
      usuario_id: userId,
      detalhes: 'Boleto baixado/cancelado na API Sicoob.',
      payload_resposta: raw ?? null,
    });
    return { success: true, boletoId, cancelado_banco: true, banco: 'sicoob', status: raw?.status };
  } finally {
    cleanupCert(creds.certPath);
  }
}

module.exports = { cancelarUmBoletoNoBanco, precisaCancelarNoBanco };
