import * as Print from 'expo-print';
import { Platform } from 'react-native';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

/**
 * Converte HTML em PDF sem abrir o diálogo de impressão do navegador.
 * No web usa iframe oculto + html2canvas + jsPDF; no nativo usa expo-print.
 */
export async function htmlParaPdfBlob(html: string): Promise<Blob> {
  if (!isWeb()) {
    const { uri } = await Print.printToFileAsync({ html });
    const res = await fetch(uri);
    const blob = await res.blob();
    if (blob.type === 'application/pdf') return blob;
    return new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Não foi possível montar o documento para PDF.');
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => setTimeout(r, 350));
    const imgs = [...doc.images];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    );
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready.catch(() => undefined);

    const alvo = (doc.body as HTMLElement) ?? doc.documentElement;
    const altura = Math.max(alvo.scrollHeight, alvo.getBoundingClientRect().height, 1123);
    iframe.style.height = `${Math.ceil(altura) + 16}px`;

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
    const img = canvas.toDataURL('image/jpeg', 0.92);
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
