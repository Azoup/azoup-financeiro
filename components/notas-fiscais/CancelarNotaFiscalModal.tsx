import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

type Props = {
  visible: boolean;
  nota: NotaFiscalListRow | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (justificativa: string) => void;
};

export function CancelarNotaFiscalModal({ visible, nota, loading, onClose, onConfirm }: Props) {
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (!visible) setMotivo('');
  }, [visible]);

  const ok = motivo.trim().length >= 15;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Cancelar NF-e</Text>
          {nota ? (
            <Text style={styles.sub}>
              NF-e {nota.serie}/{nota.numero} · {nota.cliente?.nome_cliente ?? 'Cliente'}
            </Text>
          ) : null}
          <Text style={styles.hint}>
            O cancelamento será enviado à SEFAZ (homologação ou produção, conforme a nota). Mínimo 15
            caracteres na justificativa.
          </Text>
          <FormTextInput
            label="Motivo do cancelamento"
            value={motivo}
            onChangeText={setMotivo}
            multiline
            numberOfLines={4}
            style={styles.area}
            placeholder="Ex.: Mensalidade gerada em duplicidade para o cliente."
          />
          <View style={styles.actions}>
            <PrimaryButton title="Voltar" variant="ghost" onPress={onClose} disabled={loading} style={styles.btn} />
            <PrimaryButton
              title="Confirmar cancelamento"
              variant="danger"
              onPress={() => onConfirm(motivo.trim())}
              loading={loading}
              disabled={!ok || loading}
              style={styles.btn}
            />
          </View>
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
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.petroleum, marginBottom: spacing.xs },
  sub: { fontSize: 14, fontWeight: '600', color: colors.gray800, marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.gray600, lineHeight: 17, marginBottom: spacing.md },
  area: { minHeight: 100, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, minHeight: 44 },
});
