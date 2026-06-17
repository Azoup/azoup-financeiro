import type { ContatoClienteInput } from '@/types/models';
import { parseBRLMasked } from '@/utils/currency';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): boolean {
  return emailRe.test(value.trim());
}

export function validateWhatsAppDigits(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11;
}

function contatoLinhaVazia(c: ContatoClienteInput): boolean {
  return !c.nome_contato.trim() && !c.valor_contato.trim();
}

export function validateClienteForm(params: {
  documento: string;
  cnpj?: string;
  nome_cliente: string;
  valor_mensalidade: string;
  contatos: ContatoClienteInput[];
  uf?: string;
}): string | null {
  const cnpjDigits = (params.cnpj ?? params.documento).replace(/\D/g, '');
  if (cnpjDigits.length > 0 && cnpjDigits.length !== 14) {
    return 'CNPJ incompleto — informe os 14 dígitos ou deixe vazio para ZPF.';
  }
  if (!params.nome_cliente.trim()) return 'Informe o nome do cliente.';
  const v = parseBRLMasked(params.valor_mensalidade);
  if (v == null || v <= 0) return 'Informe um valor de mensalidade válido.';
  const uf = params.uf?.trim() ?? '';
  if (uf.length === 1) return 'UF deve ter 2 letras ou ficar vazio.';
  if (uf.length > 2) return 'UF inválida.';
  for (const c of params.contatos) {
    if (contatoLinhaVazia(c)) continue;
    if (!c.nome_contato.trim()) {
      return 'Há contato com WhatsApp ou e-mail preenchido sem nome. Informe o nome ou apague a linha.';
    }
    if (!c.valor_contato.trim()) {
      return 'Preencha o WhatsApp ou o e-mail de todos os contatos que tiverem nome.';
    }
    if (c.tipo_contato === 'email' && !validateEmail(c.valor_contato)) {
      return `E-mail inválido para o contato "${c.nome_contato}".`;
    }
    if (c.tipo_contato === 'whatsapp' && !validateWhatsAppDigits(c.valor_contato)) {
      return `WhatsApp inválido para o contato "${c.nome_contato}".`;
    }
  }
  return null;
}
