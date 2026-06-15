export type ViaCepSuccess = {
  ok: true;
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
};

export type ViaCepResult = ViaCepSuccess | { ok: false; message: string };

/** Busca endereço na API pública ViaCEP (somente CEP brasileiro). */
export async function fetchAddressByCep(rawCep: string): Promise<ViaCepResult> {
  const digits = rawCep.replace(/\D/g, '');
  if (digits.length !== 8) {
    return { ok: false, message: 'Informe um CEP com 8 dígitos.' };
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { ok: false, message: 'Não foi possível consultar o CEP.' };
    }
    const data = (await res.json()) as {
      erro?: boolean;
      cep?: string;
      logradouro?: string;
      complemento?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };

    if (data.erro) {
      return { ok: false, message: 'CEP não encontrado.' };
    }

    return {
      ok: true,
      cep: data.cep ?? `${digits.slice(0, 5)}-${digits.slice(5)}`,
      logradouro: (data.logradouro ?? '').trim(),
      complemento: (data.complemento ?? '').trim(),
      bairro: (data.bairro ?? '').trim(),
      localidade: (data.localidade ?? '').trim(),
      uf: (data.uf ?? '').trim().slice(0, 2).toUpperCase(),
    };
  } catch {
    return { ok: false, message: 'Erro de rede ao buscar o CEP.' };
  }
}
