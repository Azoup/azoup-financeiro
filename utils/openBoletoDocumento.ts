import { supabase } from '@/lib/supabase';
import type { BoletoParcelaVendaRow } from '@/types/contasReceber';
import { htmlDanfseParaPdf } from '@/utils/baixarDanfseArquivos';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { safeTrim } from '@/utils/safeTrim';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
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

async function openExternalUrl(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const ok = await Linking.canOpenURL(url);
  if (!ok) throw new Error('Não foi possível abrir o arquivo.');
  await Linking.openURL(url);
}

async function clienteIdDoBoleto(row: BoletoParcelaVendaRow): Promise<string | null> {
  const direto = safeTrim((row as BoletoParcelaVendaRow & { cliente_id?: string | null }).cliente_id);
  if (direto) return direto;
  if (row.mensalidade_id) {
    const { data } = await supabase
      .from('mensalidades')
      .select('cliente_id')
      .eq('id', row.mensalidade_id)
      .maybeSingle();
    const id = safeTrim((data as { cliente_id?: string | null } | null)?.cliente_id);
    if (id) return id;
  }
  if (row.venda_id) {
    const { data } = await supabase.from('vendas').select('cliente_id').eq('id', row.venda_id).maybeSingle();
    const id = safeTrim((data as { cliente_id?: string | null } | null)?.cliente_id);
    if (id) return id;
  }
  return null;
}

/** Nome da empresa no cadastro. Se estiver vazio, usa o nome do cliente já gravado no carnê. */
export async function nomeEmpresaPagador(row: BoletoParcelaVendaRow): Promise<string> {
  const clienteId = await clienteIdDoBoleto(row);
  if (!clienteId) return row.pagador_nome;
  const { data } = await supabase.from('clientes').select('nome, nome_fantasia').eq('id', clienteId).maybeSingle();
  const empresa = safeTrim((data as { nome?: string | null } | null)?.nome);
  const fantasia = safeTrim((data as { nome_fantasia?: string | null } | null)?.nome_fantasia);
  return empresa || fantasia || row.pagador_nome;
}

function nomeArquivoBoleto(row: BoletoParcelaVendaRow): string {
  const doc = safeTrim(row.numero_documento).replace(/[<>:"/\\|?*]+/g, '').slice(0, 40);
  return `boleto_${doc || row.id}.pdf`;
}

function baixarBlob(blob: Blob, filename: string): void {
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

/** PDF para o cliente: nome da empresa, mesma linha digitável e o mesmo código de barras do banco. */
export async function pdfBoletoParaCliente(row: BoletoParcelaVendaRow): Promise<Blob> {
  const pagador_nome = await nomeEmpresaPagador(row);
  const html = buildBoletoCobrancaHtml({ ...row, pagador_nome });
  return htmlDanfseParaPdf(html);
}

/**
 * Baixa o PDF com o nome da empresa para enviar ao cliente.
 * Não abre o PDF do banco, que ficou com o nome antigo.
 * Boleto C6 sem registro: não gera arquivo pagável.
 */
export async function abrirDocumentoBoleto(row: BoletoParcelaVendaRow): Promise<void> {
  if (row.tipo_emissao === 'c6' && !row.linha_digitavel && row.status_registro !== 'registrado' && row.status_registro !== 'pago') {
    throw new Error(
      row.mensagem_erro_registro?.trim() ||
        'Boleto C6 ainda não registrado no banco. Use “Registrar no C6” para gerar o boleto real (PDF/linha digitável).',
    );
  }

  const pagador_nome = await nomeEmpresaPagador(row);
  const html = buildBoletoCobrancaHtml({ ...row, pagador_nome });
  const filename = nomeArquivoBoleto(row);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = await htmlDanfseParaPdf(html);
    baixarBlob(blob, filename);
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
    return;
  }
  await openExternalUrl(uri);
}
