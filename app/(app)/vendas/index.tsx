import { Card } from '@/components/Card';
import { DatePickerField } from '@/components/DatePickerField';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ClienteVendaPicker } from '@/components/vendas/ClienteVendaPicker';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchFormasPagamentoAtivas } from '@/services/formasPagamentoService';
import {
  fetchVendaFinanceiroStats,
  fetchVendasExportAll,
  fetchVendasPage,
  type ClienteVendaOption,
} from '@/services/vendasService';
import { buildVendasListExport } from '@/utils/exportReportBuilders';
import { colors, radius, spacing } from '@/theme/colors';
import type { FormaPagamento, VendaListFilters, VendaListRow, VendaStatus } from '@/types/vendas';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO, toISODate } from '@/utils/date';
import { vendaDescricaoResumo } from '@/utils/vendasDescricao';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

const STATUS_OPTS: { id: VendaStatus | 'todos'; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'pendente', label: 'Pendente' },
  { id: 'parcial', label: 'Parcial' },
  { id: 'quitada', label: 'Quitada' },
  { id: 'cancelada', label: 'Cancelada' },
];

function statusStyle(s: VendaStatus): { bg: string; fg: string } {
  switch (s) {
    case 'quitada':
      return { bg: '#e8f5e9', fg: colors.success };
    case 'parcial':
      return { bg: '#fff3e0', fg: colors.orangeDark };
    case 'cancelada':
      return { bg: colors.gray100, fg: colors.gray600 };
    default:
      return { bg: '#e3f2fd', fg: colors.petroleum };
  }
}

export default function VendasIndexScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const [filters, setFilters] = useState<VendaListFilters>({
    search: '',
    status: 'todos',
    formaPagamentoId: 'todos',
    dataDe: null,
    dataAte: null,
    vencimentoDe: null,
    vencimentoAte: null,
    pagamentoDe: null,
    pagamentoAte: null,
    clienteId: 'todos',
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [clientePicker, setClientePicker] = useState(false);
  const [clienteFilter, setClienteFilter] = useState<ClienteVendaOption | null>(null);
  const [formas, setFormas] = useState<FormaPagamento[]>([]);
  const [stats, setStats] = useState<{
    totalVendido: number;
    totalRecebido: number;
    totalPendente: number;
    parcelasAtrasadas: number;
    vendasAbertas: number;
  } | null>(null);
  const [rows, setRows] = useState<VendaListRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reqId = useRef(0);

  const activeFilters = useMemo(
    () => ({
      ...filters,
      search: debounced,
      clienteId: clienteFilter?.id ?? 'todos',
    }),
    [filters, debounced, clienteFilter],
  );

  useEffect(() => {
    fetchFormasPagamentoAtivas().then(setFormas);
  }, []);

  const loadStats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const s = await fetchVendaFinanceiroStats(user.id);
      setStats(s);
    } catch {
      setStats(null);
    }
  }, [user?.id]);

  const runFetch = useCallback(
    async (pageNum: number, mode: 'replace' | 'append') => {
      if (!user?.id) return;
      const id = ++reqId.current;
      const { rows: chunk, hasMore: more } = await fetchVendasPage({
        userId: user.id,
        filters: activeFilters,
        page: pageNum,
      });
      if (id !== reqId.current) return;
      if (mode === 'replace') setRows(chunk);
      else setRows((prev) => [...prev, ...chunk]);
      setHasMore(more);
    },
    [user?.id, activeFilters],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPage(0);
      setHasMore(true);
      try {
        await Promise.all([runFetch(0, 'replace'), loadStats()]);
      } catch (e) {
        if (!cancelled) {
          Toast.show({ type: 'error', text1: (e as Error).message });
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFilters, runFetch, loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(0);
    try {
      await Promise.all([runFetch(0, 'replace'), loadStats()]);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [runFetch, loadStats]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    const next = page + 1;
    try {
      await runFetch(next, 'append');
      setPage(next);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, page, runFetch]);

  const pct = (part: number, whole: number) => {
    if (!whole || whole <= 0) return 0;
    return Math.min(100, Math.round((part / whole) * 100));
  };

  const renderItem = ({ item }: { item: VendaListRow }) => {
    const st = statusStyle(item.status);
    const cli = item.cliente?.nome_cliente ?? '—';
    const emp = item.cliente?.nome_empresa;
    return (
      <Pressable onPress={() => router.push(`/(app)/vendas/${item.id}`)}>
        <Card style={styles.cardItem}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cli}>{cli}</Text>
              {emp ? <Text style={styles.emp}>{emp}</Text> : null}
            </View>
            <View style={[styles.tag, { backgroundColor: st.bg }]}>
              <Text style={[styles.tagTxt, { color: st.fg }]}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.desc} numberOfLines={2}>
            {vendaDescricaoResumo(item)}
          </Text>
          <View style={styles.metrics}>
            <View>
              <Text style={styles.mLabel}>Total</Text>
              <Text style={styles.mVal}>{formatBRL(item.valor_total)}</Text>
            </View>
            <View>
              <Text style={styles.mLabel}>Parcelas</Text>
              <Text style={styles.mVal}>{item.qtd_parcelas ?? 0}</Text>
            </View>
            <View>
              <Text style={styles.mLabel}>Pago</Text>
              <Text style={styles.mValOk}>{formatBRL(item.valor_pago_sum ?? 0)}</Text>
            </View>
            <View>
              <Text style={styles.mLabel}>Pendente</Text>
              <Text style={styles.mValPen}>{formatBRL(item.valor_pendente ?? 0)}</Text>
            </View>
          </View>
          <Text style={styles.date}>{formatDateTimeBRFromISO(item.created_at)}</Text>
        </Card>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.statsStrip}>
        {stats ? (
          <>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Vendido</Text>
              <Text style={styles.statVal} numberOfLines={1} adjustsFontSizeToFit>
                {formatBRL(stats.totalVendido)}
              </Text>
              <View style={styles.statFooter}>
                <View style={styles.miniBar}>
                  <View
                    style={[
                      styles.miniFill,
                      {
                        width: `${pct(stats.totalRecebido, stats.totalVendido)}%`,
                        backgroundColor: colors.success,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.statSub}>Recebido {formatBRL(stats.totalRecebido)}</Text>
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Pendente</Text>
              <Text style={[styles.statVal, { color: colors.orange }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatBRL(stats.totalPendente)}
              </Text>
              <View style={styles.statFooter} />
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Atrasadas</Text>
              <Text style={[styles.statVal, { color: colors.danger }]}>{stats.parcelasAtrasadas}</Text>
              <View style={styles.statFooter}>
                <Text style={styles.statSub}>{stats.vendasAbertas} vendas em aberto</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={[styles.statCard, styles.statCardLoading, styles.statCardSolo]}>
            {loading ? <ActivityIndicator color={colors.orange} /> : null}
          </View>
        )}
      </View>

      <View style={styles.toolbar}>
        <ExportReportButtons
          compact
          disabled={!user?.id}
          getReport={async () => {
            if (!user?.id) throw new Error('Usuário não autenticado.');
            const [all, s] = await Promise.all([
              fetchVendasExportAll({ userId: user.id, filters: activeFilters }),
              fetchVendaFinanceiroStats(user.id),
            ]);
            const filterSummary = `Status: ${activeFilters.status} · busca: ${activeFilters.search || '—'}`;
            return buildVendasListExport(all, s, filterSummary);
          }}
        />
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.gray400} />
          <TextInput
            style={styles.searchIn}
            placeholder="Buscar na descrição"
            placeholderTextColor={colors.gray400}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setFilterOpen(true)}
          accessibilityLabel="Filtros"
        >
          <Ionicons name="options-outline" size={20} color={colors.petroleum} />
        </Pressable>
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.orange} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.25}
          ListEmptyComponent={
            <Text style={styles.empty}>Nenhuma venda encontrada.</Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.orange} /> : null
          }
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: spacing.lg + insets.bottom }]}
        onPress={() => router.push('/(app)/vendas/new')}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>

      <Modal visible={filterOpen} animationType="slide" transparent onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Filtros</Text>
            <ScrollView
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              nestedScrollEnabled
            >
            <Text style={styles.fLab}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {STATUS_OPTS.map((o) => {
                const on = filters.status === o.id;
                return (
                  <Pressable
                    key={o.id}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setFilters((f) => ({ ...f, status: o.id }))}
                  >
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.fLab}>Forma de pagamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <Pressable
                style={[styles.chip, filters.formaPagamentoId === 'todos' && styles.chipOn]}
                onPress={() => setFilters((f) => ({ ...f, formaPagamentoId: 'todos' }))}
              >
                <Text
                  style={[
                    styles.chipTxt,
                    filters.formaPagamentoId === 'todos' && styles.chipTxtOn,
                  ]}
                >
                  Todas
                </Text>
              </Pressable>
              {formas.map((fp) => {
                const on = filters.formaPagamentoId === fp.id;
                return (
                  <Pressable
                    key={fp.id}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setFilters((f) => ({ ...f, formaPagamentoId: fp.id }))}
                  >
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{fp.nome}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.fLab}>Cliente</Text>
            <Pressable
              style={styles.cliPick}
              onPress={() => {
                setFilterOpen(false);
                setClientePicker(true);
              }}
            >
              <Text style={styles.cliPickTxt}>
                {clienteFilter ? clienteFilter.nome_cliente : 'Todos os clientes'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
            </Pressable>
            {clienteFilter ? (
              <Pressable onPress={() => setClienteFilter(null)}>
                <Text style={styles.clearCli}>Limpar cliente</Text>
              </Pressable>
            ) : null}
            <Text style={styles.fLab}>Data da venda (criação)</Text>
            <Text style={styles.fHint}>Filtra pelo momento em que a venda foi registrada no sistema.</Text>
            <DatePickerField
              label="Data inicial (criação)"
              value={filters.dataDe ? new Date(filters.dataDe + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, dataDe: d ? toISODate(d) : null }))}
            />
            <DatePickerField
              label="Data final (criação)"
              value={filters.dataAte ? new Date(filters.dataAte + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, dataAte: d ? toISODate(d) : null }))}
            />
            <Text style={styles.fLab}>Vencimento de parcela</Text>
            <Text style={styles.fHint}>
              Mostra vendas em que alguma parcela tem vencimento no intervalo (opcional).
            </Text>
            <DatePickerField
              label="Vencimento a partir de"
              value={filters.vencimentoDe ? new Date(filters.vencimentoDe + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, vencimentoDe: d ? toISODate(d) : null }))}
            />
            <DatePickerField
              label="Vencimento até"
              value={filters.vencimentoAte ? new Date(filters.vencimentoAte + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, vencimentoAte: d ? toISODate(d) : null }))}
            />
            <Text style={styles.fLab}>Data do pagamento</Text>
            <Text style={styles.fHint}>
              Mostra vendas em que algum pagamento registrado tem data no intervalo (opcional).
            </Text>
            <DatePickerField
              label="Pagamento a partir de"
              value={filters.pagamentoDe ? new Date(filters.pagamentoDe + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, pagamentoDe: d ? toISODate(d) : null }))}
            />
            <DatePickerField
              label="Pagamento até"
              value={filters.pagamentoAte ? new Date(filters.pagamentoAte + 'T12:00:00') : null}
              onChange={(d) => setFilters((f) => ({ ...f, pagamentoAte: d ? toISODate(d) : null }))}
            />
            <PrimaryButton title="Aplicar" onPress={() => setFilterOpen(false)} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {user?.id ? (
        <ClienteVendaPicker
          visible={clientePicker}
          userId={user.id}
          onClose={() => setClientePicker(false)}
          onSelect={(c) => {
            setClienteFilter(c);
            setClientePicker(false);
          }}
          selectedId={clienteFilter?.id}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  statsStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    alignItems: 'stretch',
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 112,
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: colors.petroleumDark,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  statCardSolo: {
    flex: 1,
    minHeight: 72,
  },
  statCardLoading: { justifyContent: 'center', alignItems: 'center' },
  statLabel: { fontSize: 11, color: colors.gray600, fontWeight: '600' },
  statVal: { fontSize: 16, fontWeight: '800', color: colors.petroleum, marginTop: 4 },
  statFooter: {
    minHeight: 40,
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  statSub: { fontSize: 10, color: colors.gray600, marginTop: 4 },
  miniBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray100,
    overflow: 'hidden',
  },
  miniFill: { height: '100%', borderRadius: 2 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    paddingHorizontal: spacing.sm,
    minHeight: 44,
  },
  searchIn: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.gray800,
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardItem: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cli: { fontSize: 16, fontWeight: '700', color: colors.petroleum },
  emp: { fontSize: 13, color: colors.gray600, marginTop: 2 },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  tagTxt: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  desc: { marginTop: spacing.sm, fontSize: 14, color: colors.gray800 },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  mLabel: { fontSize: 11, color: colors.gray400, fontWeight: '600' },
  mVal: { fontSize: 14, fontWeight: '700', color: colors.petroleum },
  mValOk: { fontSize: 14, fontWeight: '700', color: colors.success },
  mValPen: { fontSize: 14, fontWeight: '700', color: colors.orange },
  date: { marginTop: spacing.sm, fontSize: 12, color: colors.gray400 },
  empty: { textAlign: 'center', color: colors.gray400, marginTop: spacing.xl },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.petroleumDark,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.petroleum, marginBottom: spacing.md },
  modalScroll: { maxHeight: '78%' },
  modalScrollContent: { paddingBottom: spacing.lg },
  fLab: { fontSize: 13, fontWeight: '600', color: colors.gray600, marginBottom: spacing.sm },
  fHint: {
    fontSize: 12,
    color: colors.gray600,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  chips: { marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  chipOn: { backgroundColor: colors.petroleum, borderColor: colors.petroleum },
  chipTxt: { fontSize: 13, color: colors.gray800 },
  chipTxtOn: { color: colors.white, fontWeight: '600' },
  cliPick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cliPickTxt: { fontSize: 15, color: colors.petroleum, fontWeight: '600' },
  clearCli: { color: colors.orange, fontWeight: '600', marginBottom: spacing.md },
});
