import { supabase } from '@/lib/supabase';
import type { BoletoParcelaVendaRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import * as Print from 'expo-print';
import { Linking, Platform } from 'react-native';

function storageBucket(row: BoletoParcelaVendaRow): string {
  return row.tipo_emissao === 'c6' ? 'boletos_c6' : 'boletos_sicoob';
}

/** Renova URL assinada do PDF oficial (Sicoob/C6) quando existir no Storage. */
export async function resolveBoletoPdfUrl(row: BoletoParcelaVendaRow): Promise<string | null> {
  const podeUsarPdf =
    row.status_registro === 'registrado' ||
    row.status_registro === 'pago' ||
    row.status_registro === 'baixado';

  if (row.pdf_url && podeUsarPdf) {
    return row.pdf_url;
  }

  if (row.pdf_storage_path && podeUsarPdf) {
    const { data, error } = await supabase.storage
      .from(storageBucket(row))
      .createSignedUrl(row.pdf_storage_path, 60 * 60 * 24);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

function openHtmlInNewTabWeb(html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Popup bloqueado: baixa o HTML
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boleto.html';
    a.click();
  }
  // Libera depois (aba já carregou o blob)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openExternalUrl(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const ok = await Linking.canOpenURL(url);
  if (!ok) throw new Error('Não foi possível abrir o arquivo.');
  await Linking.openURL(url);
}

/**
 * Abre PDF oficial do banco ou carnê HTML.
 * No web, NÃO usa Print.printToFileAsync (imprime a tela do app).
 */
export async function abrirDocumentoBoleto(row: BoletoParcelaVendaRow): Promise<void> {
  const pdfUrl = await resolveBoletoPdfUrl(row);
  if (pdfUrl) {
    await openExternalUrl(pdfUrl);
    return;
  }

  const html = buildBoletoCobrancaHtml(row);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    openHtmlInNewTabWeb(html);
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  await openExternalUrl(uri);
}
