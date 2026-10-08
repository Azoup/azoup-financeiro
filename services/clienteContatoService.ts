import { supabase } from '@/lib/supabase';
import { safeTrim } from '@/utils/safeTrim';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValido(email: unknown): boolean {
  const s = safeTrim(email);
  return Boolean(s) && EMAIL_RE.test(s);
}

/** Todos os e-mails cadastrados em contatos_cliente (tipo email), sem repetir. */
export async function fetchEmailsCliente(clienteId: unknown): Promise<string[]> {
  const id = safeTrim(clienteId);
  if (!id) return [];
  const { data, error } = await supabase
    .from('contatos_cliente')
    .select('valor_contato')
    .eq('cliente_id', id)
    .eq('tipo_contato', 'email')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const emails: string[] = [];
  const vistos = new Set<string>();
  for (const row of (data ?? []) as { valor_contato?: unknown }[]) {
    const email = safeTrim(row?.valor_contato);
    if (!isEmailValido(email)) continue;
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    emails.push(email);
  }
  return emails;
}

/** E-mails do cliente, separados por vírgula. */
export async function fetchEmailCliente(clienteId: unknown): Promise<string | null> {
  const emails = await fetchEmailsCliente(clienteId);
  return emails.length ? emails.join(', ') : null;
}
