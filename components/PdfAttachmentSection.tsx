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
};

export function PdfAttachmentSection({ pdfPath, pdfLocalUri, pdfFileName, onPick, onRemove }: Props) {
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

  return (
    <View style={styles.block}>
      <Text style={styles.section}>Anexo PDF</Text>
      <Text style={styles.hint}>
        O arquivo é enviado ao bucket privado do Supabase após salvar o cliente.
      </Text>

      {temNovo ? (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>Novo arquivo selecionado</Text>
          <Text style={styles.statusName}>{pdfFileName ?? 'documento.pdf'}</Text>
        </View>
      ) : temRemoto ? (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>PDF já salvo no cadastro</Text>
          <Text style={styles.statusName}>Substitua ou remova abaixo.</Text>
        </View>
      ) : (
        <Text style={styles.muted}>Nenhum PDF anexado.</Text>
      )}

      <View style={styles.row}>
        <PrimaryButton title="Anexar PDF" variant="secondary" onPress={anexar} style={styles.btn} />
        {(temNovo || temRemoto) ? (
          <PrimaryButton title="Remover" variant="ghost" onPress={onRemove} style={styles.btn} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.md,
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
  status: {
    backgroundColor: 'rgba(13, 59, 79, 0.06)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
  },
  statusName: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.gray800,
  },
  muted: {
    fontSize: 14,
    color: colors.gray400,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  btn: {
    minHeight: 48,
  },
});
