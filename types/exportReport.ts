export type ExportKvSection = {
  kind: 'kv';
  title: string;
  items: { label: string; value: string }[];
};

export type ExportTableSection = {
  kind: 'table';
  title: string;
  columns: string[];
  rows: string[][];
};

export type ExportSection = ExportKvSection | ExportTableSection;

export type ExportExcelSheet = {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
};

export type ExportReportPayload = {
  title: string;
  subtitle?: string;
  sections: ExportSection[];
  sheets: ExportExcelSheet[];
};
