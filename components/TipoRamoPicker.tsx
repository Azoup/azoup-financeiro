import { colors, radius, spacing } from '@/theme/colors';
import { fetchTiposRamo, insertTipoRamo } from '@/services/tiposRamoService';
import React, { useCallback, useEffect, useState } from 'react';
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
import { PrimaryButton } from '@/components/PrimaryButton';
import Toast from 'react-native-toast-message';

type Props = {
  value: string;
  onChange: (nome: string) => void;
};

export function TipoRamoPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [novo, setNovo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchTiposRamo();
      setOptions(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const salvarNovo = async () => {
    const trimmed = novo.trim();
    if (!trimmed) {
      Toast.show({ type: 'error', text1: 'Digite um nome.' });
      return;
    }
    const { error } = await insertTipoRamo(trimmed);
    if (error) {
      Toast.show({ type: 'error', text1: error });
      return;
    }
    Toast.show({ type: 'success', text1: 'Tipo adicionado.' });
    setNovo('');
    await load();
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Tipo do ramo (banco de dados)</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.field}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {value || 'Selecionar tipo cadastrado'}
        </Text>
        <Text style={styles.chev}>▼</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Tipo do ramo</Text>
            <Text style={styles.subhint}>
              Lista carregada da tabela tipos_ramo no Supabase.
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing.lg }} />
            ) : options.length === 0 ? (
              <Text style={styles.empty}>
                Nenhum tipo cadastrado. Adicione um nome abaixo e salve, ou rode o SQL inicial
                com os inserts em tipos_ramo.
              </Text>
            ) : (
              <FlatList
                data={options}
                keyExtractor={(item) => item}
                style={styles.list}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.row, item === value && styles.rowActive]}
                    onPress={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    <Text style={styles.rowText}>{item}</Text>
                  </Pressable>
                )}
              />
            )}

            <Text style={styles.sub}>Adicionar novo tipo no banco</Text>
            <TextInput
              value={novo}
              onChangeText={setNovo}
              placeholder="Nome do ramo"
              placeholderTextColor={colors.gray400}
              style={styles.input}
            />
            <PrimaryButton title="Salvar novo tipo" variant="secondary" onPress={salvarNovo} />
            <PrimaryButton title="Fechar" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  fieldText: {
    fontSize: 16,
    color: colors.gray800,
    flex: 1,
  },
  placeholder: {
    color: colors.gray400,
  },
  chev: {
    fontSize: 12,
    color: colors.gray400,
    marginLeft: spacing.sm,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '78%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  subhint: {
    fontSize: 12,
    color: colors.gray600,
    marginBottom: spacing.md,
  },
  list: {
    maxHeight: 220,
    marginBottom: spacing.md,
  },
  empty: {
    fontSize: 14,
    color: colors.gray600,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray100,
  },
  rowActive: {
    backgroundColor: 'rgba(232, 106, 36, 0.1)',
  },
  rowText: {
    fontSize: 16,
    color: colors.gray800,
  },
  sub: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    marginBottom: spacing.sm,
    color: colors.gray800,
  },
});
