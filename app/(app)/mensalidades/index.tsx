import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildMensalidadesExport } from '@/utils/exportReportBuilders';
import { MarcarPagamentoMensalidadeGeradaModal } from '@/components/mensalidades/MarcarPagamentoMensalidadeGeradaModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  fetchMensalidadesGeradasHistorico,
  fetchPagamentosMensalidadeGerada,
  mensalidadeGeradaStatusVisual,
  podeRegistrarPagamentoMensalidadeGerada,
  registrarPagamentoMensalidadeGerada,
} from '@/services/mensalidadeGeradaService';
import { colors, radius, spacing } from '@/theme/colors';
import type {
  MensalidadeGerada,
  MensalidadeGeradaStatusVisual,
  PagamentoMensalidadeGerada,
} from '@/types/mensalidadeGerada';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { reaisParaCentavos } from '@/utils/vendasParcelas';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

type StatusFiltro = 'todos' | MensalidadeGeradaStatusVisual;

const STATUS_OPTS: { id: StatusFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'pendente', label: 'Pendente' },
  { id: 'parcial', label: 'Parcial' },
  { id: 'pago', label: 'Pago' },
  { id: 'atrasado', label: 'Atrasado' },
  { id: 'cancelado', label: 'Cancelado' },
];

function statusColor(vis: MensalidadeGeradaStatusVisual): { bg: string; fg: string } {
  switch (vis) {
    case 'pago':
      return { bg: '#e8f5e9', fg: colors.success };
    case 'parcial':
      return { bg: '#fff3e0', fg: colors.orangeDark };
    case 'atrasado':
      return { bg: '#ffebee', fg: colors.danger };
    case 'cancelado':
      return { bg: colors.gray100, fg: colors.gray600 };
    default:
      return { bg: '#e3f2fd', fg: colors.petroleum };
  }
}

function unwrapCliente(m: MensalidadeGerada): { nome: string; empresa: string | null } {
  const c = m.clientes;
  const row = Array.isArray(c) ? c[0] : c;
  return {
    nome: row?.nome_cliente ?? '—',
    empresa: row?.nome_empresa ?? null,
  };
}

function matchSearch(m: MensalidadeGerada, term: string): boolean {
  const cli = unwrapCliente(m);
  const hay = [
    cli.nome,
    cli.empresa ?? '',
    m.competencia ?? '',
    m.data_vencimento,
    m.forma_pagamento ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(term);
}

export default function HistoricoMensalidadesGeradasScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { cliente: clienteParam } = useLocalSearchParams<{ cliente?: string | string[] }>();
  const clienteFiltro = Array.isArray(clienteParam) ? clienteParam[0] : clienteParam;

  const [allRows, setAllRows] = useState<MensalidadeGerada[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFiltro>('todos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<Record<string, PagamentoMensalidadeGerada[]>>({});
  const [loadingPay, setLoadingPay] = useState<string | null>(null);
  const [registroPagamento, setRegistroPagamento] = useState<MensalidadeGerada | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const all = await fetchMensalidadesGeradasHistorico(user.id);
    setAllRows(all);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch (e) {
          if (alive) Toast.show({ type: 'error', text1: (e as Error).message });
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const filteredRows = useMemo(() => {
    let list = allRows;
    if (clienteFiltro) {
      list = list.filter((m) => m.cliente_id === String(clienteFiltro));
    }
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      list = list.filter((m) => matchSearch(m, term));
    }
    if (statusFilter !== 'todos') {
      list = list.filter((m) => mensalidadeGeradaStatusVisual(m) === statusFilter);
    }
    return list;
  }, [allRows, clienteFiltro, debouncedSearch, statusFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (pagamentos[id]) return;
    setLoadingPay(id);
    try {
      const list = await fetchPagamentosMensalidadeGerada(id);
      setPagamentos((p) => ({ ...p, [id]: list }));
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoadingPay(null);
    }
  };

  const onMarcarPago = async (payload: Parameters<typeof registrarPagamentoMensalidadeGerada>[2]) => {
    if (!user?.id || !registroPagamento) return;
    await registrarPagamentoMensalidadeGerada(user.id, registroPagamento.id, payload);
    setRegistroPagamento(null);
    setPagamentos({});
    setExpanded(null);
    await load();
  };

  const irGerarMensalidade = () => {
    if (clienteFiltro) {
      router.push(`/(app)/mensalidades/gerar?cliente=${encodeURIComponent(String(clienteFiltro))}`);
    } else {
      router.push('/(app)/mensalidades/gerar');
    }
  };

  const limparFiltros = () => {
    setSearch('');
    setStatusFilter('todos');
  };

  const temFiltroAtivo = Boolean(search.trim()) || statusFilter !== 'todos';

  const totalBase = useMemo(() => {
    if (clienteFiltro) {
      return allRows.filter((m) => m.cliente_id === String(clienteFiltro)).length;
    }
    return allRows.length;
  }, [allRows, clienteFiltro]);

  const renderItem = ({ item: m }: { item: MensalidadeGerada }) => {
    const cli = unwrapCliente(m);
    const vis = mensalidadeGeradaStatusVisual(m);
    const st = statusColor(vis);
    const pend = Math.max(0, reaisParaCentavos(m.valor) - reaisParaCentavos(m.valor_pago)) / 100;
    const showPay = podeRegistrarPagamentoMensalidadeGerada(m);
    const exp = expanded === m.id;
    const pays = pagamentos[m.id];
    const venc = m.data_vencimento.split('-').reverse().join('/');

    return (
      <Card style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.cardTitleCol}>
            <Text style={styles.cli} numberOfLines={1}>
              {cli.nome}
            </Text>
            {cli.empresa ? (
              <Text style={styles.emp} numberOfLines={1}>
                {cli.empresa}
              </Text>
            ) : null}
          </View>
          <View style={[styles.tag, { backgroundColor: st.bg }]}>
            <Text style={[styles.tagTxt, { color: st.fg }]}>{vis}</Text>
          </View>
        </View>

        <View style={styles.compactMeta}>
          {m.competencia ? <Text style={styles.metaTxt}>Comp. {m.competencia}</Text> : null}
          <Text style={styles.metaTxt}>Venc. {venc}</Text>
          <Text style={styles.metaTxt}>
            {formatBRL(m.valor)} · pago {formatBRL(m.valor_pago)} · pend. {formatBRL(pend)}
          </Text>
        </View>

        <View style={styles.btnRow}>
          {showPay ? (
            <Pressable style={styles.btnSmPago} onPress={() => setRegistroPagamento(m)}>
              <Ionicons name="checkmark" size={14} color={colors.white} />
              <Text style={styles.btnSmPagoTxt}>Pagar</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.btnSmGhost} onPress={() => toggleExpand(m.id)}>
            {loadingPay === m.id ? (
              <ActivityIndicator size="small" color={colors.orange} />
            ) : (
              <Ionicons name="list-outline" size={14} color={colors.petroleum} />
            )}
            <Text style={styles.btnSmGhostTxt}>{exp ? 'Ocultar' : 'Pagtos'}</Text>
          </Pressable>
        </View>

        {exp ? (
          <View style={styles.hist}>
            {!pays?.length ? (
              <Text style={styles.histEmpty}>Nenhum pagamento.</Text>
            ) : (
              pays.map((p) => (
                <View key={p.id} style={styles.histRow}>
                  <Text style={styles.histVal}>{formatBRL(p.valor_pago)}</Text>
                  <Text style={styles.histMeta}>
                    {p.data_pagamento.split('-').reverse().join('/')} · {p.forma_pagamento}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}
      </Card>
    );
  };

  const listHeader = (
    <>
      {clienteFiltro ? (
        <View style={styles.banner}>
          <Text style={styles.bannerTxt}>Filtrando por um cliente</Text>
          <Pressable onPress={() => router.replace('/(app)/mensalidades')}>
            <Text style={styles.bannerLink}>Mostrar todos</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <ExportReportButtons
          disabled={loading}
          getReport={() => buildMensalidadesExport(filteredRows, clienteFiltro)}
        />
        <PrimaryButton title="Gerar mensalidade" onPress={irGerarMensalidade} style={styles.btnGerar} />

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.gray400} />
          <TextInput
            style={styles.searchIn}
            placeholder="Buscar cliente, empresa ou competência"
            placeholderTextColor={colors.gray400}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.gray400} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <Text style={styles.filterLabel}>Situação</Text>
          {temFiltroAtivo ? (
            <Pressable onPress={limparFiltros}>
              <Text style={styles.clearLink}>Limpar filtros</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {STATUS_OPTS.map((o) => {
            const active = statusFilter === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => setStatusFilter(o.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.resultCount}>
          {loading ? 'Carregando…' : `${filteredRows.length} de ${totalBase} mensalidade(s)`}
        </Text>
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={filteredRows}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.orange} />
          ) : (
            <Text style={styles.empty}>
              {allRows.length === 0
                ? 'Nenhuma mensalidade ainda. Use "Gerar mensalidade" para registrar a primeira geração.'
                : 'Nenhum resultado para os filtros atuais.'}
            </Text>
          )
        }
      />

      <MarcarPagamentoMensalidadeGeradaModal
        visible={registroPagamento != null}
        registro={registroPagamento}
        onClose={() => setRegistroPagamento(null)}
        onConfirm={onMarcarPago}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.petroleumLight,
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
  },
  bannerTxt: { color: colors.white, fontSize: 12, fontWeight: '600' },
  bannerLink: { color: colors.orangeLight, fontWeight: '700', fontSize: 12 },
  toolbar: {
    marginBottom: spacing.sm,
  },
  btnGerar: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchIn: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 15,
    color: colors.gray800,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
  },
  clearLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.orange,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
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
  chipTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
  },
  chipTxtActive: {
    color: colors.petroleum,
  },
  resultCount: {
    fontSize: 12,
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    color: colors.gray400,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    fontSize: 14,
  },
  card: {
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  cli: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.petroleum,
  },
  emp: {
    fontSize: 11,
    color: colors.gray600,
    marginTop: 1,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  tagTxt: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  compactMeta: {
    marginTop: spacing.xs,
    gap: 2,
  },
  metaTxt: {
    fontSize: 11,
    color: colors.gray600,
    lineHeight: 15,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btnSmPago: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.success,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    minHeight: 32,
  },
  btnSmPagoTxt: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 12,
  },
  btnSmGhost: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
    minHeight: 32,
  },
  btnSmGhostTxt: {
    color: colors.petroleum,
    fontWeight: '600',
    fontSize: 12,
  },
  hist: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray100,
  },
  histEmpty: {
    fontSize: 11,
    color: colors.gray400,
  },
  histRow: {
    marginBottom: spacing.xs,
  },
  histVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
  },
  histMeta: {
    fontSize: 11,
    color: colors.gray600,
  },
});
