import { PrimaryButton } from '@/components/PrimaryButton';
import { useTheme } from '@/context/ThemeContext';
import type { Notificacao } from '@/services/notificacaoService';
import { marcarAlertasExibidos } from '@/services/notificacaoService';
import { useAuth } from '@/context/AuthContext';
import { fonts } from '@/theme/typography';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  itens: Notificacao[];
  onClose: () => void;
};

/** Modal “uma vez” listando clientes cujo período de paralisação acabou. */
export function ParalisadosRetornoAlert({ visible, itens, onClose }: Props) {
  const { user } = useAuth();
  const { theme } = useTheme();

  const dismiss = async () => {
    if (user?.id && itens.length) {
      await marcarAlertasExibidos(
        user.id,
        itens.map((i) => i.id),
      ).catch(() => undefined);
    }
    onClose();
  };

  if (!itens.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void dismiss()}>
      <Pressable style={styles.bg} onPress={() => void dismiss()}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.headerBorder }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: theme.text }]}>Retorno de paralisados</Text>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Estes clientes atingiram a data de retorno e já podem voltar à geração de mensalidades.
            O aviso também fica no sininho.
          </Text>
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            {itens.map((n) => (
              <View
                key={n.id}
                style={[styles.row, { backgroundColor: theme.surfaceVariant, borderColor: theme.headerBorder }]}
              >
                <Text style={[styles.rowTxt, { color: theme.text }]}>{n.corpo}</Text>
              </View>
            ))}
          </ScrollView>
          <PrimaryButton title="Entendi" onPress={() => void dismiss()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    maxHeight: '80%',
    gap: 10,
  },
  title: { fontFamily: fonts.bold, fontSize: 18 },
  hint: { fontSize: 13, lineHeight: 18 },
  list: { maxHeight: 280 },
  row: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  rowTxt: { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
});
