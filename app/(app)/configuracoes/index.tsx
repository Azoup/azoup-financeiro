import { Card } from '@/components/Card';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { useAuth } from '@/context/AuthContext';
import { fetchNfeProntidao } from '@/utils/nfeProntidao';
import { buildConfiguracoesExport } from '@/utils/exportReportBuilders';
import { colors, radius, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function ConfiguracoesIndexScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [nfePronto, setNfePronto] = useState<boolean | null>(null);

  const loadNfeStatus = useCallback(async () => {
    if (!user?.id) return;
    try {
      const p = await fetchNfeProntidao(user.id);
      setNfePronto(p.pronto);
    } catch {
      setNfePronto(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadNfeStatus();
  }, [loadNfeStatus]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ExportReportButtons getReport={() => buildConfiguracoesExport()} />
      <Text style={styles.lead}>
        Ajustes do aplicativo e cadastros auxiliares. Os segmentos definem a classificação usada no cadastro de
        clientes.
      </Text>

      <Card style={styles.nfeHero}>
        <View style={styles.nfeHeroIcon}>
          <Ionicons name="document-text" size={28} color={colors.white} />
        </View>
        <Text style={styles.nfeHeroTitle}>Emissão de NFS-e (serviço)</Text>
        <Text style={styles.nfeHeroSub}>
          Prestador, certificado A1, código do serviço (LC 116 + NBS) e município (IBGE) — produção.
          NFS-e não usa NCM nem CFOP.
        </Text>
        {nfePronto === true ? (
          <Text style={styles.nfeHeroOk}>✓ Pronto para emitir NFS-e em produção</Text>
        ) : nfePronto === false ? (
          <Text style={styles.nfeHeroPending}>Configuração incompleta</Text>
        ) : null}
        <PrimaryButton
          title="Configurar emissão de NFS-e"
          onPress={() => router.push('/(app)/configuracoes/nfe')}
          style={styles.nfeHeroBtn}
        />
      </Card>

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
              Carnês em A receber. Os mesmos dados do prestador podem ser editados na configuração de NFS-e.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray400} />
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/(app)/configuracoes/sicoob')}>
          <View style={styles.rowIcon}>
            <Ionicons name="barcode-outline" size={22} color={colors.orange} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Boleto Sicoob (API V3)</Text>
            <Text style={styles.rowSub}>
              Emissão automática ao gerar parcelas de venda ou mensalidades — com ou sem NFS-e.
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
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  nfeHero: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.petroleum,
    borderRadius: radius.lg,
    alignItems: 'flex-start',
    borderWidth: 0,
  },
  nfeHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  nfeHeroTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  nfeHeroSub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  nfeHeroOk: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#a5d6a7',
    marginBottom: spacing.sm,
  },
  nfeHeroPending: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.orangeLight,
    marginBottom: spacing.sm,
  },
  nfeHeroBtn: {
    alignSelf: 'stretch',
    backgroundColor: colors.orange,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
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
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.petroleum,
  },
  rowSub: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 18,
  },
});
