import { supabase } from '@/lib/supabase';
import { boletoApiBaseUrl } from '@/services/sicoobBoletoService';
import type { ContaReceberListRow } from '@/types/contasReceber';
import type { EmitirBoletoEmailResult } from '@/types/sicoob';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { safeTrim } from '@/utils/safeTrim';

export function buildCorpoEmailBoleto(row: ContaReceberListRow): string {
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const linhas = [
    `Olá, ${safeTrim(row.nome_cliente) || 'cliente'}!`,
    '',
    'Segue o boleto para pagamento:',
    `• ${safeTrim(row.referencia_label) || 'Cobrança'}`,
    `• Valor: ${formatBRL(row.valor_documento)}`,
    `• Vencimento: ${venc}`,
    row.numero_documento ? `• Documento: ${safeTrim(row.numero_documento)}` : null,
    row.linha_digitavel ? `\nLinha digitável:\n${safeTrim(row.linha_digitavel)}` : null,
    row.pix_copia_cola ? `\nPix Copia e Cola:\n${safeTrim(row.pix_copia_cola)}` : null,
    '',
    'O boleto segue em anexo.',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
  ].filter((l): l is string => l != null);
  return linhas.join('\n');
}

/** Envia o PDF do boleto direto via Resend (mesmo fluxo da emissão). Não abre Outlook/.eml. */
export async function enviarBoletoPorEmailDireto(boletoId: string): Promise<EmitirBoletoEmailResult> {
  const id = safeTrim(boletoId);
  if (!id) throw new Error('Boleto não identificado.');

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = boletoApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const res = await fetch(`${base}/api/boleto/emitir-lote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'enviar-email-boleto', boletoId: id }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    email?: EmitirBoletoEmailResult;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Falha ao enviar e-mail (${res.status}).`);
  }

  return body.email ?? { skipped: true, reason: 'sem_resposta' };
}

function mensagemEmailResultado(email: EmitirBoletoEmailResult): { type: 'success' | 'info' | 'error'; text1: string; text2?: string } {
  if (email.enviado && email.to) {
    return {
      type: 'success',
      text1: 'Boleto enviado por e-mail.',
      text2: `Destinatário: ${email.to}`,
    };
  }
  if (email.skipped) {
    const reason = email.reason ?? '';
    if (reason === 'sem_email_cadastro') {
      return {
        type: 'info',
        text1: 'Cliente sem e-mail no cadastro.',
        text2: 'Cadastre um contato tipo e-mail no cliente e tente de novo.',
      };
    }
    if (reason === 'sem_pdf') {
      return {
        type: 'info',
        text1: 'PDF do boleto ainda indisponível.',
        text2: email.to
          ? 'Use “Registrar no C6” (ou aguarde o PDF) e envie de novo.'
          : 'Gere o PDF do boleto e tente novamente.',
      };
    }
    if (reason === 'email_nao_configurado') {
      return {
        type: 'error',
        text1: 'Envio automático não configurado.',
        text2: 'Configure RESEND_API_KEY na Vercel e verifique o domínio no Resend.',
      };
    }
    return {
      type: 'info',
      text1: 'E-mail não enviado.',
      text2: reason || 'Não foi possível enviar agora.',
    };
  }
  return {
    type: 'error',
    text1: 'E-mail não enviado.',
    text2: email.error || 'Falha no Resend.',
  };
}

/** Compat: mesmo nome usado pela tela Contas a receber — agora envia direto. */
export async function compartilharBoletoPorEmail(row: ContaReceberListRow): Promise<{
  email: string | null;
  resultado: 'enviado' | 'ignorado' | 'erro';
}> {
  if (!row.id) throw new Error('Boleto não identificado.');
  if (row.tipo_emissao === 'c6' && !row.linha_digitavel && !row.pdf_url) {
    throw new Error(
      safeTrim(row.mensagem_erro_registro) ||
        'Boleto C6 ainda não registrado. Use “Registrar no C6” antes de enviar.',
    );
  }
  const result = await enviarBoletoPorEmailDireto(row.id);
  if (result.enviado) return { email: result.to ?? null, resultado: 'enviado' };
  if (result.skipped) return { email: result.to ?? null, resultado: 'ignorado' };
  throw new Error(result.error || 'Falha ao enviar e-mail do boleto.');
}

export async function compartilharBoletoComFeedback(row: ContaReceberListRow): Promise<void> {
  const Toast = (await import('react-native-toast-message')).default;
  if (!row.id) throw new Error('Boleto não identificado.');
  if (row.tipo_emissao === 'c6' && !row.linha_digitavel && !row.pdf_url) {
    throw new Error(
      safeTrim(row.mensagem_erro_registro) ||
        'Boleto C6 ainda não registrado. Use “Registrar no C6” antes de enviar.',
    );
  }
  const result = await enviarBoletoPorEmailDireto(row.id);
  const msg = mensagemEmailResultado(result);
  Toast.show({
    type: msg.type,
    text1: msg.text1,
    text2: msg.text2,
    visibilityTime: 8000,
  });
}
