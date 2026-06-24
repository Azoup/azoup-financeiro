import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  titulo?: string;
  descricao?: string;
  loading?: boolean;
  onClose: () => void;
  onEmitir: () => void;
  onDepois: () => void;
};

export function ConfirmarEmitirNfseModal({
  visible,
  titulo = 'Emitir NFS-e agora?',
  descricao = 'O pagamento foi registrado. Deseja gerar e emitir a NFS-e de serviço para este cliente?',
  loading,
  onClose,
  onEmitir,
  onDepois,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons name="receipt-outline" size={28} color={colors.orange} />
          </View>
          <Text style={styles.title}>{titulo}</Text>
          <Text style={styles.hint}>{descricao}</Text>
          <PrimaryButton
            title={loading ? 'Emitindo NFS-e…' : 'Gerar e emitir NFS-e'}
            onPress={onEmitir}
            loading={loading}
            disabled={loading}
          />
          <PrimaryButton title="Depois" variant="ghost" onPress={onDepois} disabled={loading} />
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
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.petroleum, textAlign: 'center' },
  hint: { fontSize: 13, color: colors.gray600, lineHeight: 18, textAlign: 'center' },
});
