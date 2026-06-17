import { formatCepFromDigits, onlyDigitsCnpj } from '@/utils/cnpj';

export type CnpjLookupSuccess = {
  ok: true;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  inscricao_estadual: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type CnpjLookupResult = CnpjLookupSuccess | { ok: false; message: string };

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  descricao_situacao_cadastral?: string;
};

type MinhaReceitaCnpj = BrasilApiCnpj & {
  inscricao_estadual?: string;
};

function mapSuccess(data: MinhaReceitaCnpj, digits: string): CnpjLookupSuccess {
  const situacao = (data.descricao_situacao_cadastral ?? '').toUpperCase();
  if (situacao && situacao !== 'ATIVA') {
    throw new Error(`CNPJ com situação cadastral: ${data.descricao_situacao_cadastral}.`);
  }

  return {
    ok: true,
    cnpj: digits,
    razao_social: (data.razao_social ?? '').trim(),
    nome_fantasia: (data.nome_fantasia ?? '').trim(),
    inscricao_estadual: (data.inscricao_estadual ?? '').trim(),
    cep: formatCepFromDigits(String(data.cep ?? '')),
    logradouro: (data.logradouro ?? '').trim(),
    numero: (data.numero ?? '').trim() || 'S/N',
    complemento: (data.complemento ?? '').trim(),
    bairro: (data.bairro ?? '').trim(),
    cidade: (data.municipio ?? '').trim(),
    uf: (data.uf ?? '').trim().toUpperCase().slice(0, 2),
  };
}

async function fetchMinhaReceita(digits: string): Promise<CnpjLookupResult> {
  const res = await fetch(`https://minhareceita.org/${digits}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, message: 'CNPJ não encontrado ou consulta indisponível.' };
  }
  const data = (await res.json()) as MinhaReceitaCnpj;
  if (!data.razao_social?.trim()) {
    return { ok: false, message: 'CNPJ não encontrado.' };
  }
  try {
    return mapSuccess(data, digits);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

async function fetchBrasilApi(digits: string): Promise<CnpjLookupResult> {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, message: 'CNPJ não encontrado ou consulta indisponível.' };
  }
  const data = (await res.json()) as BrasilApiCnpj;
  if (!data.razao_social?.trim()) {
    return { ok: false, message: 'CNPJ não encontrado.' };
  }
  try {
    return mapSuccess(data, digits);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Consulta CNPJ na Receita (minhareceita.org com fallback Brasil API). */
export async function fetchCompanyByCnpj(rawCnpj: string): Promise<CnpjLookupResult> {
  const digits = onlyDigitsCnpj(rawCnpj);
  if (digits.length !== 14) {
    return { ok: false, message: 'Informe um CNPJ completo com 14 dígitos.' };
  }

  try {
    const primary = await fetchMinhaReceita(digits);
    if (primary.ok) return primary;
    const fallback = await fetchBrasilApi(digits);
    return fallback;
  } catch {
    try {
      return await fetchBrasilApi(digits);
    } catch {
      return { ok: false, message: 'Erro de rede ao consultar o CNPJ.' };
    }
  }
}
