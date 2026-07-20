import {
  fetchCertificadoAtivoEmitente,
  ensureEmitentes,
} from '@/services/nfseEmitenteService';
import type { NfseEmitente } from '@/types/notaFiscal';

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

export function avaliarProntidaoEmitente(
  emitente: Pick<
    NfseEmitente,
    | 'razao_social'
    | 'documento'
    | 'logradouro'
    | 'cidade'
    | 'uf'
    | 'cep'
    | 'codigo_ibge_emitente'
    | 'codigo_tributacao_nacional'
    | 'codigo_nbs'
    | 'descricao_servico_padrao'
  > &
    Partial<Pick<NfseEmitente, 'regime_tributario' | 'codigo_cnae' | 'inscricao_municipal'>> | null,
  temCertificado: boolean,
): NfeProntidao {
  const emitenteOk =
    Boolean(emitente?.razao_social?.trim()) &&
    docOk(emitente?.documento) &&
    Boolean(emitente?.logradouro?.trim()) &&
    Boolean(emitente?.cidade?.trim()) &&
    Boolean(emitente?.uf?.trim()?.length === 2) &&
    Boolean(emitente?.cep?.trim());

  const regime = Number(emitente?.regime_tributario ?? 1);
  const isNormal = regime === 3;
  const cnaeOk = !isNormal || onlyDigits(emitente?.codigo_cnae).length >= 7;
  const imOk = Boolean(onlyDigits(emitente?.inscricao_municipal).length);

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
      ok: Boolean(emitente?.codigo_ibge_emitente?.trim()?.length && emitente.codigo_ibge_emitente.trim().length >= 6),
      hint: 'Ex.: Americana = 3501608 (ABRASF TipLan).',
    },
    {
      id: 'im',
      label: 'Inscrição municipal do prestador',
      ok: imOk,
      hint: imOk ? undefined : 'Obrigatória na NFS-e (prestador).',
    },
    {
      id: 'servico',
      label: 'Código do serviço (LC 116) e NBS',
      ok:
        Boolean(emitente?.codigo_tributacao_nacional?.trim()) &&
        Boolean(emitente?.codigo_nbs?.trim()) &&
        Boolean(emitente?.descricao_servico_padrao?.trim()),
      hint: 'Preencha LC 116 (6 dígitos) e NBS (9 dígitos) na seção Serviço.',
    },
  ];

  if (isNormal) {
    itens.push({
      id: 'cnae',
      label: 'CNAE principal (7 dígitos) — Regime Normal',
      ok: cnaeOk,
      hint: cnaeOk ? undefined : 'Informe o CNAE na seção Regime tributário.',
    });
  }

  return { pronto: itens.every((i) => i.ok), itens };
}

function onlyDigits(s: string | undefined | null): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** Pronto se pelo menos um emitente estiver completo + A1. */
export async function fetchNfeProntidao(userId: string): Promise<NfeProntidao> {
  const emitentes = await ensureEmitentes(userId);
  if (!emitentes.length) {
    return {
      pronto: false,
      itens: [
        {
          id: 'emitente',
          label: 'Cadastre ao menos um emitente (CNPJ) em Configurações › NFS-e',
          ok: false,
          hint: 'Rode a migration 037_nfse_emitente.sql se a tela não listar emitentes.',
        },
      ],
    };
  }

  let melhor: NfeProntidao | null = null;
  for (const e of emitentes) {
    const cert = await fetchCertificadoAtivoEmitente(userId, e.id);
    const p = avaliarProntidaoEmitente(e, Boolean(cert));
    if (p.pronto) return p;
    if (!melhor || p.itens.filter((i) => i.ok).length > melhor.itens.filter((i) => i.ok).length) {
      melhor = p;
    }
  }
  return melhor!;
}

/** @deprecated use avaliarProntidaoEmitente */
export function avaliarProntidaoNfe(
  perfil: {
    razao_social: string;
    documento: string;
    logradouro: string;
    cidade: string;
    uf: string;
    cep: string;
  } | null,
  config: {
    codigo_ibge_emitente: string;
    codigo_tributacao_nacional: string;
    codigo_nbs: string;
    descricao_servico_padrao: string;
  } | null,
  temCertificado: boolean,
): NfeProntidao {
  return avaliarProntidaoEmitente(
    perfil && config
      ? {
          ...perfil,
          codigo_ibge_emitente: config.codigo_ibge_emitente,
          codigo_tributacao_nacional: config.codigo_tributacao_nacional,
          codigo_nbs: config.codigo_nbs,
          descricao_servico_padrao: config.descricao_servico_padrao,
        }
      : null,
    temCertificado,
  );
}
