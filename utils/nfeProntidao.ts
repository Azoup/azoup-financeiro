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
  config: Pick<
    NfeConfig,
    'codigo_ibge_emitente' | 'codigo_tributacao_nacional' | 'codigo_nbs' | 'descricao_servico_padrao'
  > | null,
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
      label: 'Dados do prestador (razão social, CNPJ/CPF, endereço)',
      ok: emitenteOk,
      hint: emitenteOk ? undefined : 'Preencha a seção Prestador abaixo.',
    },
    {
      id: 'certificado',
      label: 'Certificado digital A1 (.pfx)',
      ok: temCertificado,
      hint: temCertificado ? undefined : 'Envie o arquivo e a senha na seção Certificado.',
    },
    {
      id: 'ibge',
      label: 'Código IBGE do município do prestador (cidade, 7 dígitos)',
      ok: Boolean(config?.codigo_ibge_emitente?.trim()?.length >= 6),
      hint: 'Ex.: Americana = 3501608 (ABRASF TipLan). Cidades com emissor próprio são roteadas automaticamente.',
    },
    {
      id: 'servico',
      label: 'Código do serviço (LC 116) e NBS',
      ok:
        Boolean(config?.codigo_tributacao_nacional?.trim()) &&
        Boolean(config?.codigo_nbs?.trim()) &&
        Boolean(config?.descricao_servico_padrao?.trim()),
      hint: 'NFS-e não usa NCM/CFOP. Preencha LC 116 (6 dígitos) e NBS (9 dígitos) na seção Serviço.',
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
