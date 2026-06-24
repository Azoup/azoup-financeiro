import { supabase } from '@/lib/supabase';
import type { EmpresaCertificado, NfeConfig, NfeConfigInput } from '@/types/notaFiscal';
import { AMBIENTE_FISCAL_HOMOLOGACAO } from '@/types/notaFiscal';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

const DEFAULT_NFE_CONFIG: NfeConfigInput = {
  serie: '1',
  proximo_numero: 1,
  ambiente: AMBIENTE_FISCAL_HOMOLOGACAO,
  inscricao_estadual: '',
  regime_tributario: 1,
  codigo_ibge_emitente: '',
  ncm_servico: '00000000',
  cfop_padrao: '5933',
  cst_icms: '102',
  csosn: '102',
  descricao_servico_padrao: 'Serviço de mensalidade',
  natureza_operacao: 'Prestação de serviço',
  inscricao_municipal: '',
  codigo_tributacao_nacional: '010701',
  codigo_nbs: '106043000',
  op_simp_nac: 1,
  reg_esp_trib: 0,
  trib_issqn: 1,
  tp_ret_issqn: 1,
};

export async function fetchNfeConfig(userId: string): Promise<NfeConfig | null> {
  const { data, error } = await supabase
    .from('nfe_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NfeConfig | null) ?? null;
}

export async function upsertNfeConfig(userId: string, input: Partial<NfeConfigInput>): Promise<void> {
  const current = (await fetchNfeConfig(userId)) ?? { ...DEFAULT_NFE_CONFIG, user_id: userId };
  const row = {
    user_id: userId,
    serie: (input.serie ?? current.serie).trim() || '1',
    proximo_numero: input.proximo_numero ?? current.proximo_numero ?? 1,
    ambiente: AMBIENTE_FISCAL_HOMOLOGACAO,
    inscricao_estadual: (input.inscricao_estadual ?? current.inscricao_estadual ?? '').trim(),
    regime_tributario: input.regime_tributario ?? current.regime_tributario ?? 1,
    codigo_ibge_emitente: (input.codigo_ibge_emitente ?? current.codigo_ibge_emitente ?? '').trim(),
    ncm_servico: (input.ncm_servico ?? current.ncm_servico ?? '00000000').replace(/\D/g, '').slice(0, 8),
    cfop_padrao: (input.cfop_padrao ?? current.cfop_padrao ?? '5933').replace(/\D/g, '').slice(0, 4),
    cst_icms: (input.cst_icms ?? current.cst_icms ?? '102').trim(),
    csosn: (input.csosn ?? current.csosn ?? '102').trim(),
    descricao_servico_padrao: (
      input.descricao_servico_padrao ?? current.descricao_servico_padrao ?? 'Serviço de mensalidade'
    ).trim(),
    natureza_operacao: (input.natureza_operacao ?? current.natureza_operacao ?? 'Prestação de serviço').trim(),
    inscricao_municipal: (input.inscricao_municipal ?? current.inscricao_municipal ?? '').trim(),
    codigo_tributacao_nacional: (input.codigo_tributacao_nacional ?? current.codigo_tributacao_nacional ?? '010701')
      .replace(/\D/g, '')
      .slice(0, 6),
    codigo_nbs: (input.codigo_nbs ?? current.codigo_nbs ?? '106043000').replace(/\D/g, '').slice(0, 9),
    op_simp_nac: input.op_simp_nac ?? current.op_simp_nac ?? 1,
    reg_esp_trib: input.reg_esp_trib ?? current.reg_esp_trib ?? 0,
    trib_issqn: input.trib_issqn ?? current.trib_issqn ?? 1,
    tp_ret_issqn: input.tp_ret_issqn ?? current.tp_ret_issqn ?? 1,
  };
  const { error } = await supabase.from('nfe_config').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function ensureNfeConfig(userId: string): Promise<NfeConfig> {
  const existing = await fetchNfeConfig(userId);
  if (existing) return existing;
  await upsertNfeConfig(userId, DEFAULT_NFE_CONFIG);
  const created = await fetchNfeConfig(userId);
  if (!created) throw new Error('Não foi possível criar configuração NFS-e.');
  return created;
}

export async function fetchCertificadoAtivo(userId: string): Promise<EmpresaCertificado | null> {
  const { data, error } = await supabase
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EmpresaCertificado | null) ?? null;
}

export type CertificadoFilePick = {
  uri: string;
  name: string;
  mimeType?: string;
  /** Arquivo nativo no browser (evita falha ao ler blob URL). */
  webFile?: File;
};

async function readCertificadoBytes(file: CertificadoFilePick): Promise<ArrayBuffer> {
  if (Platform.OS === 'web' && file.webFile instanceof File) {
    return file.webFile.arrayBuffer();
  }
  const response = await fetch(file.uri);
  if (!response.ok) {
    throw new Error('Não foi possível ler o arquivo do certificado (.pfx / .p12).');
  }
  return response.arrayBuffer();
}

async function salvarSenhaCertificado(
  certificadoId: string,
  senha: string,
): Promise<void> {
  const trimmed = senha.trim();
  if (!trimmed) throw new Error('Informe a senha do certificado A1.');

  const { error: rpcErr } = await supabase.rpc('salvar_senha_certificado_a1', {
    p_certificado_id: certificadoId,
    p_senha: trimmed,
  });
  if (!rpcErr) return;

  const rpcMsg = rpcErr.message ?? 'Falha ao salvar senha do certificado.';

  if (/function.*does not exist/i.test(rpcMsg) || /salvar_senha_certificado_a1/i.test(rpcMsg)) {
    throw new Error(
      'Migration 031 não aplicada no Supabase. Rode os arquivos 031 e 032 em SQL Editor (supabase/migrations).',
    );
  }

  if (/chave de criptografia/i.test(rpcMsg) || /cert_encryption_key/i.test(rpcMsg)) {
    throw new Error(
      'Defina a chave de segurança do certificado na seção abaixo (mín. 16 caracteres) e tente enviar o .pfx novamente.',
    );
  }

  throw new Error(rpcMsg);
}

export async function fetchCertificadoChaveConfigurada(): Promise<boolean> {
  const { data, error } = await supabase.rpc('certificado_chave_configurada');
  if (error) {
    if (/function.*does not exist/i.test(error.message)) return false;
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function definirChaveCertificado(chave: string): Promise<void> {
  const trimmed = chave.trim();
  if (trimmed.length < 16) {
    throw new Error('Use uma chave com no mínimo 16 caracteres.');
  }
  const { error } = await supabase.rpc('definir_chave_certificado', { p_chave: trimmed });
  if (error) {
    if (/function.*does not exist/i.test(error.message)) {
      throw new Error('Rode a migration 032 no Supabase SQL Editor e tente novamente.');
    }
    throw new Error(error.message);
  }
}

export async function uploadCertificadoA1(
  userId: string,
  file: CertificadoFilePick,
  senha: string,
): Promise<void> {
  if (!senha.trim()) throw new Error('Informe a senha do certificado A1.');

  const bytes = await readCertificadoBytes(file);
  if (!bytes.byteLength) {
    throw new Error('O arquivo do certificado está vazio. Selecione novamente o .pfx / .p12.');
  }

  const path = `${userId}/certificado-${Date.now()}.pfx`;

  const { error: upErr } = await supabase.storage.from('empresa_certificados').upload(path, bytes, {
    contentType: file.mimeType ?? 'application/x-pkcs12',
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: offErr } = await supabase
    .from('empresa_certificado')
    .update({ ativo: false })
    .eq('user_id', userId)
    .eq('ativo', true);
  if (offErr) throw new Error(offErr.message);

  const { data: cert, error: insErr } = await supabase
    .from('empresa_certificado')
    .insert({ user_id: userId, storage_path: path, ativo: true })
    .select('id')
    .single();
  if (insErr || !cert) {
    await supabase.storage.from('empresa_certificados').remove([path]).catch(() => undefined);
    throw new Error(insErr?.message ?? 'Falha ao registrar certificado.');
  }

  try {
    await salvarSenhaCertificado(cert.id as string, senha);
  } catch (e) {
    await supabase.from('empresa_certificado').delete().eq('id', cert.id);
    await supabase.storage.from('empresa_certificados').remove([path]).catch(() => undefined);
    throw e;
  }
}

export async function pickCertificadoFile(): Promise<CertificadoFilePick | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pfx,.p12';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) {
          resolve(null);
          return;
        }
        resolve({
          uri: URL.createObjectURL(f),
          name: f.name,
          mimeType: f.type || 'application/x-pkcs12',
          webFile: f,
        });
      };
      input.click();
    });
  }
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/x-pkcs12', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined };
}

export function nfeApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_NFE_API_URL ?? '';
}
