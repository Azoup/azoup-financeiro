import type { ExportReportPayload } from '@/types/exportReport';
import { shareOrDownloadFile } from '@/utils/exportReportPlatform';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugFilename(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `${base || 'relatorio'}-${date}`;
}

export function buildReportHtml(payload: ExportReportPayload): string {
  const generatedAt = new Date().toLocaleString('pt-BR');
  const sectionsHtml = payload.sections
    .map((sec) => {
      if (sec.kind === 'kv') {
        const rows = sec.items
          .map(
            (it) =>
              `<tr><th style="text-align:left;width:32%;padding:6px 8px;border:1px solid #ddd;background:#f5f5f5">${esc(it.label)}</th><td style="padding:6px 8px;border:1px solid #ddd">${esc(it.value)}</td></tr>`,
          )
          .join('');
        return `<h2 style="font-size:14px;color:#0d3b4f;margin:18px 0 8px">${esc(sec.title)}</h2><table style="width:100%;border-collapse:collapse;font-size:12px">${rows}</table>`;
      }
      const head = sec.columns
        .map((c) => `<th style="padding:6px 8px;border:1px solid #ddd;background:#0d3b4f;color:#fff">${esc(c)}</th>`)
        .join('');
      const body = sec.rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td style="padding:5px 8px;border:1px solid #ddd;vertical-align:top">${esc(c)}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<h2 style="font-size:14px;color:#0d3b4f;margin:18px 0 8px">${esc(sec.title)}</h2><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${esc(payload.title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#222}h1{font-size:20px;color:#0d3b4f;margin:0 0 4px}.sub{font-size:12px;color:#666;margin-bottom:16px}.meta{font-size:11px;color:#888;margin-bottom:20px}</style></head><body>
<h1>${esc(payload.title)}</h1>
${payload.subtitle ? `<p class="sub">${esc(payload.subtitle)}</p>` : ''}
<p class="meta">Gerado em ${esc(generatedAt)} · Sistema Jessica</p>
${sectionsHtml}
</body></html>`;
}

export async function exportReportPdf(payload: ExportReportPayload): Promise<void> {
  const html = buildReportHtml(payload);
  const { uri } = await Print.printToFileAsync({ html });
  const name = `${slugFilename(payload.title)}.pdf`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(uri, '_blank', 'noopener,noreferrer');
    return;
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name });
  }
}

export async function exportReportExcel(payload: ExportReportPayload): Promise<void> {
  const wb = XLSX.utils.book_new();
  const sheets = payload.sheets.length
    ? payload.sheets
    : [
        {
          name: 'Dados',
          columns: ['Campo', 'Valor'],
          rows: payload.sections.flatMap((s) =>
            s.kind === 'kv'
              ? s.items.map((it) => [it.label, it.value])
              : [],
          ),
        },
      ];

  for (const sh of sheets) {
    const aoa = [sh.columns, ...sh.rows.map((r) => r.map((c) => (c == null ? '' : c)))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const safeName = sh.name.replace(/[\\/?*[\]]/g, '').slice(0, 31) || 'Planilha';
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const filename = `${slugFilename(payload.title)}.xlsx`;

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    XLSX.writeFile(wb, filename);
    return;
  }

  const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  await shareOrDownloadFile(
    filename,
    base64,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
