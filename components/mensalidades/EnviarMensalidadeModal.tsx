import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  loading?: boolean;
  onClose: () => void;
  onSomenteMensalidade: () => void;
  onMensalidadeComNf: () => void;
};

export function EnviarMensalidadeModal({
  visible,
  loading,
  onClose,
  onSomenteMensalidade,
  onMensalidadeComNf,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Como deseja enviar?</Text>
          <Text style={styles.hint}>
            Escolha se deseja gerar apenas as mensalidades e carnês, ou também emitir NF-e na SEFAZ (clientes com
            NF no cadastro).
          </Text>

          <Pressable
            style={[styles.option, styles.optionPrimary]}
            onPress={onMensalidadeComNf}
            disabled={loading}
          >
            <Ionicons name="document-text" size={22} color={colors.white} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitleLight}>Gerar mensalidade + NF-e</Text>
              <Text style={styles.optionSubLight}>
                Mensalidade, carnê em A receber, XML/DANFE e envio à SEFAZ.
              </Text>
            </View>
          </Pressable>

          <Pressable style={styles.option} onPress={onSomenteMensalidade} disabled={loading}>
            <Ionicons name="receipt-outline" size={22} color={colors.petroleum} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>Somente mensalidade</Text>
              <Text style={styles.optionSub}>Sem nota fiscal — apenas mensalidade e carnê.</Text>
            </View>
          </Pressable>

          <PrimaryButton title="Cancelar" variant="ghost" onPress={onClose} disabled={loading} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.petroleum },
  hint: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.gray50,
  },
  optionPrimary: {
    backgroundColor: colors.petroleum,
    borderColor: colors.petroleum,
  },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.petroleum },
  optionTitleLight: { fontSize: 15, fontWeight: '700', color: colors.white },
  optionSub: { fontSize: 12, color: colors.gray600, marginTop: 4, lineHeight: 17 },
  optionSubLight: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 17 },
});
