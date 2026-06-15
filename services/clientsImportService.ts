import { createCliente } from '@/services/clientsService';
import type { ParsedImportClienteRow } from '@/utils/recFixoSpreadsheetImport';

export type ImportClientesResult = {
  created: number;
  failed: { lineNumber: number; message: string }[];
};

export async function importClienteRowsSequential(
  userId: string,
  rows: ParsedImportClienteRow[],
  onProgress?: (completed: number, total: number) => void,
): Promise<ImportClientesResult> {
  const failed: { lineNumber: number; message: string }[] = [];
  let created = 0;
  const total = rows.length;
  let completed = 0;

  for (const { lineNumber, values } of rows) {
    try {
      await createCliente(userId, values);
      created++;
    } catch (e) {
      failed.push({ lineNumber, message: (e as Error).message });
    }
    completed += 1;
    onProgress?.(completed, total);
  }

  return { created, failed };
}
