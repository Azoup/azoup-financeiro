import { PrimaryButton } from '@/components/PrimaryButton';
import type { ExportReportPayload } from '@/types/exportReport';
import { exportReportExcel, exportReportPdf } from '@/utils/exportReport';
import { colors, spacing } from '@/theme/colors';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Toast from 'react-native-toast-message';

type Props = {
  getReport: () => ExportReportPayload | Promise<ExportReportPayload>;
  disabled?: boolean;
  /** Botões menores (PDF / Excel) para barras de ferramenta compactas. */
  compact?: boolean;
  style?: ViewStyle;
};

export function ExportReportButtons({ getReport, disabled, compact, style }: Props) {
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);

  const run = async (kind: 'pdf' | 'excel') => {
    setBusy(kind);
    try {
      const payload = await getReport();
      if (!payload.sections.length && !payload.sheets.length) {
        Toast.show({ type: 'info', text1: 'Não há dados para exportar.' });
        return;
      }
      if (kind === 'pdf') await exportReportPdf(payload);
      else await exportReportExcel(payload);
      Toast.show({ type: 'success', text1: kind === 'pdf' ? 'PDF gerado.' : 'Excel gerado.' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.row, compact && styles.rowCompact, style]}>
      <PrimaryButton
        title="Gerar PDF"
        variant="secondary"
        size={compact ? 'compact' : 'default'}
        loading={busy === 'pdf'}
        disabled={disabled || busy != null}
        onPress={() => void run('pdf')}
        style={[styles.btn, compact && styles.btnCompact]}
      />
      <PrimaryButton
        title="Gerar Excel"
        variant="secondary"
        size={compact ? 'compact' : 'default'}
        loading={busy === 'excel'}
        disabled={disabled || busy != null}
        onPress={() => void run('excel')}
        style={[styles.btn, compact && styles.btnCompact]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rowCompact: {
    flex: 1.15,
    gap: spacing.xs,
    marginBottom: 0,
    minWidth: 0,
  },
  btn: {
    flex: 1,
  },
  btnCompact: {
    flex: 1,
    minWidth: 108,
    backgroundColor: colors.white,
    borderColor: colors.gray200,
  },
});
