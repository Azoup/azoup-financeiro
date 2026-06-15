import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import { importClienteRowsSequential } from '@/services/clientsImportService';
import type { ParsedImportClienteRow } from '@/utils/recFixoSpreadsheetImport';
import { parseRecFixoSpreadsheet } from '@/utils/recFixoSpreadsheetImport';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

const SHEET_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/comma-separated-values',
] as const;

type Props = {
  visible: boolean;
  userId: string | undefined;
  onClose: () => void;
  onImported: () => void;
};

export function ImportClientsModal({ visible, userId, onClose, onImported }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [parsed, setParsed] = useState<ParsedImportClienteRow[] | null>(null);
  const [skipped, setSkipped] = useState<{ lineNumber: number; reason: string }[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastResult, setLastResult] = useState<{
    created: number;
    failed: { lineNumber: number; message: string }[];
  } | null>(null);

  const resetState = useCallback(() => {
    setFileName(null);
    setParsed(null);
    setSkipped([]);
    setParseError(null);
    setImporting(false);
    setProgress({ done: 0, total: 0 });
    setLastResult(null);
  }, []);

  const handleClose = () => {
    if (importing) return;
    resetState();
    onClose();
  };

  const pickFile = async () => {
    setParseError(null);
    setParsed(null);
    setSkipped([]);
    setLastResult(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: [...SHEET_TYPES],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset?.uri) {
      setParseError('Arquivo inválido.');
      return;
    }
    setFileName(asset.name ?? 'planilha');
    setLoadingFile(true);
    try {
      const r = await fetch(asset.uri);
      const buf = await r.arrayBuffer();
      const result = parseRecFixoSpreadsheet(buf);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      setParsed(result.rows);
      setSkipped(result.skipped);
      if (result.rows.length === 0) {
        setParseError('Nenhuma linha de cliente válida encontrada após o cabeçalho.');
      }
    } catch {
      setParseError('Não foi possível ler o arquivo.');
    } finally {
      setLoadingFile(false);
    }
  };

  const runImport = async () => {
    if (!userId || !parsed?.length) return;
    setImporting(true);
    setLastResult(null);
    setProgress({ done: 0, total: parsed.length });
    try {
      const { created, failed } = await importClienteRowsSequential(userId, parsed, (done, total) =>
        setProgress({ done, total }),
      );
      setLastResult({ created, failed });
      if (created > 0) {
        Toast.show({
          type: 'success',
          text1: `${created} cliente(s) importado(s).`,
        });
        onImported();
      }
      if (failed.length) {
        Toast.show({
          type: 'error',
          text1: `${failed.length} linha(s) com erro.`,
        });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} disabled={importing} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Importar clientes</Text>
          <Text style={styles.hint}>
            Use a mesma estrutura da planilha &quot;Rec. fixo sistema&quot; (colunas Cliente, Valor, Empresa, Tipo
            Comercialização, Data Inclusão, etc.). O documento fica vazio para gerar ZPF automático. Contatos podem ser
            incluídos depois no cadastro.
          </Text>

          <PrimaryButton title="Escolher arquivo (.xls, .xlsx, .csv)" variant="secondary" onPress={pickFile} />

          {loadingFile ? (
            <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.orange} />
          ) : null}

          {fileName ? (
            <Text style={styles.fileName} numberOfLines={2}>
              Arquivo: {fileName}
            </Text>
          ) : null}

          {parseError ? <Text style={styles.error}>{parseError}</Text> : null}

          {parsed && parsed.length > 0 ? (
            <Text style={styles.summary}>
              {parsed.length} cliente(s) pronto(s) para importar.
              {skipped.length > 0 ? ` ${skipped.length} linha(s) ignorada(s).` : ''}
            </Text>
          ) : null}

          {skipped.length > 0 ? (
            <ScrollView style={styles.skipList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <Text style={styles.skipTitle}>Linhas ignoradas</Text>
              {skipped.slice(0, 80).map((s, idx) => (
                <Text key={`skip-${s.lineNumber}-${idx}`} style={styles.skipRow}>
                  Linha {s.lineNumber}: {s.reason}
                </Text>
              ))}
              {skipped.length > 80 ? (
                <Text style={styles.skipMore}>… e mais {skipped.length - 80}.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          {parsed && parsed.length > 0 ? (
            <ScrollView style={styles.preview} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <Text style={styles.previewTitle}>Prévia (primeiras linhas)</Text>
              {parsed.slice(0, 5).map((p) => (
                <Text key={p.lineNumber} style={styles.previewRow} numberOfLines={2}>
                  {p.values.nome_cliente} — {p.values.valor_mensalidade} — {p.values.segmento_cliente_codigo}
                </Text>
              ))}
            </ScrollView>
          ) : null}

          {importing ? (
            <Text style={styles.progress}>
              Importando… {progress.done}/{progress.total}
            </Text>
          ) : null}

          {lastResult ? (
            <Text style={styles.result}>
              Concluído: {lastResult.created} cadastrados.
              {lastResult.failed.length > 0
                ? ` Erros: ${lastResult.failed.length} (veja detalhes abaixo).`
                : ''}
            </Text>
          ) : null}

          {lastResult && lastResult.failed.length > 0 ? (
            <ScrollView style={styles.failList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {lastResult.failed.map((f, idx) => (
                <Text key={`fail-${f.lineNumber}-${idx}`} style={styles.failRow}>
                  Linha {f.lineNumber}: {f.message}
                </Text>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              title="Importar agora"
              onPress={runImport}
              loading={importing}
              disabled={!userId || !parsed?.length || importing}
            />
            <PrimaryButton title="Fechar" variant="ghost" onPress={handleClose} disabled={importing} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  fileName: {
    fontSize: 13,
    color: colors.gray800,
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.orange,
    fontWeight: '600',
  },
  summary: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray800,
  },
  skipList: {
    maxHeight: 120,
    marginTop: spacing.sm,
  },
  skipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray600,
    marginBottom: spacing.xs,
  },
  skipRow: {
    fontSize: 11,
    color: colors.gray600,
    marginBottom: 4,
  },
  skipMore: {
    fontSize: 11,
    color: colors.gray400,
    marginTop: 4,
  },
  preview: {
    maxHeight: 140,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.xs,
  },
  previewRow: {
    fontSize: 12,
    color: colors.gray800,
    marginBottom: 6,
  },
  progress: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.petroleum,
    fontWeight: '600',
  },
  result: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.gray800,
  },
  failList: {
    maxHeight: 100,
    marginTop: spacing.sm,
  },
  failRow: {
    fontSize: 11,
    color: colors.orange,
    marginBottom: 4,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
