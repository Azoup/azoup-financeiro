import { supabase } from '@/lib/supabase';
import {
  fetchNfeConfig,
  nfeApiBaseUrl,
  type CertificadoFilePick,
  uploadCertificadoA1,
  upsertNfeConfig,
} from '@/services/nfeConfigService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import type { EmpresaCertificado, NfseEmitente, NfseEmitenteInput } from '@/types/notaFiscal';
import { AMBIENTE_FISCAL_ATUAL } from '@/types/notaFiscal';
import {
  isRegimeNormal,
  normalizeCTribMun,
  normalizeCTribNac,
  normalizeNbs,
  type TipoApuracaoNormal,
} from '@/utils/nfseTributacao';

export const MAX_NFSE_EMITENTES = 2;

const DEFAULT_FISCAL: Pick<
  NfseEmitenteInput,
  | 'serie'
  | 'proximo_numero'
  | 'ambiente'
  | 'inscricao_estadual'
  | 'regime_tributario'
  | 'codigo_ibge_emitente'
  | 'inscricao_municipal'
  | 'ncm_servico'
  | 'cfop_padrao'
  | 'cst_icms'
  | 'csosn'
  | 'descricao_servico_padrao'
  | 'natureza_operacao'
  | 'codigo_tributacao_nacional'
  | 'codigo_tributacao_municipal'
  | 'codigo_nbs'
  | 'op_simp_nac'
  | 'reg_esp_trib'
  | 'trib_issqn'
  | 'tp_ret_issqn'
  | 'tipo_apuracao'
  | 'codigo_cnae'
  | 'situacao_pis_cofins'
  | 'aliquota_iss'
  | 'aliquota_pis'
  | 'aliquota_cofins'
  | 'ind_op'
  | 'cst_ibs_cbs'
  | 'c_class_trib'
  | 'aliquota_ibs_uf'
  | 'aliquota_ibs_mun'
  | 'aliquota_cbs'
> = {
  serie: '1',
  proximo_numero: 1,
  ambiente: AMBIENTE_FISCAL_ATUAL,
  inscricao_estadual: '',
  regime_tributario: 1,
  codigo_ibge_emitente: '3501608',
  inscricao_municipal: '',
  ncm_servico: '00000000',
  cfop_padrao: '5933',
  cst_icms: '102',
  csosn: '102',
  descricao_servico_padrao: 'Serviço de mensalidade',
  natureza_operacao: 'Prestação de serviço',
  codigo_tributacao_nacional: '010701',
  codigo_tributacao_municipal: '001',
  codigo_nbs: '115013000',
  op_simp_nac: 3,
  reg_esp_trib: 0,
  trib_issqn: 1,
  tp_ret_issqn: 1,
  tipo_apuracao: null,
  codigo_cnae: '',
  situacao_pis_cofins: '00',
  aliquota_iss: 0,
  aliquota_pis: 0,
  aliquota_cofins: 0,
  ind_op: '100501',
  cst_ibs_cbs: '000',
  c_class_trib: '000001',
  aliquota_ibs_uf: 0.1,
  aliquota_ibs_mun: 0,
  aliquota_cbs: 0.9,
};

function onlyDigits(s: string | undefined | null): string {
  return String(s ?? '').replace(/\D/g, '');
}

function normalizeTipoApuracao(
  regime: number,
  raw: string | null | undefined,
): 'presumido' | 'real' | null {
  if (!isRegimeNormal(regime)) return null;
  if (raw === 'real') return 'real';
  return 'presumido';
}

function normalizeEmitentePatch(input: Partial<NfseEmitenteInput>): Partial<NfseEmitenteInput> {
  const regime = Math.min(3, Math.max(1, Number(input.regime_tributario ?? 1))) as 1 | 2 | 3;
  const situacaoRaw = onlyDigits(input.situacao_pis_cofins ?? '00').slice(0, 2) || '00';
  const cTribNac = normalizeCTribNac(
    input.codigo_tributacao_nacional,
    isRegimeNormal(regime) ? '010501' : '010701',
  );
  const cTribMun = normalizeCTribMun(input.codigo_tributacao_municipal, cTribNac);
  const nbsFallback = isRegimeNormal(regime) ? '111032200' : '115013000';
  return {
    ...input,
    nome: (input.nome ?? 'Emitente').trim() || 'Emitente',
    documento: onlyDigits(input.documento),
    razao_social: (input.razao_social ?? '').trim(),
    logradouro: (input.logradouro ?? '').trim(),
    numero: (input.numero ?? '').trim(),
    complemento: (input.complemento ?? '').trim(),
    bairro: (input.bairro ?? '').trim(),
    cidade: (input.cidade ?? '').trim(),
    uf: (input.uf ?? '').trim().toUpperCase().slice(0, 2),
    cep: onlyDigits(input.cep).slice(0, 8),
    serie: (input.serie ?? '1').trim() || '1',
    proximo_numero: Math.max(1, Number(input.proximo_numero) || 1),
    ambiente: AMBIENTE_FISCAL_ATUAL,
    inscricao_estadual: (input.inscricao_estadual ?? '').trim().toUpperCase(),
    codigo_ibge_emitente: onlyDigits(input.codigo_ibge_emitente).slice(0, 7),
    inscricao_municipal: onlyDigits(input.inscricao_municipal),
    codigo_tributacao_nacional: cTribNac,
    codigo_tributacao_municipal: cTribMun,
    codigo_nbs: normalizeNbs(input.codigo_nbs, nbsFallback),
    codigo_cnae: onlyDigits(input.codigo_cnae).slice(0, 7),
    descricao_servico_padrao:
      (input.descricao_servico_padrao ?? 'Serviço de mensalidade').trim() || 'Serviço de mensalidade',
    natureza_operacao: (input.natureza_operacao ?? 'Prestação de serviço').trim(),
    regime_tributario: regime,
    // Regime Normal: só 1 (não optante) ou 3 (ME/EPP) — bate com o portal TipLan.
    op_simp_nac: (regime === 3
      ? (Number(input.op_simp_nac) === 3 ? 3 : 1)
      : Math.min(4, Math.max(1, Number(input.op_simp_nac ?? 3)))) as 1 | 2 | 3 | 4,
    reg_esp_trib: Number(input.reg_esp_trib ?? 0),
    trib_issqn: Math.min(4, Math.max(1, Number(input.trib_issqn ?? 1))) as 1 | 2 | 3 | 4,
    tp_ret_issqn: Math.min(3, Math.max(1, Number(input.tp_ret_issqn ?? 1))) as 1 | 2 | 3,
    tipo_apuracao: normalizeTipoApuracao(regime, input.tipo_apuracao),
    situacao_pis_cofins: situacaoRaw.padStart(2, '0'),
    aliquota_iss: Math.max(0, Number(input.aliquota_iss ?? 0) || 0),
    aliquota_pis: Math.max(0, Number(input.aliquota_pis ?? 0) || 0),
    aliquota_cofins: Math.max(0, Number(input.aliquota_cofins ?? 0) || 0),
    ind_op: onlyDigits(input.ind_op ?? '100501').slice(0, 10) || '100501',
    cst_ibs_cbs: onlyDigits(input.cst_ibs_cbs ?? '000').padStart(3, '0').slice(0, 3) || '000',
    c_class_trib: onlyDigits(input.c_class_trib ?? '000001').padStart(6, '0').slice(0, 6) || '000001',
    aliquota_ibs_uf: Math.max(0, Number(input.aliquota_ibs_uf ?? 0.1) || 0),
    aliquota_ibs_mun: Math.max(0, Number(input.aliquota_ibs_mun ?? 0) || 0),
    aliquota_cbs: Math.max(0, Number(input.aliquota_cbs ?? 0.9) || 0),
  };
}

/** Espelha o emitente padrão em nfe_config (compatibilidade legada). */
async function syncNfeConfigFromEmitente(userId: string, e: NfseEmitente): Promise<void> {
  if (!e.padrao) return;
  await upsertNfeConfig(userId, {
    serie: e.serie,
    proximo_numero: e.proximo_numero,
    inscricao_estadual: e.inscricao_estadual,
    regime_tributario: e.regime_tributario,
    codigo_ibge_emitente: e.codigo_ibge_emitente,
    inscricao_municipal: e.inscricao_municipal,
    codigo_tributacao_nacional: e.codigo_tributacao_nacional,
    codigo_tributacao_municipal: e.codigo_tributacao_municipal,
    codigo_nbs: e.codigo_nbs,
    ncm_servico: e.ncm_servico,
    cfop_padrao: e.cfop_padrao,
    cst_icms: e.cst_icms,
    csosn: e.csosn,
    descricao_servico_padrao: e.descricao_servico_padrao,
    natureza_operacao: e.natureza_operacao,
    op_simp_nac: e.op_simp_nac,
    reg_esp_trib: e.reg_esp_trib,
    trib_issqn: e.trib_issqn,
    tp_ret_issqn: e.tp_ret_issqn,
  });
}

export async function fetchEmitentes(userId: string): Promise<NfseEmitente[]> {
  const { data, error } = await supabase
    .from('nfse_emitente')
    .select('*')
    .eq('user_id', userId)
    .order('padrao', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) {
    if (/nfse_emitente|relation|does not exist|42P01/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data as NfseEmitente[]) ?? [];
}

export async function fetchEmitenteById(userId: string, emitenteId: string): Promise<NfseEmitente | null> {
  const { data, error } = await supabase
    .from('nfse_emitente')
    .select('*')
    .eq('user_id', userId)
    .eq('id', emitenteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NfseEmitente | null) ?? null;
}

export async function fetchEmitentePadrao(userId: string): Promise<NfseEmitente | null> {
  const list = await fetchEmitentes(userId);
  return list.find((e) => e.padrao) ?? list[0] ?? null;
}

/**
 * Garante pelo menos 1 emitente (seed a partir de perfil + nfe_config se a tabela existir).
 */
export async function ensureEmitentes(userId: string): Promise<NfseEmitente[]> {
  let list = await fetchEmitentes(userId);
  if (list.length) return list;

  const [perfil, config] = await Promise.all([
    fetchPerfilCobranca(userId).catch(() => null),
    fetchNfeConfig(userId).catch(() => null),
  ]);

  const doc = onlyDigits(perfil?.documento);
  if (!doc && !config) {
    return [];
  }

  try {
    const created = await createEmitente(userId, {
      nome: 'Emitente 1',
      documento: doc || `PENDENTE${Date.now()}`,
      razao_social: perfil?.razao_social?.trim() || 'Prestador',
      logradouro: perfil?.logradouro ?? '',
      numero: perfil?.numero ?? '',
      complemento: perfil?.complemento ?? '',
      bairro: perfil?.bairro ?? '',
      cidade: perfil?.cidade ?? '',
      uf: perfil?.uf ?? '',
      cep: perfil?.cep ?? '',
      ...DEFAULT_FISCAL,
      serie: config?.serie ?? DEFAULT_FISCAL.serie,
      proximo_numero: config?.proximo_numero ?? 1,
      codigo_ibge_emitente: config?.codigo_ibge_emitente || DEFAULT_FISCAL.codigo_ibge_emitente,
      inscricao_municipal: config?.inscricao_municipal || '',
      codigo_tributacao_nacional: config?.codigo_tributacao_nacional || '010701',
      codigo_tributacao_municipal: config?.codigo_tributacao_municipal || '001',
      codigo_nbs: config?.codigo_nbs || '115013000',
      descricao_servico_padrao: config?.descricao_servico_padrao || DEFAULT_FISCAL.descricao_servico_padrao,
      op_simp_nac: (config?.op_simp_nac as 1 | 2 | 3 | 4) || 3,
      reg_esp_trib: config?.reg_esp_trib ?? 0,
      trib_issqn: (config?.trib_issqn as 1 | 2 | 3 | 4) || 1,
      tp_ret_issqn: (config?.tp_ret_issqn as 1 | 2 | 3) || 1,
      padrao: true,
    });
    return [created];
  } catch (e) {
    if (/nfse_emitente|relation|does not exist|42P01/i.test((e as Error).message)) {
      return [];
    }
    throw e;
  }
}

export async function createEmitente(
  userId: string,
  input: Partial<NfseEmitenteInput> & { documento: string; razao_social: string },
): Promise<NfseEmitente> {
  const existing = await fetchEmitentes(userId);
  if (existing.length >= MAX_NFSE_EMITENTES) {
    throw new Error('Máximo de 2 emitentes (CNPJs) por usuário.');
  }

  const patch = normalizeEmitentePatch({
    ...DEFAULT_FISCAL,
    ...input,
    nome: input.nome || (existing.length ? 'Emitente 2' : 'Emitente 1'),
    padrao: existing.length === 0 ? true : Boolean(input.padrao),
  });

  if (!patch.documento || (patch.documento.length !== 11 && patch.documento.length !== 14)) {
    throw new Error('Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.');
  }
  if (!patch.razao_social?.trim()) {
    throw new Error('Informe a razão social do emitente.');
  }

  if (patch.padrao && existing.length) {
    await supabase.from('nfse_emitente').update({ padrao: false }).eq('user_id', userId);
  }

  const { data, error } = await supabase
    .from('nfse_emitente')
    .insert({ user_id: userId, ...patch })
    .select('*')
    .single();
  if (error) {
    if (/tipo_apuracao|codigo_cnae|situacao_pis_cofins|aliquota_iss|ind_op|cst_ibs_cbs|c_class_trib|aliquota_ibs|aliquota_cbs|column|schema cache/i.test(error.message)) {
      throw new Error(
        'Falta migration fiscal do emitente. Rode no SQL Editor: 038_nfse_emitente_regime_normal.sql e 041_nfse_ibs_cbs.sql.',
      );
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('Falha ao criar emitente.');

  const row = data as NfseEmitente;
  await syncNfeConfigFromEmitente(userId, row).catch(() => undefined);
  return row;
}

export async function updateEmitente(
  userId: string,
  emitenteId: string,
  input: Partial<NfseEmitenteInput>,
): Promise<NfseEmitente> {
  const current = await fetchEmitenteById(userId, emitenteId);
  if (!current) throw new Error('Emitente não encontrado.');

  const merged = normalizeEmitentePatch({ ...current, ...input, padrao: input.padrao ?? current.padrao });
  if (!merged.documento || (merged.documento.length !== 11 && merged.documento.length !== 14)) {
    throw new Error('Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.');
  }

  if (merged.padrao) {
    await supabase
      .from('nfse_emitente')
      .update({ padrao: false })
      .eq('user_id', userId)
      .neq('id', emitenteId);
  }

  const { data, error } = await supabase
    .from('nfse_emitente')
    .update(merged)
    .eq('id', emitenteId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) {
    if (/tipo_apuracao|codigo_cnae|situacao_pis_cofins|aliquota_iss|ind_op|cst_ibs_cbs|c_class_trib|aliquota_ibs|aliquota_cbs|column|schema cache/i.test(error.message)) {
      throw new Error(
        'Falta migration fiscal do emitente. Rode no SQL Editor: 038_nfse_emitente_regime_normal.sql e 041_nfse_ibs_cbs.sql.',
      );
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('Falha ao salvar emitente.');

  const row = data as NfseEmitente;
  await syncNfeConfigFromEmitente(userId, row).catch(() => undefined);
  return row;
}

export async function setEmitentePadrao(userId: string, emitenteId: string): Promise<void> {
  await supabase.from('nfse_emitente').update({ padrao: false }).eq('user_id', userId);
  const { error } = await supabase
    .from('nfse_emitente')
    .update({ padrao: true })
    .eq('id', emitenteId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const e = await fetchEmitenteById(userId, emitenteId);
  if (e) await syncNfeConfigFromEmitente(userId, e).catch(() => undefined);
}

export async function deleteEmitente(userId: string, emitenteId: string): Promise<void> {
  const list = await fetchEmitentes(userId);
  const target = list.find((e) => e.id === emitenteId);
  if (!target) throw new Error('Emitente não encontrado.');
  if (list.length <= 1) {
    throw new Error('É necessário manter pelo menos um emitente.');
  }
  if (target.padrao) {
    throw new Error('Defina outro emitente como padrão antes de excluir este.');
  }

  const { count } = await supabase
    .from('nota_fiscal')
    .select('id', { count: 'exact', head: true })
    .eq('emitente_id', emitenteId)
    .eq('status', 'autorizada');
  if ((count ?? 0) > 0) {
    throw new Error('Não é possível excluir: há NFS-e autorizadas com este CNPJ.');
  }

  const { error } = await supabase.from('nfse_emitente').delete().eq('id', emitenteId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function fetchCertificadoAtivoEmitente(
  userId: string,
  emitenteId: string,
): Promise<EmpresaCertificado | null> {
  const { data, error } = await supabase
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('emitente_id', emitenteId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as EmpresaCertificado;

  // Legado: cert ativo sem emitente_id
  const { data: legado, error: legErr } = await supabase
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .is('emitente_id', null)
    .maybeSingle();
  if (legErr) throw new Error(legErr.message);
  return (legado as EmpresaCertificado | null) ?? null;
}

export async function uploadCertificadoA1Emitente(
  userId: string,
  emitenteId: string,
  file: CertificadoFilePick,
  senha: string,
): Promise<void> {
  await uploadCertificadoA1(userId, file, senha, emitenteId);
}

export function emitenteLabel(
  e: Pick<NfseEmitente, 'nome' | 'documento' | 'razao_social'> & {
    regime_tributario?: number | null;
    tipo_apuracao?: TipoApuracaoNormal | null;
  },
): string {
  const doc = onlyDigits(e.documento);
  const docFmt =
    doc.length === 14
      ? doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
      : doc.length === 11
        ? doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
        : doc || '—';
  const nome = e.nome?.trim() || e.razao_social?.trim() || 'Emitente';
  let regime = '';
  if (e.regime_tributario != null) {
    if (e.regime_tributario === 3) {
      const ap =
        e.tipo_apuracao === 'real' ? 'Real' : e.tipo_apuracao === 'presumido' ? 'Presumido' : 'Normal';
      regime = ` · ${ap === 'Normal' ? 'Normal' : `Normal · ${ap}`}`;
    } else {
      regime = ' · Simples';
    }
  }
  return `${nome} · ${docFmt}${regime}`;
}

export { nfeApiBaseUrl };
