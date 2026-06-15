import { supabase } from '@/lib/supabase';
import type { TipoRamoRow } from '@/types/models';

/** Lista apenas tipos cadastrados no Supabase (tabela tipos_ramo). */
export async function fetchTiposRamo(): Promise<string[]> {
  const { data, error } = await supabase
    .from('tipos_ramo')
    .select('nome')
    .order('nome', { ascending: true });

  if (error) {
    console.warn('tipos_ramo:', error.message);
    return [];
  }

  const rows = (data as Pick<TipoRamoRow, 'nome'>[] | null) ?? [];
  return rows.map((r) => r.nome).filter(Boolean);
}

export async function insertTipoRamo(nome: string): Promise<{ error: string | null }> {
  const trimmed = nome.trim();
  if (!trimmed) return { error: 'Nome vazio.' };

  const { error } = await supabase.from('tipos_ramo').insert({ nome: trimmed });
  if (error) {
    if (error.code === '23505') return { error: 'Este tipo já existe.' };
    return { error: error.message };
  }
  return { error: null };
}
