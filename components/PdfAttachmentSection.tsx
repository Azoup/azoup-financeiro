import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  pdfPath: string | null;
  pdfLocalUri: string | null;
  pdfFileName: string | null;
  onPick: (uri: string, fileName: string) => void;
  onRemove: () => void;
  compact?: boolean;
};

export function PdfAttachmentSection({
  pdfPath,
  pdfLocalUri,
  pdfFileName,
  onPick,
  onRemove,
  compact,
}: Props) {
  const anexar = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset?.uri) return;
    const name = asset.name ?? 'documento.pdf';
    onPick(asset.uri, name);
  };

  const temNovo = Boolean(pdfLocalUri);
  const temRemoto = Boolean(pdfPath) && !temNovo;
  const temArquivo = temNovo || temRemoto;

  return (
    <View style={[styles.block, compact && styles.blockCompact]}>
      {!compact ? <Text style={styles.section}>Anexo PDF</Text> : null}
      {!compact ? (
        <Text style={styles.hint}>Enviado ao bucket privado após salvar o cliente.</Text>
      ) : null}

      {temNovo ? (
        <Text style={styles.fileName} numberOfLines={1}>
          {pdfFileName ?? 'documento.pdf'}
        </Text>
      ) : temRemoto ? (
        <Text style={styles.fileName}>PDF salvo no cadastro</Text>
      ) : (
        <Text style={styles.muted}>Nenhum PDF</Text>
      )}

      <View style={styles.row}>
        <PrimaryButton
          title={compact ? 'Anexar' : 'Anexar PDF'}
          variant="secondary"
          onPress={anexar}
          style={[styles.btn, compact && styles.btnCompact]}
        />
        {temArquivo ? (
          <PrimaryButton
            title="Remover"
            variant="ghost"
            onPress={onRemove}
            style={[styles.btn, compact && styles.btnCompact]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.md,
  },
  blockCompact: {
    marginTop: spacing.sm,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 13,
    color: colors.gray600,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  fileName: {
    fontSize: 13,
    color: colors.gray800,
    marginBottom: spacing.sm,
  },
  muted: {
    fontSize: 13,
    color: colors.gray400,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  btn: {
    minHeight: 48,
  },
  btnCompact: {
    minHeight: 36,
    flex: 1,
  },
});
