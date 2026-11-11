import { supabase } from '@/lib/supabase';
import { enderecoPagadorAtualDoBoleto } from '@/services/boletoParcelaService';
import type { BoletoParcelaVendaRow } from '@/types/contasReceber';
import { calcularEncargosBoleto } from '@/utils/boletoEncargos';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { htmlParaPdfBlob } from '@/utils/htmlParaPdf';
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

function boletoComEncargos(row: BoletoParcelaVendaRow): boolean {
  if (row.status_registro === 'pago' || row.status_registro === 'baixado') return false;
  return calcularEncargosBoleto(row.valor_documento, row.data_vencimento).vencido;
}

function baixarBlobWeb(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Abre PDF oficial do banco ou carnê com multa/juros.
 * Boleto vencido em aberto: gera PDF com valor atualizado (não o PDF oficial de face).
 * Boleto C6 sem registro: não abre carnê (não é boleto bancário pagável).
 */
export async function abrirDocumentoBoleto(row: BoletoParcelaVendaRow): Promise<void> {
  const comEncargos = boletoComEncargos(row);

  if (!comEncargos) {
    const pdfUrl = await resolveBoletoPdfUrl(row);
    if (pdfUrl) {
      await openExternalUrl(pdfUrl);
      return;
    }
  }

  if (
    row.tipo_emissao === 'c6' &&
    !(row.linha_digitavel && row.status_registro === 'registrado')
  ) {
    throw new Error(
      row.mensagem_erro_registro?.trim() ||
        'Boleto C6 ainda não registrado no banco. Use “Registrar no C6” para gerar o boleto real (PDF/linha digitável).',
    );
  }

  const pagadorAtual = await enderecoPagadorAtualDoBoleto(row).catch(() => null);
  const html = buildBoletoCobrancaHtml(pagadorAtual ? { ...row, ...pagadorAtual } : row);
  const filename = `boleto_${(row.numero_documento || row.id || 'cobranca').toString().replace(/[^\w.-]+/g, '_')}.pdf`;

  // Atrasado: sempre PDF com mora/juros (evita baixar o oficial sem encargos).
  // No web NÃO usa expo-print — abre o diálogo de impressão da tela do app.
  if (comEncargos) {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const blob = await htmlParaPdfBlob(html);
        baixarBlobWeb(blob, filename);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      await openExternalUrl(uri);
      return;
    } catch {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        openHtmlInNewTabWeb(html);
        return;
      }
      throw new Error('Não foi possível gerar o PDF com juros do atraso.');
    }
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    openHtmlInNewTabWeb(html);
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  await openExternalUrl(uri);
}
