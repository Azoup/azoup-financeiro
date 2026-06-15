import { supabase } from '@/lib/supabase';
import type { SegmentoClienteRow } from '@/types/models';

let nomePorCodigoCache: Map<string, string> | null = null;
let nomePorCodigoCacheAt = 0;
const NOME_POR_CODIGO_TTL_MS = 60_000;

export function invalidateSegmentoNomeCache(): void {
  nomePorCodigoCache = null;
  nomePorCodigoCacheAt = 0;
}

/** Código em maiúsculas; letras, números e sublinhado. */
export function normalizeSegmentoCodigo(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

/** Mapa codigo → nome (cache; evita embed PostgREST em clientes). */
export async function getSegmentoNomePorCodigo(): Promise<Map<string, string>> {
  const now = Date.now();
  if (nomePorCodigoCache && now - nomePorCodigoCacheAt < NOME_POR_CODIGO_TTL_MS) {
    return nomePorCodigoCache;
  }
  const list = await fetchSegmentosCliente();
  nomePorCodigoCache = new Map(list.map((s) => [s.codigo, s.nome]));
  nomePorCodigoCacheAt = now;
  return nomePorCodigoCache;
}

/** Lista segmentos cadastrados (ordem definida na tabela). */
export async function fetchSegmentosCliente(): Promise<SegmentoClienteRow[]> {
  const { data, error } = await supabase
    .from('segmento_cliente')
    .select('codigo, nome, ordem')
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });

  if (error) {
    console.warn('segmento_cliente:', error.message);
    return [];
  }
  return (data as SegmentoClienteRow[] | null) ?? [];
}

/** Quantidade de clientes que usam o segmento (RLS do usuário). */
export async function countClientesComSegmento(segmentoCodigo: string): Promise<number> {
  const { count, error } = await supabase
    .from('clientes')
    .select('id', { count: 'exact', head: true })
    .eq('segmento_cliente_codigo', segmentoCodigo.trim());

  if (error) {
    console.warn('countClientesComSegmento:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function insertSegmentoCliente(input: { codigo: string; nome: string }): Promise<void> {
  const codigo = normalizeSegmentoCodigo(input.codigo);
  if (!codigo) {
    throw new Error('Informe o código do segmento (apenas letras, números e sublinhado).');
  }
  const nome = input.nome.trim();
  if (!nome) {
    throw new Error('Informe o nome do segmento.');
  }

  const list = await fetchSegmentosCliente();
  const maxOrdem = list.reduce((m, s) => Math.max(m, Number(s.ordem) || 0), 0);

  const { error } = await supabase.from('segmento_cliente').insert({
    codigo,
    nome,
    ordem: maxOrdem + 10,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error('Já existe um segmento com este código.');
    }
    throw new Error(error.message);
  }
  invalidateSegmentoNomeCache();
}

export async function deleteSegmentoCliente(codigo: string): Promise<void> {
  const c = codigo.trim();
  if (!c) return;

  const emUso = await countClientesComSegmento(c);
  if (emUso > 0) {
    throw new Error(
      `Não é possível excluir: ${emUso} cliente(s) usam este segmento. Altere o segmento desses clientes antes.`,
    );
  }

  const { data, error } = await supabase
    .from('segmento_cliente')
    .delete()
    .eq('codigo', c)
    .select('codigo');

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Este segmento ainda está em uso por clientes (de outras contas ou não visíveis aqui). Não foi possível excluir.',
      );
    }
    if (error.code === '42501' || error.message.toLowerCase().includes('policy')) {
      throw new Error(
        'Sem permissão para excluir segmentos. Aplique a migration 012_segmento_cliente_write_policies no Supabase.',
      );
    }
    throw new Error(error.message);
  }

  if (!data?.length) {
    throw new Error(
      'Não foi possível excluir o segmento (não encontrado ou sem permissão). Verifique as políticas RLS no Supabase.',
    );
  }

  invalidateSegmentoNomeCache();
}
