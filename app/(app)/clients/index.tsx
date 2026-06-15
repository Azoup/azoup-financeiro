import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { ImportClientsModal } from '@/components/ImportClientsModal';
import { useAuth } from '@/context/AuthContext';
import { fetchClientsExportAll, fetchClientsPage, type ClienteSituacaoFiltro } from '@/services/clientsService';
import { buildClientsListExport } from '@/utils/exportReportBuilders';
import { colors, radius, spacing } from '@/theme/colors';
import type { ClienteListItem, SortField, SortOrder } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { useDebounce } from '@/hooks/useDebounce';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

const SITUACAO_FILTERS: { label: string; value: ClienteSituacaoFiltro }[] = [
  { label: 'Todos', value: 'todos' },
  { label: 'Ativos', value: 'ativos' },
  { label: 'Cancelados', value: 'cancelados' },
];

const SORT_PRESETS: { label: string; field: SortField; order: SortOrder }[] = [
  { label: 'Nome A-Z', field: 'nome_cliente', order: 'asc' },
  { label: 'Nome Z-A', field: 'nome_cliente', order: 'desc' },
  { label: 'Mensalidade ↑', field: 'valor_mensalidade', order: 'asc' },
  { label: 'Mensalidade ↓', field: 'valor_mensalidade', order: 'desc' },
  { label: 'Segmento A-Z', field: 'segmento_cliente_codigo', order: 'asc' },
  { label: 'Segmento Z-A', field: 'segmento_cliente_codigo', order: 'desc' },
  { label: 'Recentes', field: 'created_at', order: 'desc' },
];

export default function ClientsListScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 320);
  const [sortField, setSortField] = useState<SortField>('nome_cliente');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [situacao, setSituacao] = useState<ClienteSituacaoFiltro>('todos');
  const [items, setItems] = useState<ClienteListItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const reqId = useRef(0);

  const sortLabel = useMemo(() => {
    const p = SORT_PRESETS.find((x) => x.field === sortField && x.order === sortOrder);
    return p?.label ?? 'Ordenar';
  }, [sortField, sortOrder]);

  const runFetch = useCallback(
    async (pageNum: number, mode: 'replace' | 'append') => {
      if (!user?.id) return;
      const id = ++reqId.current;
      const { items: chunk, hasMore: more } = await fetchClientsPage({
        userId: user.id,
        search: debounced,
        sortField,
        sortOrder,
        page: pageNum,
        situacao,
      });
      if (id !== reqId.current) return;
      if (mode === 'replace') setItems(chunk);
      else setItems((prev) => [...prev, ...chunk]);
      setHasMore(more);
    },
    [user?.id, debounced, sortField, sortOrder, situacao],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPage(0);
      setHasMore(true);
      try {
        await runFetch(0, 'replace');
      } catch (e) {
        if (!cancelled) {
          Toast.show({ type: 'error', text1: (e as Error).message });
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, sortField, sortOrder, situacao, runFetch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(0);
    try {
      await runFetch(0, 'replace');
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [runFetch]);

  const onImported = useCallback(async () => {
    setPage(0);
    try {
      await runFetch(0, 'replace');
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  }, [runFetch]);

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

  const renderItem = ({ item }: { item: ClienteListItem }) => (
    <Pressable onPress={() => router.push(`/(app)/clients/${item.id}`)}>
      <Card style={[styles.row, item.cancelado && styles.rowCancelado]}>
        <View style={styles.rowTop}>
          <View style={styles.rowTitleBlock}>
            <Text style={[styles.nome, item.cancelado && styles.nomeCancelado]}>{item.nome_cliente}</Text>
            {item.cancelado ? (
              <View style={styles.badgeCancel}>
                <Text style={styles.badgeCancelText}>Cancelado</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.valor, item.cancelado && styles.valorCancelado]}>
            {formatBRL(item.valor_mensalidade)}
          </Text>
        </View>
        <Text style={styles.empresa}>{item.nome_empresa || '—'}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaText}>Doc. {item.documento}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>
            {item.segmento_cliente?.nome ?? item.segmento_cliente_codigo ?? '—'}
          </Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>
            {(item.contatos_count ?? 0) === 1 ? '1 contato' : `${item.contatos_count ?? 0} contatos`}
          </Text>
        </View>
        <Text style={styles.createdAt}>
          Cadastro: {formatDateTimeBRFromISO(item.created_at) || '—'}
        </Text>
      </Card>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={20} color={colors.gray400} style={styles.searchIcon} />
            <TextInput
              style={styles.search}
              placeholder="Buscar por nome, empresa ou documento"
              placeholderTextColor={colors.gray400}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Importar clientes de planilha"
            onPress={() => setImportOpen(true)}
            style={({ pressed }) => [styles.importBtn, pressed && styles.importBtnPressed]}
          >
            <Ionicons name="cloud-upload-outline" size={22} color={colors.petroleum} />
          </Pressable>
        </View>
        <ExportReportButtons
          disabled={!user?.id}
          getReport={async () => {
            if (!user?.id) throw new Error('Usuário não autenticado.');
            const all = await fetchClientsExportAll({
              userId: user.id,
              search: debounced,
              sortField,
              sortOrder,
              situacao,
            });
            return buildClientsListExport(all, {
              search: debounced,
              situacao,
              sortLabel,
            });
          }}
        />
        <Text style={styles.filterTitle}>Situação</Text>
        <View style={styles.situacaoRow}>
          {SITUACAO_FILTERS.map((f) => {
            const active = situacao === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setSituacao(f.value)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sortTitle}>Ordenação: {sortLabel}</Text>
        <FlatList
          horizontal
          data={SORT_PRESETS}
          keyExtractor={(i) => `${i.field}-${i.order}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: p }) => {
            const active = p.field === sortField && p.order === sortOrder;
            return (
              <Pressable
                onPress={() => {
                  setSortField(p.field);
                  setSortOrder(p.order);
                }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.orange} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 88 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />
          }
          onEndReachedThreshold={0.35}
          onEndReached={loadMore}
          ListEmptyComponent={
            <Text style={styles.empty}>Nenhum cliente encontrado.</Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={colors.orange} />
            ) : null
          }
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={() => router.push('/(app)/clients/new')}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>

      <ImportClientsModal
        visible={importOpen}
        userId={user?.id}
        onClose={() => setImportOpen(false)}
        onImported={onImported}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  toolbar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.gray50,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
    paddingHorizontal: spacing.md,
    flex: 1,
  },
  importBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtnPressed: {
    opacity: 0.85,
    backgroundColor: 'rgba(232, 106, 36, 0.08)',
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  search: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.gray800,
  },
  filterTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  situacaoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sortTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  chipActive: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
  },
  chipTextActive: {
    color: colors.petroleum,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  row: {
    marginBottom: spacing.md,
  },
  rowCancelado: {
    opacity: 0.72,
    borderColor: colors.gray200,
  },
  rowTitleBlock: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badgeCancel: {
    backgroundColor: 'rgba(198, 40, 40, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeCancelText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
  },
  nomeCancelado: {
    textDecorationLine: 'line-through',
    color: colors.gray600,
  },
  valorCancelado: {
    color: colors.gray600,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  nome: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.petroleum,
  },
  valor: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.orange,
  },
  empresa: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.gray600,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  metaText: {
    fontSize: 12,
    color: colors.gray400,
  },
  metaDot: {
    marginHorizontal: spacing.xs,
    color: colors.gray200,
  },
  createdAt: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.gray400,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.xl,
    color: colors.gray600,
    fontSize: 15,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
