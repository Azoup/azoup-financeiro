import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing } from '@/theme/colors';
import { fetchSegmentosCliente } from '@/services/segmentoClienteService';
import type { SegmentoClienteRow } from '@/types/models';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  /** Código salvo no banco (segmento_cliente.codigo). */
  valueCodigo: string;
  onChangeCodigo: (codigo: string) => void;
  compact?: boolean;
};

export function SegmentoClientePicker({ valueCodigo, onChangeCodigo, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SegmentoClienteRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSegmentosCliente();
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

  const label =
    options.find((o) => o.codigo === valueCodigo)?.nome ??
    (valueCodigo ? `${valueCodigo} (código)` : '');

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Text style={[styles.label, compact && styles.labelCompact]}>Segmento</Text>
      <Pressable onPress={() => setOpen(true)} style={[styles.field, compact && styles.fieldCompact]}>
        <Text style={[styles.fieldText, compact && styles.fieldTextCompact, !valueCodigo && styles.placeholder]}>
          {valueCodigo ? label : 'Selecionar segmento'}
        </Text>
        <Text style={styles.chev}>▼</Text>
      </Pressable>
      {!compact ? (
        <Text style={styles.hint}>
          Catálogo de segmentos (código + nome). Para incluir ou remover opções, use Configurações → Segmentos.
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Segmento</Text>
            <Text style={styles.subhint}>Escolha o código salvo no cadastro do cliente.</Text>
            {loading ? (
              <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing.lg }} />
            ) : options.length === 0 ? (
              <Text style={styles.empty}>
                Nenhum segmento encontrado. Execute a migration 008 no Supabase (tabela segmento_cliente).
              </Text>
            ) : (
              <FlatList
                data={options}
                keyExtractor={(i) => i.codigo}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const active = item.codigo === valueCodigo;
                  return (
                    <Pressable
                      onPress={() => {
                        onChangeCodigo(item.codigo);
                        setOpen(false);
                      }}
                      style={[styles.row, active && styles.rowActive]}
                    >
                      <Text style={[styles.rowText, active && styles.rowTextActive]}>{item.nome}</Text>
                      <Text style={styles.rowCodigo}>{item.codigo}</Text>
                    </Pressable>
                  );
                }}
              />
            )}
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
  wrapCompact: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  labelCompact: {
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  hint: {
    fontSize: 11,
    color: colors.gray600,
    marginTop: spacing.xs,
    lineHeight: 16,
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
  fieldCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    minHeight: 40,
  },
  fieldText: {
    fontSize: 16,
    color: colors.gray800,
    flex: 1,
  },
  fieldTextCompact: {
    fontSize: 14,
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
    maxHeight: 320,
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
    fontWeight: '600',
  },
  rowTextActive: {
    color: colors.petroleum,
  },
  rowCodigo: {
    fontSize: 12,
    color: colors.gray400,
    marginTop: 2,
  },
});
