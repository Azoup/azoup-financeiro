import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { fetchDanfseHtml } from '@/utils/danfseDocumento';
import { safeTrim } from '@/utils/safeTrim';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type ArquivoNota = { filename: string; data: Uint8Array };

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

function nomeBase(item: Pick<NotaFiscalListRow, 'serie' | 'numero' | 'cliente'>): string {
  const numero = safeTrim(item.numero) || 's_numero';
  const cli = safeTrim(item.cliente?.nome_cliente)
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cli ? `NFS-e ${numero} — ${cli}` : `NFS-e ${numero}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function htmlSemBotaoImprimir(html: string): string {
  return html.replace(/<p class="noprint"[\s\S]*?<\/p>/gi, '');
}

/** Converte o HTML da DANFSe em PDF sem abrir aba nem diálogo de impressão da tela. */
export async function htmlDanfseParaPdf(html: string): Promise<Blob> {
  const limpo = htmlSemBotaoImprimir(html);
  if (!isWeb()) {
    const { uri } = await Print.printToFileAsync({ html: limpo });
    const res = await fetch(uri);
    return res.blob();
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.style.cssText =
    'position:fixed;left:0;top:0;width:210mm;height:297mm;border:0;z-index:-1;background:#fff;pointer-events:none';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Não foi possível montar a DANFE.');
    doc.open();
    doc.write(limpo);
    doc.close();
    await new Promise((r) => setTimeout(r, 350));
    const imgs = [...doc.images];
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = () => resolve(undefined);
                img.onerror = () => resolve(undefined);
              }),
      ),
    );
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready.catch(() => undefined);
    const alvo = (doc.querySelector('.page') as HTMLElement | null) ?? doc.body;
    const altura = Math.max(alvo.scrollHeight, alvo.getBoundingClientRect().height, 1123);
    iframe.style.height = `${Math.ceil(altura) + 16}px`;
    iframe.style.width = '210mm';
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(alvo, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: 794,
      scrollX: 0,
      scrollY: 0,
    });
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210;
    const pageH = 297;
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.95);
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, 'JPEG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 2) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}

export async function baixarDanfePdf(item: NotaFiscalListRow): Promise<void> {
  const { html } = await fetchDanfseHtml(item);
  const blob = await htmlDanfseParaPdf(html);
  const filename = `${nomeBase(item)}.pdf`;
  if (isWeb()) {
    downloadBlob(blob, filename);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html: htmlSemBotaoImprimir(html) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: filename });
  }
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function montarArquivosNota(item: NotaFiscalListRow): Promise<ArquivoNota[]> {
  const arquivos: ArquivoNota[] = [];
  const base = nomeBase(item);
  const { html } = await fetchDanfseHtml(item);
  arquivos.push({ filename: `${base}.pdf`, data: await blobToBytes(await htmlDanfseParaPdf(html)) });
  const xml = typeof item.xml_autorizado === 'string' ? item.xml_autorizado.trim() : '';
  if (xml) {
    arquivos.push({ filename: `${base}.xml`, data: new TextEncoder().encode(xml) });
  }
  return arquivos;
}

type DirectoryHandle = {
  getFileHandle: (name: string, opts: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

export async function escolherPastaDownload(): Promise<DirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (opts: { mode: string }) => Promise<DirectoryHandle> })
    .showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  return picker({ mode: 'readwrite' });
}

export async function salvarArquivosNaPasta(dir: DirectoryHandle, arquivos: ArquivoNota[]): Promise<void> {
  for (const arq of arquivos) {
    const handle = await dir.getFileHandle(arq.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(arq.data);
    await writable.close();
  }
}

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** ZIP sem compressão — fallback quando o navegador não deixa escolher pasta. */
export function zipStore(files: ArquivoNota[]): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const file of files) {
    const name = enc.encode(file.filename);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.data);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const chunks = [...parts, ...central, end];
  const total = chunks.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return new Blob([out], { type: 'application/zip' });
}

/** Escolhe a pasta na hora do clique e grava DANFE + XML. Sem seletor, baixa um ZIP. */
export async function baixarLoteDanfeXml(itens: NotaFiscalListRow[]): Promise<{
  arquivos: number;
  falhas: number;
  modo: 'pasta' | 'zip' | 'cancelado';
}> {
  if (!itens.length) throw new Error('Selecione ao menos uma nota.');

  let dir: DirectoryHandle | null = null;
  if (isWeb()) {
    try {
      dir = await escolherPastaDownload();
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'AbortError') return { arquivos: 0, falhas: 0, modo: 'cancelado' };
      dir = null;
    }
  }

  const arquivos: ArquivoNota[] = [];
  let falhas = 0;
  for (const item of itens) {
    try {
      arquivos.push(...(await montarArquivosNota(item)));
    } catch {
      falhas += 1;
    }
  }
  if (!arquivos.length) {
    throw new Error('Não foi possível gerar a DANFE das notas selecionadas.');
  }

  if (dir) {
    await salvarArquivosNaPasta(dir, arquivos);
    return { arquivos: arquivos.length, falhas, modo: 'pasta' };
  }

  const zip = zipStore(arquivos);
  const nome = `NFS-e_${new Date().toISOString().slice(0, 10)}.zip`;
  if (isWeb()) {
    downloadBlob(zip, nome);
    return { arquivos: arquivos.length, falhas, modo: 'zip' };
  }

  const FileSystem = await import('expo-file-system/legacy');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const path = `${FileSystem.cacheDirectory ?? ''}${nome}`;
  await FileSystem.writeAsStringAsync(path, btoa(bin), { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/zip', dialogTitle: nome });
  }
  return { arquivos: arquivos.length, falhas, modo: 'zip' };
}
