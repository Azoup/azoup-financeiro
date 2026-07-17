import { HomeStatCardsGrid, type HomeStatCardItem } from '@/components/ui/HomeStatCardsGrid';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { fetchDashboardOverview, type DashboardOverview } from '@/services/dashboardService';
import { getHomeDashboardLayoutStyles } from '@/styles/homeDashboardLayoutStyles';
import { fonts } from '@/theme/typography';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { useResponsiveLayout } from '@/utils/responsiveLayout';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

function ProgressTrack({
  label,
  percent,
  left,
  right,
  color,
  theme,
}: {
  label: string;
  percent: number;
  left: string;
  right: string;
  color: string;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: theme.text }}>{label}</Text>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color }}>{percent}%</Text>
      </View>
      <View
        style={{
          height: 7,
          borderRadius: 999,
          backgroundColor: theme.surfaceVariant,
          overflow: 'hidden',
        }}
      >
        <View style={{ height: '100%', width: `${percent}%`, backgroundColor: color }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 11, color: theme.textMuted }}>{left}</Text>
        <Text style={{ flex: 1, fontSize: 11, color: theme.textMuted, textAlign: 'right' }}>
          {right}
        </Text>
      </View>
    </View>
  );
}

function Shortcut({
  label,
  icon,
  onPress,
  theme,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: '23%',
          flexGrow: 1,
          minWidth: 72,
          maxWidth: 140,
          alignItems: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: theme.mode === 'light' ? 'rgba(255,139,23,0.1)' : 'rgba(255,139,23,0.15)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={18} color={theme.primary} />
      </View>
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 11,
          textAlign: 'center',
          color: theme.text,
          lineHeight: 14,
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const { isPhone, isMobile } = useResponsiveLayout();
  const layout = useMemo(() => getHomeDashboardLayoutStyles(), []);

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

  const kpiCards: HomeStatCardItem[] = useMemo(() => {
    if (!d) return [];
    return [
      {
        id: 'receber',
        icon: 'wallet-outline',
        title: 'Total a receber',
        value: formatBRL(d.totalReceberConsolidado),
        change: `${d.mensalidades.abertas + d.vendas.vendasAbertas} em aberto`,
        changeType: 'neutral',
      },
      {
        id: 'recorrencia',
        icon: 'repeat-outline',
        title: 'Recorrência',
        value: formatBRL(d.clientes.somaMensalidadeAtivos),
        change: `${d.clientes.ativos} ativos`,
        changeType: 'positive',
      },
      {
        id: 'ticket',
        icon: 'trending-up-outline',
        title: 'Ticket médio',
        value: formatBRL(d.clientes.ticketMedio),
        change: 'por cliente ativo',
      },
      {
        id: 'taxa',
        icon: 'checkmark-done-outline',
        title: 'Taxa vendas',
        value: `${d.vendas.taxaRecebimentoPct}%`,
        change: formatBRL(d.vendas.totalRecebido),
        changeType: d.vendas.taxaRecebimentoPct >= 70 ? 'positive' : 'negative',
      },
      {
        id: 'atrasadas',
        icon: 'alert-circle-outline',
        title: 'Mensal. atrasadas',
        value: String(d.mensalidades.atrasadas),
        change: d.mensalidades.proximosVencimentos7d
          ? `${d.mensalidades.proximosVencimentos7d} vencem em 7d`
          : 'sem vencimento próximo',
        changeType: d.mensalidades.atrasadas > 0 ? 'negative' : 'neutral',
      },
      {
        id: 'docs',
        icon: 'document-text-outline',
        title: 'Documentos',
        value: String(d.contasReceber.totalDocumentos),
        change: formatBRL(d.contasReceber.valorTotalDocumentos),
      },
      {
        id: 'vendas',
        icon: 'cart-outline',
        title: 'Vendido',
        value: formatBRL(d.vendas.totalVendido),
        change: `${d.vendas.parcelasAtrasadas} parc. atrasadas`,
        changeType: d.vendas.parcelasAtrasadas > 0 ? 'negative' : 'neutral',
      },
      {
        id: 'cancelados',
        icon: 'people-outline',
        title: 'Clientes',
        value: String(d.clientes.ativos),
        change: `${d.clientes.cancelados} cancelados`,
      },
    ];
  }, [d]);

  const mensRecebidoPct = d
    ? pct(d.mensalidades.valorRecebido, d.mensalidades.valorPendente + d.mensalidades.valorRecebido)
    : 0;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.background },
        title: {
          fontFamily: fonts.extrabold,
          fontSize: isPhone ? 20 : 22,
          letterSpacing: -0.4,
          color: theme.text,
        },
        subtitle: {
          fontFamily: fonts.regular,
          fontSize: 12,
          color: theme.textMuted,
          marginTop: 2,
        },
        updated: {
          marginTop: 8,
          fontFamily: fonts.medium,
          fontSize: 11,
          color: theme.textMuted,
        },
        sectionTitle: {
          fontFamily: fonts.bold,
          fontSize: 15,
          color: theme.text,
          marginTop: 16,
          marginBottom: 4,
        },
        alertRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
        alertTxt: {
          flex: 1,
          fontFamily: fonts.regular,
          fontSize: 13,
          lineHeight: 18,
          color: theme.text,
        },
        segRow: { gap: 4, marginBottom: 10 },
        segLabelRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 8,
        },
        segNome: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, color: theme.text },
        segQtd: { fontFamily: fonts.medium, fontSize: 11, color: theme.textMuted },
        segBarBg: {
          height: 5,
          borderRadius: 999,
          backgroundColor: theme.surfaceVariant,
          overflow: 'hidden',
        },
        loadingBox: { paddingVertical: 48, alignItems: 'center', gap: 12 },
        errorTxt: { fontFamily: fonts.regular, fontSize: 14, color: theme.textMuted },
      }),
    [theme, isPhone],
  );

  const padStyle = isPhone
    ? layout.mainAreaHomePhone
    : isMobile
      ? layout.mainAreaHomeMobile
      : layout.mainAreaHome;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[layout.homeScrollContent, padStyle]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
    >
      <View>
        <Text style={styles.title}>Visão geral</Text>
        <Text style={styles.subtitle}>
          Receita recorrente, cobranças e recebimentos consolidados.
        </Text>
        {d ? (
          <Text style={styles.updated}>
            Atualizado {formatDateTimeBRFromISO(d.geradoEm) || 'agora'}
          </Text>
        ) : null}
      </View>

      {loading && !d ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : null}

      {d ? (
        <>
          <HomeStatCardsGrid
            cards={kpiCards}
            theme={theme}
            isMobile={isMobile}
            isPhone={isPhone}
            style={{ marginTop: 12 }}
          />

          <View style={[layout.homeBottomRow, isMobile && layout.homeBottomRowMobile]}>
            <View
              style={[
                layout.homeSurfacePanel,
                isMobile && layout.homeSurfacePanelMobile,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[layout.homeSectionTitle, { color: theme.text }]}>Atenção</Text>
              {d.alertas.map((a, i) => (
                <View key={`${a.nivel}-${i}`} style={styles.alertRow}>
                  <Ionicons
                    name={
                      a.nivel === 'danger'
                        ? 'alert-circle'
                        : a.nivel === 'warning'
                          ? 'warning'
                          : 'information-circle'
                    }
                    size={16}
                    color={
                      a.nivel === 'danger'
                        ? theme.error
                        : a.nivel === 'warning'
                          ? theme.warning
                          : theme.textMuted
                    }
                  />
                  <Text style={styles.alertTxt}>{a.texto}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                layout.homeSurfacePanel,
                isMobile && layout.homeSurfacePanelMobile,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[layout.homeSectionTitle, { color: theme.text }]}>Recebimentos</Text>
              <ProgressTrack
                label="Mensalidades"
                percent={mensRecebidoPct}
                left={`Recebido ${formatBRL(d.mensalidades.valorRecebido)}`}
                right={`Pendente ${formatBRL(d.mensalidades.valorPendente)}`}
                color={theme.success}
                theme={theme}
              />
              <ProgressTrack
                label="Vendas"
                percent={d.vendas.taxaRecebimentoPct}
                left={`Recebido ${formatBRL(d.vendas.totalRecebido)}`}
                right={`Vendido ${formatBRL(d.vendas.totalVendido)}`}
                color={theme.primary}
                theme={theme}
              />
            </View>
          </View>

          {d.clientes.porSegmento.length > 0 ? (
            <View
              style={[
                layout.homeListCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[layout.homeSectionTitle, { color: theme.text, marginBottom: 10 }]}>
                Clientes por segmento
              </Text>
              {d.clientes.porSegmento.map((s) => {
                const p = pct(s.qtd, d.clientes.ativos);
                return (
                  <View key={s.codigo} style={styles.segRow}>
                    <View style={styles.segLabelRow}>
                      <Text style={styles.segNome} numberOfLines={1}>
                        {s.nome}
                      </Text>
                      <Text style={styles.segQtd}>
                        {s.qtd} · {p}%
                      </Text>
                    </View>
                    <View style={styles.segBarBg}>
                      <View
                        style={{
                          height: '100%',
                          width: `${Math.max(p, 2)}%`,
                          backgroundColor: theme.primary,
                        }}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Acesso rápido</Text>
          <Text style={styles.subtitle}>Atalhos do dia a dia</Text>
          <View style={layout.shortcutsGrid}>
            <Shortcut
              label="Azoup Web"
              icon="planet-outline"
              theme={theme}
              onPress={() => router.push('/(app)/azoup')}
            />
            <Shortcut
              label="Clientes"
              icon="people-outline"
              theme={theme}
              onPress={() => router.push('/(app)/clients')}
            />
            <Shortcut
              label="Gerar mensal."
              icon="add-circle-outline"
              theme={theme}
              onPress={() => router.push('/(app)/mensalidades/gerar')}
            />
            <Shortcut
              label="Mensalidades"
              icon="calendar-outline"
              theme={theme}
              onPress={() => router.push('/(app)/mensalidades')}
            />
            <Shortcut
              label="Vendas"
              icon="cart-outline"
              theme={theme}
              onPress={() => router.push('/(app)/vendas')}
            />
            <Shortcut
              label="A receber"
              icon="cash-outline"
              theme={theme}
              onPress={() => router.push('/(app)/contas-receber')}
            />
            <Shortcut
              label="NFS-e"
              icon="receipt-outline"
              theme={theme}
              onPress={() => router.push('/(app)/notas-fiscais')}
            />
            <Shortcut
              label="Config"
              icon="settings-outline"
              theme={theme}
              onPress={() => router.push('/(app)/configuracoes')}
            />
          </View>
        </>
      ) : !loading ? (
        <Text style={styles.errorTxt}>Não foi possível carregar o painel. Puxe para atualizar.</Text>
      ) : null}
    </ScrollView>
  );
}
