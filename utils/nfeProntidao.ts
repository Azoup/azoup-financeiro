import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import { fetchCertificadoAtivo, fetchNfeConfig } from '@/services/nfeConfigService';
import type { PerfilCobranca } from '@/types/contasReceber';
import type { NfeConfig } from '@/types/notaFiscal';

export type NfeProntidaoItem = {
  id: string;
  label: string;
  ok: boolean;
  hint?: string;
};

export type NfeProntidao = {
  pronto: boolean;
  itens: NfeProntidaoItem[];
};

function docOk(doc: string | undefined | null): boolean {
  const d = (doc ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14;
}

export function avaliarProntidaoNfe(
  perfil: Pick<PerfilCobranca, 'razao_social' | 'documento' | 'logradouro' | 'cidade' | 'uf' | 'cep'> | null,
  config: Pick<NfeConfig, 'codigo_ibge_emitente' | 'inscricao_estadual' | 'ncm_servico' | 'cfop_padrao'> | null,
  temCertificado: boolean,
): NfeProntidao {
  const emitenteOk =
    Boolean(perfil?.razao_social?.trim()) &&
    docOk(perfil?.documento) &&
    Boolean(perfil?.logradouro?.trim()) &&
    Boolean(perfil?.cidade?.trim()) &&
    Boolean(perfil?.uf?.trim()?.length === 2) &&
    Boolean(perfil?.cep?.trim());

  const itens: NfeProntidaoItem[] = [
    {
      id: 'emitente',
      label: 'Dados do emitente (razão social, CNPJ/CPF, endereço)',
      ok: emitenteOk,
      hint: emitenteOk ? undefined : 'Preencha a seção Emitente abaixo.',
    },
    {
      id: 'certificado',
      label: 'Certificado digital A1 (.pfx)',
      ok: temCertificado,
      hint: temCertificado ? undefined : 'Envie o arquivo e a senha na seção Certificado.',
    },
    {
      id: 'ibge',
      label: 'Código IBGE do município do emitente',
      ok: Boolean(config?.codigo_ibge_emitente?.trim()?.length >= 6),
      hint: 'Ex.: 3550308 para São Paulo.',
    },
    {
      id: 'ie',
      label: 'Inscrição estadual (ou ISENTO)',
      ok: Boolean(config?.inscricao_estadual?.trim()),
    },
    {
      id: 'fiscal',
      label: 'NCM e CFOP do serviço de mensalidade',
      ok: Boolean(config?.ncm_servico?.trim()) && Boolean(config?.cfop_padrao?.trim()),
    },
  ];

  return { pronto: itens.every((i) => i.ok), itens };
}

export async function fetchNfeProntidao(userId: string): Promise<NfeProntidao> {
  const [perfil, config, cert] = await Promise.all([
    fetchPerfilCobranca(userId),
    fetchNfeConfig(userId),
    fetchCertificadoAtivo(userId),
  ]);
  return avaliarProntidaoNfe(perfil, config, Boolean(cert));
}
