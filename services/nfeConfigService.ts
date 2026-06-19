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

export async function uploadCertificadoA1(
  userId: string,
  file: { uri: string; name: string; mimeType?: string },
  senha: string,
): Promise<void> {
  if (!senha.trim()) throw new Error('Informe a senha do certificado A1.');

  const path = `${userId}/certificado-${Date.now()}.pfx`;
  const response = await fetch(file.uri);
  const blob = await response.blob();

  const { error: upErr } = await supabase.storage.from('empresa_certificados').upload(path, blob, {
    contentType: file.mimeType ?? 'application/x-pkcs12',
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);

  await supabase
    .from('empresa_certificado')
    .update({ ativo: false })
    .eq('user_id', userId)
    .eq('ativo', true);

  const { data: cert, error: insErr } = await supabase
    .from('empresa_certificado')
    .insert({ user_id: userId, storage_path: path, ativo: true })
    .select('id')
    .single();
  if (insErr || !cert) throw new Error(insErr?.message ?? 'Falha ao registrar certificado.');

  const { error: secErr } = await fetch(`${nfeApiBaseUrl()}/api/nfe/certificado`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ certificadoId: cert.id, senha: senha.trim() }),
  }).then(async (r) => {
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      const msg = b.error ?? r.statusText;
      if (r.status === 404) {
        return {
          error: {
            message:
              'API NFS-e não encontrada. Em produção, faça deploy na Vercel. Em desenvolvimento, use "vercel dev" com as variáveis do .env.',
          },
        };
      }
      return { error: { message: msg } };
    }
    return { error: null };
  });

  if (secErr) {
    await supabase.from('empresa_certificado').delete().eq('id', cert.id);
    throw new Error(secErr.message ?? 'Falha ao salvar senha do certificado no servidor.');
  }
}

export async function pickCertificadoFile(): Promise<{ uri: string; name: string; mimeType?: string } | null> {
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
        resolve({ uri: URL.createObjectURL(f), name: f.name, mimeType: f.type });
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
