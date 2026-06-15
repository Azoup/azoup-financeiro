import { searchClientesVenda, type ClienteVendaOption } from '@/services/vendasService';
import { colors, radius, spacing } from '@/theme/colors';
import { useDebounce } from '@/hooks/useDebounce';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onSelect: (c: ClienteVendaOption) => void;
  selectedId?: string | null;
};

export function ClienteVendaPicker({ visible, userId, onClose, onSelect, selectedId }: Props) {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 280);
  const [items, setItems] = useState<ClienteVendaOption[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!visible || !userId) return;
    setLoading(true);
    try {
      const rows = await searchClientesVenda(userId, debounced, 50);
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [visible, userId, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Selecionar cliente</Text>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color={colors.gray400} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nome ou empresa"
              placeholderTextColor={colors.gray400}
              value={q}
              onChangeText={setQ}
            />
          </View>
          {loading ? (
            <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing.lg }} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const sel = item.id === selectedId;
                return (
                  <Pressable
                    style={[styles.row, sel && styles.rowSelected]}
                    onPress={() => {
                      onSelect(item);
                      onClose();
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nome}>{item.nome_cliente}</Text>
                      {item.nome_empresa ? (
                        <Text style={styles.empresa}>{item.nome_empresa}</Text>
                      ) : null}
                    </View>
                    {sel ? <Ionicons name="checkmark-circle" size={22} color={colors.orange} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>Nenhum cliente encontrado.</Text>
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '78%',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray200,
    marginVertical: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.petroleum,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  rowSelected: { backgroundColor: colors.gray50 },
  nome: { fontSize: 16, fontWeight: '600', color: colors.petroleum },
  empresa: { fontSize: 14, color: colors.gray600, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.gray400, marginTop: spacing.lg },
});
