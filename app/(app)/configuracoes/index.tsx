import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildConfiguracoesExport } from '@/utils/exportReportBuilders';
import { colors, radius, spacing } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function ConfiguracoesIndexScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ExportReportButtons getReport={() => buildConfiguracoesExport()} />
      <Text style={styles.lead}>
        Ajustes do aplicativo e cadastros auxiliares. Os segmentos definem a classificação usada no cadastro de
        clientes.
      </Text>

      <Card style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => router.push('/(app)/configuracoes/perfil-cobranca')}
        >
          <View style={styles.rowIcon}>
            <Ionicons name="business-outline" size={22} color={colors.orange} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Dados do beneficiário (boleto)</Text>
            <Text style={styles.rowSub}>
              Razão social, CNPJ/CPF, endereço e instruções usados nos carnês de contas a receber.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray400} />
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => router.push('/(app)/configuracoes/segmentos')}
        >
          <View style={styles.rowIcon}>
            <Ionicons name="pricetags-outline" size={22} color={colors.orange} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Segmentos de cliente</Text>
            <Text style={styles.rowSub}>Cadastrar, listar e excluir segmentos (código e nome).</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray400} />
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  lead: {
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.petroleum,
  },
  rowSub: {
    marginTop: 4,
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 18,
  },
});
