import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import type { ContaReceberListRow } from '@/types/contasReceber';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  item: ContaReceberListRow | null;
  dataIso: string | null;
  onChangeData: (iso: string | null) => void;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
};

export function AlterarVencimentoBoletoModal({
  item,
  dataIso,
  onChangeData,
  onClose,
  onConfirm,
  busy,
}: Props) {
  if (!item) return null;

  const atual = formatBRDate(parseISODate(item.data_vencimento)) || item.data_vencimento;
  const noBanco =
    (item.tipo_emissao === 'sicoob' && Boolean(item.nosso_numero_banco)) ||
    (item.tipo_emissao === 'c6' && Boolean(item.c6_boleto_id));
  const igual = dataIso === item.data_vencimento.slice(0, 10);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={busy ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Alterar vencimento</Text>
              <Text style={styles.sub} numberOfLines={2}>
                {item.nome_cliente}
              </Text>
              <Text style={styles.sub}>Atual: {atual}</Text>
            </View>
            <Pressable onPress={onClose} disabled={busy} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.gray600} />
            </Pressable>
          </View>

          <Text style={styles.hint}>
            {noBanco
              ? 'A data nova entra no sistema e no banco deste boleto.'
              : 'Este boleto ainda não está no banco. A data nova fica no sistema e vai na hora de registrar.'}
          </Text>

          <DatePickerField
            label="Novo vencimento"
            value={dataIso ? new Date(`${dataIso}T12:00:00`) : null}
            onChange={(d) => onChangeData(d ? toISODate(d) : null)}
          />

          <PrimaryButton
            title={busy ? 'Alterando…' : 'Salvar vencimento'}
            onPress={onConfirm}
            loading={busy}
            disabled={busy || !dataIso || igual}
            style={{ marginTop: spacing.md }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.petroleum },
  sub: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  hint: { fontSize: 13, color: colors.gray800, marginBottom: spacing.md, lineHeight: 18 },
});
