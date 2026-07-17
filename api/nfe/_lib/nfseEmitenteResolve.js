/**
 * Resolve emitente NFS-e (CNPJ + fiscal) e certificado A1 para uma nota.
 * Preferência: nota.emitente_id → emitente padrão → legado perfil_cobranca + nfe_config.
 */

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function emitenteToPerfil(e) {
  return {
    user_id: e.user_id,
    razao_social: e.razao_social,
    documento: e.documento,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    cep: e.cep,
  };
}

function emitenteToConfig(e) {
  return {
    user_id: e.user_id,
    serie: e.serie,
    proximo_numero: e.proximo_numero,
    ambiente: e.ambiente,
    inscricao_estadual: e.inscricao_estadual,
    regime_tributario: e.regime_tributario,
    codigo_ibge_emitente: e.codigo_ibge_emitente,
    inscricao_municipal: e.inscricao_municipal,
    ncm_servico: e.ncm_servico,
    cfop_padrao: e.cfop_padrao,
    cst_icms: e.cst_icms,
    csosn: e.csosn,
    descricao_servico_padrao: e.descricao_servico_padrao,
    natureza_operacao: e.natureza_operacao,
    codigo_tributacao_nacional: e.codigo_tributacao_nacional,
    codigo_tributacao_municipal: e.codigo_tributacao_municipal,
    codigo_nbs: e.codigo_nbs,
    op_simp_nac: e.op_simp_nac,
    reg_esp_trib: e.reg_esp_trib,
    trib_issqn: e.trib_issqn,
    tp_ret_issqn: e.tp_ret_issqn,
  };
}

async function loadEmitenteRow(admin, userId, emitenteId) {
  if (emitenteId) {
    const { data } = await admin
      .from('nfse_emitente')
      .select('*')
      .eq('id', emitenteId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data;
  }
  const { data: padrao } = await admin
    .from('nfse_emitente')
    .select('*')
    .eq('user_id', userId)
    .eq('padrao', true)
    .maybeSingle();
  if (padrao) return padrao;

  const { data: primeiro } = await admin
    .from('nfse_emitente')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return primeiro ?? null;
}

async function loadCertForEmitente(admin, userId, emitenteId) {
  if (emitenteId) {
    const { data } = await admin
      .from('empresa_certificado')
      .select('*')
      .eq('user_id', userId)
      .eq('emitente_id', emitenteId)
      .eq('ativo', true)
      .maybeSingle();
    if (data) return data;
  }
  const { data: legado } = await admin
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .maybeSingle();
  return legado ?? null;
}

/**
 * @returns {{ perfil, config, cert, emitente }}
 */
async function resolveEmitenteContexto(admin, userId, nota) {
  const emitente = await loadEmitenteRow(admin, userId, nota?.emitente_id);

  if (emitente) {
    const cert = await loadCertForEmitente(admin, userId, emitente.id);
    return {
      emitente,
      perfil: emitenteToPerfil(emitente),
      config: emitenteToConfig(emitente),
      cert,
    };
  }

  const [{ data: perfil }, { data: config }, { data: cert }] = await Promise.all([
    admin.from('perfil_cobranca').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('nfe_config').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('empresa_certificado').select('*').eq('user_id', userId).eq('ativo', true).maybeSingle(),
  ]);

  return { emitente: null, perfil, config, cert };
}

module.exports = {
  onlyDigits,
  emitenteToPerfil,
  emitenteToConfig,
  resolveEmitenteContexto,
  loadCertForEmitente,
};
