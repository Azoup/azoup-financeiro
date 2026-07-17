import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { buildMensalidadesExport } from '@/utils/exportReportBuilders';
import { MarcarPagamentoMensalidadeGeradaModal } from '@/components/mensalidades/MarcarPagamentoMensalidadeGeradaModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { sincronizarCarnesMensalidadesFaltantes } from '@/services/boletoParcelaService';
import {
  fetchMensalidadesGeradasHistorico,
  fetchPagamentosMensalidadesPorIds,
  mensalidadeGeradaStatusVisual,
  podeRegistrarPagamentoMensalidadeGerada,
  registrarPagamentoMensalidadeGerada,
} from '@/services/mensalidadeGeradaService';
import {
  fetchNotaFiscalPorMensalidade,
  fetchNotasFiscaisPorMensalidadeIds,
  gerarNotaFiscalParaMensalidade,
} from '@/services/notaFiscalService';
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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { showAppError, showAppInfo, showAppSuccess } from '@/utils/appToast';

type StatusFiltro = 'todos' | MensalidadeGeradaStatusVisual;

const MENSALIDADES_POR_PAGINA = 10;

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
  const [pagamentos, setPagamentos] = useState<Record<string, PagamentoMensalidadeGerada[]>>({});
  const [registroPagamento, setRegistroPagamento] = useState<MensalidadeGerada | null>(null);
  const [nfPosPagamento, setNfPosPagamento] = useState<MensalidadeGerada | null>(null);
  const [nfBusyId, setNfBusyId] = useState<string | null>(null);
  const [nfEmitindoPosPagamento, setNfEmitindoPosPagamento] = useState(false);
  const [nfConfirmMensalidade, setNfConfirmMensalidade] = useState<MensalidadeGerada | null>(null);
  const [nfEmitidas, setNfEmitidas] = useState<Record<string, { numero: number | null }>>({});
  const [pagina, setPagina] = useState(1);

  const load = useCallback(async () => {
    if (!user?.id) return;
    await sincronizarCarnesMensalidadesFaltantes(user.id).catch(() => undefined);
    const all = await fetchMensalidadesGeradasHistorico(user.id);
    setAllRows(all);
    const nfMap = await fetchNotasFiscaisPorMensalidadeIds(
      user.id,
      all.map((m) => m.id),
    ).catch(() => new Map());
    const emitidas: Record<string, { numero: number | null }> = {};
    for (const [mid, nf] of nfMap) {
      if (nf.status === 'autorizada') emitidas[mid] = { numero: nf.numero ?? null };
    }
    setNfEmitidas(emitidas);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch (e) {
          if (alive) showAppError((e as Error).message);
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

  const totalPaginas = Math.max(1, Math.ceil(filteredRows.length / MENSALIDADES_POR_PAGINA));
  const rowsPagina = useMemo(() => {
    const inicio = (pagina - 1) * MENSALIDADES_POR_PAGINA;
    return filteredRows.slice(inicio, inicio + MENSALIDADES_POR_PAGINA);
  }, [filteredRows, pagina]);

  useEffect(() => {
    setPagina(1);
  }, [clienteFiltro, debouncedSearch, statusFilter]);

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas));
  }, [totalPaginas]);

  useEffect(() => {
    let alive = true;
    const ids = rowsPagina.map((m) => m.id);
    if (!ids.length) {
      setPagamentos({});
      return;
    }
    (async () => {
      try {
        const map = await fetchPagamentosMensalidadesPorIds(ids);
        if (alive) setPagamentos(map);
      } catch (e) {
        if (alive) {
          setPagamentos({});
          showAppError((e as Error).message);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [rowsPagina]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      showAppError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onMarcarPago = async (payload: Parameters<typeof registrarPagamentoMensalidadeGerada>[2]) => {
    if (!user?.id || !registroPagamento) return;
    const mensalidade = registroPagamento;
    await registrarPagamentoMensalidadeGerada(user.id, mensalidade.id, payload);
    setRegistroPagamento(null);
    await load();
    const existente = await fetchNotaFiscalPorMensalidade(user.id, mensalidade.id).catch(() => null);
    if (!existente && mensalidade.status !== 'cancelado') {
      setNfPosPagamento(mensalidade);
    }
  };

  const emitirNfMensalidade = async (m: MensalidadeGerada, emitenteId?: string) => {
    if (!user?.id) return;
    setNfBusyId(m.id);
    try {
      const res = await gerarNotaFiscalParaMensalidade(
        user.id,
        {
          id: m.id,
          cliente_id: m.cliente_id,
          valor: m.valor,
          competencia: m.competencia,
        },
        { emitenteId: emitenteId || undefined },
      );
      if (res.success) {
        showAppSuccess(res.message ?? 'NFS-e emitida com sucesso.', 'Veja em Notas fiscais.');
        router.push('/(app)/notas-fiscais');
      } else if (res.ignorada) {
        showAppInfo(res.message ?? 'Cliente sem NF no cadastro (lote automático).');
      } else {
        showAppError(
          res.message ?? 'Não foi possível emitir a NFS-e.',
          res.notaId ? 'Toque em Notas fiscais para ver o motivo e reemitir.' : undefined,
        );
        if (res.notaId) router.push('/(app)/notas-fiscais');
      }
    } catch (e) {
      showAppError((e as Error).message);
    } finally {
      setNfBusyId(null);
    }
  };

  const emitirNfPosPagamento = async (emitenteId?: string) => {
    if (!nfPosPagamento) return;
    setNfEmitindoPosPagamento(true);
    try {
      await emitirNfMensalidade(nfPosPagamento, emitenteId);
    } finally {
      setNfEmitindoPosPagamento(false);
      setNfPosPagamento(null);
    }
  };

  const executarNfConfirmada = async (emitenteId?: string) => {
    if (!nfConfirmMensalidade) return;
    await emitirNfMensalidade(nfConfirmMensalidade, emitenteId);
    setNfConfirmMensalidade(null);
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
    const jaPago = vis === 'pago';
    const nfEmitida = nfEmitidas[m.id];
    const showNf = m.status !== 'cancelado' && !nfEmitida;
    const nfBusy = nfBusyId === m.id;
    const pays = pagamentos[m.id] ?? [];
    const venc = m.data_vencimento.split('-').reverse().join('/');

    return (
      <Card style={styles.card} padded={false}>
        <View style={styles.cardHead}>
          <View style={styles.cardTitleCol}>
            <Text style={styles.cli} numberOfLines={2}>
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
          {m.competencia ? <Text style={styles.metaTxt} numberOfLines={1}>Comp. {m.competencia}</Text> : null}
          <Text style={styles.metaTxt} numberOfLines={1}>Venc. {venc}</Text>
          <Text style={styles.metaTxt} numberOfLines={2}>
            {formatBRL(m.valor)} · pago {formatBRL(m.valor_pago)}
          </Text>
          <Text style={styles.metaTxt} numberOfLines={1}>Pend. {formatBRL(pend)}</Text>
        </View>

        <View style={styles.hist}>
          <Text style={styles.histTitle}>Pagamentos</Text>
          {!pays.length ? (
            <Text style={styles.histEmpty}>Nenhum pagamento.</Text>
          ) : (
            pays.map((p) => (
              <View key={p.id} style={styles.histRow}>
                <Text style={styles.histVal}>{formatBRL(p.valor_pago)}</Text>
                <Text style={styles.histMeta} numberOfLines={2}>
                  {p.data_pagamento.split('-').reverse().join('/')} · {p.forma_pagamento}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.btnRow}>
          {showPay ? (
            <Pressable style={styles.btnSmLancar} onPress={() => setRegistroPagamento(m)}>
              <Ionicons name="cash-outline" size={13} color={colors.white} />
              <Text style={styles.btnSmPagoTxt} numberOfLines={1}>
                Lançar pgt.
              </Text>
            </Pressable>
          ) : jaPago ? (
            <View style={styles.btnSmPago} accessibilityState={{ disabled: true }}>
              <Ionicons name="checkmark-circle" size={13} color={colors.white} />
              <Text style={styles.btnSmPagoTxt}>Pago</Text>
            </View>
          ) : null}
        </View>

        {nfEmitida ? (
          <View style={styles.nfEmitidaBadge}>
            <Ionicons name="document-text-outline" size={13} color={colors.success} />
            <Text style={styles.nfEmitidaTxt} numberOfLines={2}>
              NFS-e emitida{nfEmitida.numero != null ? ` nº ${nfEmitida.numero}` : ''}
            </Text>
          </View>
        ) : showNf ? (
          <PrimaryButton
            title={nfBusy ? 'Emitindo…' : 'Emitir NFS-e'}
            variant="secondary"
            size="compact"
            onPress={() => setNfConfirmMensalidade(m)}
            loading={nfBusy}
            disabled={nfBusy}
            style={styles.btnEmitirNf}
          />
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
        <Text style={styles.nfHint}>
          Use &quot;Emitir NFS-e&quot; em cada mensalidade ou em A receber (tipo Mensalidade). Cliente precisa estar
          com NF no cadastro.
        </Text>

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
          {loading
            ? 'Carregando…'
            : `${filteredRows.length} de ${totalBase} mensalidade(s)`}
        </Text>
      </View>
    </>
  );

  const listFooter =
    !loading && filteredRows.length > 0 ? (
      <View style={styles.paginacao}>
        <Pressable
          style={[styles.paginaBtn, pagina === 1 && styles.paginaBtnDisabled]}
          onPress={() => setPagina((p) => Math.max(1, p - 1))}
          disabled={pagina === 1}
        >
          <Ionicons
            name="chevron-back"
            size={16}
            color={pagina === 1 ? colors.gray400 : colors.petroleum}
          />
          <Text style={[styles.paginaBtnTxt, pagina === 1 && styles.paginaBtnTxtDisabled]}>
            Anterior
          </Text>
        </Pressable>
        <Text style={styles.paginaInfo}>
          Página {pagina} de {totalPaginas}
        </Text>
        <Pressable
          style={[styles.paginaBtn, pagina === totalPaginas && styles.paginaBtnDisabled]}
          onPress={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
          disabled={pagina === totalPaginas}
        >
          <Text
            style={[
              styles.paginaBtnTxt,
              pagina === totalPaginas && styles.paginaBtnTxtDisabled,
            ]}
          >
            Próxima
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={pagina === totalPaginas ? colors.gray400 : colors.petroleum}
          />
        </Pressable>
      </View>
    ) : null;

  return (
    <View style={styles.root}>
      <FlatList
        data={rowsPagina}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
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

      <ConfirmarEmitirNfseModal
        visible={nfPosPagamento != null}
        loading={nfEmitindoPosPagamento}
        onClose={() => setNfPosPagamento(null)}
        onEmitir={(emitenteId) => void emitirNfPosPagamento(emitenteId)}
        onDepois={() => setNfPosPagamento(null)}
      />

      <ConfirmarEmitirNfseModal
        visible={nfConfirmMensalidade != null}
        titulo="Emitir NFS-e"
        descricao={
          nfConfirmMensalidade
            ? `Gerar nota fiscal de ${formatBRL(nfConfirmMensalidade.valor)}${
                nfConfirmMensalidade.competencia ? ` — competência ${nfConfirmMensalidade.competencia}` : ''
              }?`
            : ''
        }
        botaoPrimario="Emitir NFS-e"
        botaoSecundario="Cancelar"
        loading={nfBusyId === nfConfirmMensalidade?.id}
        onClose={() => !nfBusyId && setNfConfirmMensalidade(null)}
        onEmitir={(emitenteId) => void executarNfConfirmada(emitenteId)}
        onDepois={() => !nfBusyId && setNfConfirmMensalidade(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xl * 2,
  },
  columnWrapper: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  nfHint: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
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
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  cardHead: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  cardTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  cli: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
    lineHeight: 17,
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
    fontSize: 10,
    color: colors.gray600,
    lineHeight: 14,
  },
  btnRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  btnSmLancar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.orange,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    minHeight: 30,
  },
  btnSmPago: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.success,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    minHeight: 30,
  },
  btnSmPagoTxt: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 11,
  },
  btnEmitirNf: { marginTop: spacing.sm },
  nfEmitidaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm,
    paddingVertical: 5,
    paddingHorizontal: spacing.xs,
    minHeight: 28,
    marginTop: spacing.sm,
  },
  nfEmitidaTxt: {
    flex: 1,
    color: colors.success,
    fontWeight: '700',
    fontSize: 10,
    lineHeight: 13,
  },
  hist: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray100,
  },
  histTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.gray600,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  histEmpty: {
    fontSize: 11,
    color: colors.gray400,
  },
  histRow: {
    marginBottom: spacing.xs,
  },
  histVal: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.petroleum,
  },
  histMeta: {
    fontSize: 10,
    color: colors.gray600,
  },
  paginacao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  paginaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  paginaBtnDisabled: {
    backgroundColor: colors.gray50,
    borderColor: colors.gray100,
  },
  paginaBtnTxt: { color: colors.petroleum, fontSize: 12, fontWeight: '700' },
  paginaBtnTxtDisabled: { color: colors.gray400 },
  paginaInfo: { color: colors.gray600, fontSize: 12, fontWeight: '600' },
});
