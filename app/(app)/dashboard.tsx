import { Card } from '@/components/Card';
import { useAuth } from '@/context/AuthContext';
import { fetchDashboardOverview, type DashboardOverview } from '@/services/dashboardService';
import { colors, radius, spacing } from '@/theme/colors';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function pctBar(recebido: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((recebido / total) * 100));
}

function StatTile({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIconWrap, accent ? { backgroundColor: accent } : null]}>
        <Ionicons name={icon} size={20} color={colors.petroleum} />
      </View>
      <Text style={styles.statTileLabel}>{label}</Text>
      <Text style={styles.statTileValue} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {sub ? <Text style={styles.statTileSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function QuickLink({
  label,
  sub,
  icon,
  onPress,
}: {
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quickLink} onPress={onPress}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.orange} />
      </View>
      <View style={styles.quickBody}>
        <Text style={styles.quickLabel}>{label}</Text>
        <Text style={styles.quickSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
    </Pressable>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const o = await fetchDashboardOverview(user.id);
    setData(o);
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const d = data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.greeting}>Painel analítico</Text>
        <Text style={styles.lead}>
          Visão consolidada de clientes, mensalidades recorrentes, vendas e contas a receber para apoiar sua
          cobrança e análise.
        </Text>
        {d ? (
          <Text style={styles.updated}>
            Atualizado: {formatDateTimeBRFromISO(d.geradoEm) || 'agora'}
          </Text>
        ) : null}
      </View>

      {loading && !d ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.orange} />
          <Text style={styles.loadingTxt}>Carregando indicadores…</Text>
        </View>
      ) : null}

      {d ? (
        <>
          <Card style={styles.highlightCard}>
            <View style={styles.highlightRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.highlightLabel}>Total a receber (consolidado)</Text>
                <Text style={styles.highlightValue}>{formatBRL(d.totalReceberConsolidado)}</Text>
                <Text style={styles.highlightSub}>
                  Mensalidades pendentes {formatBRL(d.mensalidades.valorPendente)} · Vendas pendentes{' '}
                  {formatBRL(d.vendas.totalPendente)}
                </Text>
              </View>
              <View style={styles.highlightBadge}>
                <Ionicons name="wallet-outline" size={28} color={colors.orange} />
              </View>
            </View>
          </Card>

          <SectionTitle title="Alertas" hint="Itens que merecem atenção" />
          <Card style={styles.alertCard}>
            {d.alertas.map((a, i) => (
              <View
                key={i}
                style={[
                  styles.alertRow,
                  i < d.alertas.length - 1 && styles.alertRowBorder,
                  a.nivel === 'danger' && styles.alertDanger,
                  a.nivel === 'warning' && styles.alertWarning,
                ]}
              >
                <Ionicons
                  name={
                    a.nivel === 'danger'
                      ? 'alert-circle'
                      : a.nivel === 'warning'
                        ? 'warning'
                        : 'information-circle'
                  }
                  size={18}
                  color={
                    a.nivel === 'danger'
                      ? colors.danger
                      : a.nivel === 'warning'
                        ? colors.orangeDark
                        : colors.petroleum
                  }
                />
                <Text style={styles.alertText}>{a.texto}</Text>
              </View>
            ))}
          </Card>

          <SectionTitle title="Clientes" hint="Cadastro e recorrência (ativos)" />
          <View style={styles.statGrid}>
            <Card style={styles.statCardWide}>
              <StatTile
                icon="people-outline"
                label="Ativos"
                value={String(d.clientes.ativos)}
                sub={`${d.clientes.cancelados} cancelados · ${d.clientes.total} no cadastro`}
                accent="rgba(232, 106, 36, 0.12)"
              />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="cash-outline"
                label="Recorrência mensal"
                value={formatBRL(d.clientes.somaMensalidadeAtivos)}
                sub="Soma das mensalidades dos ativos"
              />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="stats-chart-outline"
                label="Ticket médio"
                value={formatBRL(d.clientes.ticketMedio)}
                sub="Por cliente ativo"
              />
            </Card>
          </View>

          {d.clientes.porSegmento.length > 0 ? (
            <Card style={styles.segCard}>
              <Text style={styles.segTitle}>Clientes ativos por segmento</Text>
              {d.clientes.porSegmento.map((s) => {
                const pct = d.clientes.ativos
                  ? Math.round((s.qtd / d.clientes.ativos) * 100)
                  : 0;
                return (
                  <View key={s.codigo} style={styles.segRow}>
                    <View style={styles.segLabelRow}>
                      <Text style={styles.segNome}>{s.nome}</Text>
                      <Text style={styles.segQtd}>
                        {s.qtd} ({pct}%)
                      </Text>
                    </View>
                    <View style={styles.segBarBg}>
                      <View style={[styles.segBarFill, { width: `${pct}%` }]} />
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}

          <SectionTitle title="Mensalidades geradas" hint="Cobranças emitidas pelo módulo Mensalidades" />
          <View style={styles.statGrid}>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="time-outline"
                label="Pendente"
                value={formatBRL(d.mensalidades.valorPendente)}
                sub={`${d.mensalidades.abertas} em aberto`}
              />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="checkmark-circle-outline"
                label="Recebido"
                value={formatBRL(d.mensalidades.valorRecebido)}
                sub={`${d.mensalidades.quitadas} quitadas`}
              />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile
                icon="alert-circle-outline"
                label="Atrasadas"
                value={String(d.mensalidades.atrasadas)}
                accent="rgba(198, 40, 40, 0.1)"
              />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile
                icon="calendar-outline"
                label="Vence em 7 dias"
                value={String(d.mensalidades.proximosVencimentos7d)}
              />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile
                icon="documents-outline"
                label="Total geradas"
                value={String(d.mensalidades.totalGeradas)}
              />
            </Card>
          </View>

          <SectionTitle title="Vendas" hint="Parcelas e recebimentos" />
          <Card style={styles.progressCard}>
            <View style={styles.progressHead}>
              <Text style={styles.progressLabel}>Recebimento sobre o vendido</Text>
              <Text style={styles.progressPct}>{d.vendas.taxaRecebimentoPct}%</Text>
            </View>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${pctBar(d.vendas.totalRecebido, d.vendas.totalVendido)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressSub}>
              Recebido {formatBRL(d.vendas.totalRecebido)} de {formatBRL(d.vendas.totalVendido)} vendidos
            </Text>
          </Card>
          <View style={styles.statGrid}>
            <Card style={styles.statCardHalf}>
              <StatTile icon="cart-outline" label="Total vendido" value={formatBRL(d.vendas.totalVendido)} />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="hourglass-outline"
                label="Pendente"
                value={formatBRL(d.vendas.totalPendente)}
                sub={`${d.vendas.vendasAbertas} vendas abertas`}
              />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile
                icon="warning-outline"
                label="Parc. atrasadas"
                value={String(d.vendas.parcelasAtrasadas)}
              />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile icon="layers-outline" label="Vendas" value={String(d.vendas.totalVendas)} />
            </Card>
            <Card style={styles.statCardThird}>
              <StatTile
                icon="close-circle-outline"
                label="Canceladas"
                value={String(d.vendas.canceladas)}
              />
            </Card>
          </View>

          <SectionTitle title="Contas a receber" hint="Documentos (carnês) gerados" />
          <View style={styles.statGrid}>
            <Card style={styles.statCardWide}>
              <StatTile
                icon="document-text-outline"
                label="Documentos emitidos"
                value={String(d.contasReceber.totalDocumentos)}
                sub={`Valor nominal ${formatBRL(d.contasReceber.valorTotalDocumentos)}`}
              />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="receipt-outline"
                label="Por vendas"
                value={String(d.contasReceber.origemVenda)}
              />
            </Card>
            <Card style={styles.statCardHalf}>
              <StatTile
                icon="repeat-outline"
                label="Por mensalidades"
                value={String(d.contasReceber.origemMensalidade)}
              />
            </Card>
          </View>

          <SectionTitle title="Acesso rápido" />
          <Card style={styles.quickCard}>
            <QuickLink
              label="Clientes"
              sub="Lista, filtros e cadastro"
              icon="people-outline"
              onPress={() => router.push('/(app)/clients')}
            />
            <QuickLink
              label="Gerar mensalidade"
              sub="Lote por segmento e vencimento"
              icon="add-circle-outline"
              onPress={() => router.push('/(app)/mensalidades/gerar')}
            />
            <QuickLink
              label="Histórico de mensalidades"
              sub="Registrar pagamentos"
              icon="calendar-outline"
              onPress={() => router.push('/(app)/mensalidades')}
            />
            <QuickLink
              label="Vendas"
              sub="Nova venda e parcelas"
              icon="cart-outline"
              onPress={() => router.push('/(app)/vendas')}
            />
            <QuickLink
              label="Contas a receber"
              sub="Boletos e PDFs"
              icon="cash-outline"
              onPress={() => router.push('/(app)/contas-receber')}
            />
            <QuickLink
              label="Configurações"
              sub="Segmentos e beneficiário"
              icon="settings-outline"
              onPress={() => router.push('/(app)/configuracoes')}
            />
          </Card>
        </>
      ) : !loading ? (
        <Card>
          <Text style={styles.errorTxt}>Não foi possível carregar o painel. Puxe para atualizar.</Text>
        </Card>
      ) : null}
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
  hero: {
    marginBottom: spacing.lg,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.petroleum,
  },
  lead: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: colors.gray600,
    lineHeight: 22,
  },
  updated: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.gray400,
  },
  loadingBox: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingTxt: {
    color: colors.gray600,
    fontSize: 14,
  },
  highlightCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.petroleum,
    borderWidth: 0,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  highlightLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  highlightValue: {
    marginTop: spacing.xs,
    fontSize: 28,
    fontWeight: '800',
    color: colors.white,
  },
  highlightSub: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 17,
  },
  highlightBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: {
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.petroleum,
  },
  sectionHint: {
    marginTop: 2,
    fontSize: 12,
    color: colors.gray600,
  },
  alertCard: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  alertRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray100,
  },
  alertDanger: {
    backgroundColor: 'rgba(198, 40, 40, 0.06)',
    borderRadius: radius.md,
  },
  alertWarning: {
    backgroundColor: 'rgba(232, 106, 36, 0.08)',
    borderRadius: radius.md,
  },
  alertText: {
    flex: 1,
    fontSize: 14,
    color: colors.gray800,
    lineHeight: 20,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  statCardWide: {
    width: '100%',
  },
  statCardHalf: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
  },
  statCardThird: {
    width: '30%',
    flexGrow: 1,
    minWidth: 100,
  },
  statTile: {
    gap: spacing.xs,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statTileLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
  },
  statTileValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.petroleum,
  },
  statTileSub: {
    fontSize: 11,
    color: colors.gray400,
    lineHeight: 15,
  },
  segCard: {
    marginBottom: spacing.lg,
  },
  segTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  segRow: {
    marginBottom: spacing.md,
  },
  segLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  segNome: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray800,
    flex: 1,
  },
  segQtd: {
    fontSize: 12,
    color: colors.gray600,
    fontWeight: '600',
  },
  segBarBg: {
    height: 6,
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  segBarFill: {
    height: '100%',
    backgroundColor: colors.orange,
    borderRadius: radius.full,
  },
  progressCard: {
    marginBottom: spacing.md,
  },
  progressHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray800,
  },
  progressPct: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.orange,
  },
  progressBg: {
    height: 10,
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: radius.full,
  },
  progressSub: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.gray600,
  },
  quickCard: {
    paddingVertical: spacing.xs,
  },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray100,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBody: {
    flex: 1,
    minWidth: 0,
  },
  quickLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.petroleum,
  },
  quickSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.gray600,
  },
  errorTxt: {
    fontSize: 14,
    color: colors.gray600,
    textAlign: 'center',
  },
});
