import type { EmitirBoletoEmailResult, EmitirBoletoLoteResult } from '@/types/sicoob';

/** Monta mensagem curta sobre envio automático de e-mail após emitir boletos. */
export function resumoEmailBoletosLote(lote: EmitirBoletoLoteResult | null | undefined): string | null {
  if (!lote?.resultados?.length) return null;

  const emails = lote.resultados.map((r) => r.email).filter(Boolean) as EmitirBoletoEmailResult[];
  if (!emails.length) return null;

  const enviados = emails.filter((e) => e.enviado);
  const semCadastro = emails.filter((e) => e.skipped && e.reason === 'sem_email_cadastro');
  const semPdf = emails.filter((e) => e.skipped && e.reason === 'sem_pdf');
  const semConfig = emails.filter((e) => e.skipped && e.reason === 'email_nao_configurado');
  const erros = emails.filter((e) => !e.enviado && !e.skipped);

  const partes: string[] = [];
  if (enviados.length === 1 && enviados[0].to) {
    partes.push(`Boleto enviado para ${enviados[0].to}`);
  } else if (enviados.length > 1) {
    partes.push(`${enviados.length} boletos enviados por e-mail`);
  }
  if (semCadastro.length) {
    partes.push(
      semCadastro.length === 1
        ? 'Cliente sem e-mail no cadastro'
        : `${semCadastro.length} clientes sem e-mail no cadastro`,
    );
  }
  if (semPdf.length) {
    partes.push(
      semPdf.length === 1
        ? 'PDF ainda indisponível para e-mail (use Registrar no C6)'
        : `${semPdf.length} sem PDF para e-mail`,
    );
  }
  if (semConfig.length) {
    partes.push('Configure RESEND_API_KEY na Vercel para envio automático');
  }
  if (erros.length) {
    const msg = erros[0].error || 'falha no envio';
    partes.push(
      erros.length === 1 ? `E-mail não enviado: ${msg}` : `${erros.length} e-mails com erro (${msg})`,
    );
  }

  return partes.length ? partes.join(' · ') : null;
}
