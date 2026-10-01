import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/colors';
import type { FalhaEmissao } from '@/types/mensalidadeGerada';

const ROTULO: Record<FalhaEmissao['tipo'], string> = {
  nota: 'Nota',
  mensalidade: 'Mensalidade',
  boleto: 'Boleto',
};

export function FalhaEmissaoLista({
  falhas,
  onFechar,
}: {
  falhas: FalhaEmissao[];
  onFechar?: () => void;
}) {
  if (!falhas.length) return null;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {falhas.length === 1 ? '1 item não gerado' : `${falhas.length} itens não gerados`}
        </Text>
        {onFechar ? (
          <Pressable onPress={onFechar} hitSlop={8}>
            <Text style={styles.fechar}>Fechar</Text>
          </Pressable>
        ) : null}
      </View>
      {falhas.map((f, i) => (
        <View key={`${f.tipo}-${f.cliente}-${i}`} style={styles.item}>
          <Text style={styles.cliente}>{f.cliente}</Text>
          <Text style={styles.tipo}>Não gerou {ROTULO[f.tipo]}</Text>
          <Text style={styles.erro}>{f.erro}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: spacing.sm,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 15,
  },
  fechar: {
    color: colors.petroleum,
    fontWeight: '600',
    fontSize: 13,
  },
  item: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  cliente: {
    color: colors.gray800,
    fontWeight: '700',
    fontSize: 14,
  },
  tipo: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 12,
  },
  erro: {
    color: colors.gray600,
    fontSize: 13,
  },
});
