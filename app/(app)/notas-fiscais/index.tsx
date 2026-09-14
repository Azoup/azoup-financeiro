import { AcoesMenuModal, type AcaoMenuItem } from '@/components/AcoesMenuModal';
import { CancelarNotaFiscalModal } from '@/components/notas-fiscais/CancelarNotaFiscalModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useEmpresaFiltro } from '@/context/EmpresaFiltroContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  cancelarNotaFiscalSefaz,
  fetchNotasFiscaisLista,
  reemitirNotaFiscalSefaz,
} from '@/services/notaFiscalService';
import { ensureEmitentes } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente, NotaFiscalListRow, NotaFiscalStatus } from '@/types/notaFiscal';
import { showAppToast } from '@/utils/appToast';
import { baixarDanfePdf, baixarLoteDanfeXml } from '@/utils/baixarDanfseArquivos';
import { formatBRL } from '@/utils/currency';
import { compartilharDanfseComFeedback } from '@/utils/danfseDocumento';
import {
  corNotaFiscalStatus,
  labelNotaFiscalStatus,
  podeBaixarXmlNfse,
  podeCancelarNotaFiscal,
  podeImprimirDanfe,
  podeReemitirNotaFiscal,
} from '@/utils/nfeStatus';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

type StatusFiltro = 'todos' | NotaFiscalStatus;

const STATUS_OPTS: { id: StatusFiltro; label: string }[] = [
  { id: 'todos', label: 'Todas' },
  { id: 'autorizada', label: 'Emitidas' },
  { id: 'rejeitada', label: 'Rejeitadas' },
  { id: 'cancelada', label: 'Canceladas' },
  { id: 'processando', label: 'Processando' },
  { id: 'rascunho', label: 'Rascunho' },
];

function baixarXmlNoNavegador(xml: string, nomeArquivo: string) {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function NotasFiscaisIndexScreen() {
  const { user } = useAuth();
  const { matchEmpresa } = useEmpresaFiltro();
  const router = useRouter();
  const [rows, setRows] = useState<NotaFiscalListRow[]>([]);
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [homologacao] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<NotaFiscalListRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reemitBusyId, setReemitBusyId] = useState<string | null>(null);
  const [printBusyId, setPrintBusyId] = useState<string | null>(null);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [acoesNota, setAcoesNota] = useState<NotaFiscalListRow | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFiltro>('todos');
  const [emitenteFilter, setEmitenteFilter] = useState<string>('todos');
  const [clienteSearch, setClienteSearch] = useState('');
  const debouncedCliente = useDebounce(clienteSearch, 280);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [list, ems] = await Promise.all([
      fetchNotasFiscaisLista(user.id),
      ensureEmitentes(user.id).catch(() => [] as NfseEmitente[]),
    ]);
    setRows(list);
    setEmitentes(ems);
  }, [user?.id]);

  useEffect(() => {
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
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void load().catch((e) => Toast.show({ type: 'error', text1: (e as Error).message }));
    }, [load, user?.id]),
  );

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

  const filtered = useMemo(() => {
    const term = debouncedCliente.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchEmpresa(r.emitente_id, r.emitente?.id)) return false;
      if (statusFilter !== 'todos' && r.status !== statusFilter) return false;
      if (emitenteFilter !== 'todos') {
        const eid = r.emitente_id ?? r.emitente?.id ?? '';
        if (eid !== emitenteFilter) return false;
      }
      if (term) {
        const nome = r.cliente?.nome_cliente ?? '';
        const emp = r.cliente?.nome_empresa ?? '';
        const hay = `${nome} ${emp} ${r.serie}/${r.numero} ${r.codigo_verificacao ?? ''} ${r.chave_acesso ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, emitenteFilter, debouncedCliente, matchEmpresa]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length };
    for (const o of STATUS_OPTS) {
      if (o.id === 'todos') continue;
      c[o.id] = rows.filter((r) => r.status === o.id).length;
    }
    return c;
  }, [rows]);

  const temFiltroAtivo =
    statusFilter !== 'todos' || emitenteFilter !== 'todos' || clienteSearch.trim().length > 0;

  const limparFiltros = () => {
    setStatusFilter('todos');
    setEmitenteFilter('todos');
    setClienteSearch('');
  };

  const baixaveisVisiveis = useMemo(
    () => filtered.filter((r) => podeImprimirDanfe(r)),
    [filtered],
  );
  const selecionadasVisiveis = baixaveisVisiveis.filter((r) => selectedIds.includes(r.id));
  const todasVisiveisMarcadas =
    baixaveisVisiveis.length > 0 && selecionadasVisiveis.length === baixaveisVisiveis.length;

  const alternarNota = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const alternarTodasVisiveis = () => {
    setSelectedIds((prev) => {
      const visiveis = baixaveisVisiveis.map((r) => r.id);
      if (visiveis.length && visiveis.every((id) => prev.includes(id))) {
        return prev.filter((id) => !visiveis.includes(id));
      }
      return [...new Set([...prev, ...visiveis])];
    });
  };

  const baixarSelecionadas = async () => {
    const itens = filtered.filter((r) => selectedIds.includes(r.id) && podeImprimirDanfe(r));
    if (!itens.length) {
      Toast.show({ type: 'info', text1: 'Selecione notas autorizadas para baixar.' });
      return;
    }
    setBatchBusy(true);
    try {
      const res = await baixarLoteDanfeXml(itens);
      if (res.modo === 'cancelado') return;
      const extra = res.falhas ? ` ${res.falhas} nota(s) não puderam ser geradas.` : '';
      Toast.show({
        type: 'success',
        text1: res.modo === 'pasta' ? 'Arquivos salvos na pasta escolhida.' : 'Download do ZIP iniciado.',
        text2: `${res.arquivos} arquivo(s) (DANFE e XML).${extra}`,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message || 'Falha ao baixar as notas.' });
    } finally {
      setBatchBusy(false);
    }
  };
  const baixarDanfe = async (item: NotaFiscalListRow) => {
    setPrintBusyId(item.id);
    try {
      await baixarDanfePdf(item);
      Toast.show({ type: 'success', text1: 'Download da DANFE iniciado.' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message || 'Falha ao baixar a DANFE.' });
    } finally {
      setPrintBusyId(null);
    }
  };

  const compartilharDanfe = async (item: NotaFiscalListRow) => {
    setShareBusyId(item.id);
    try {
      await compartilharDanfseComFeedback(item);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message || 'Falha ao compartilhar DANFSe.' });
    } finally {
      setShareBusyId(null);
    }
  };

  const baixarXml = async (item: NotaFiscalListRow) => {
    const xml = typeof item.xml_autorizado === 'string' ? item.xml_autorizado.trim() : '';
    if (!xml) {
      Toast.show({
        type: 'info',
        text1: 'XML ainda não disponível nesta nota.',
        text2: 'Notas emitidas antes do ajuste: confira no portal da prefeitura.',
      });
      return;
    }
    const nome = `NFSe_${item.serie}_${item.numero}.xml`;
    try {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        baixarXmlNoNavegador(xml, nome);
        Toast.show({ type: 'success', text1: 'Download do XML iniciado.' });
        return;
      }
      const FileSystem = await import('expo-file-system');
      const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${nome}`;
      await FileSystem.writeAsStringAsync(path, xml, { encoding: 'utf8' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/xml',
          dialogTitle: nome,
        });
      } else {
        Toast.show({ type: 'info', text1: 'Arquivo XML salvo.', text2: path });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message || 'Falha ao baixar XML.' });
    }
  };

  const confirmarCancelamento = async (justificativa: string) => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await cancelarNotaFiscalSefaz(cancelTarget.id, justificativa);
      Toast.show({ type: 'success', text1: 'NFS-e cancelada.' });
      setCancelTarget(null);
      await load();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Cancelamento rejeitado',
        text2: (e as Error).message,
      });
    } finally {
      setCancelBusy(false);
    }
  };

  const reemitir = async (item: NotaFiscalListRow) => {
    setReemitBusyId(item.id);
    try {
      const res = await reemitirNotaFiscalSefaz(item.id);
      if (res.success) {
        showAppToast('success', 'NFS-e autorizada.');
      } else {
        showAppToast(
          'error',
          res.message ?? 'NFS-e rejeitada.',
          'Veja o motivo na nota abaixo e corrija antes de reemitir.',
        );
      }
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setReemitBusyId(null);
    }
  };

  const acoesDaNota = (item: NotaFiscalListRow): AcaoMenuItem[] => {
    const podeDanfe = podeImprimirDanfe(item);
    const podeXml = podeBaixarXmlNfse(item);
    const itens: AcaoMenuItem[] = [];
    if (podeReemitirNotaFiscal(item)) {
      itens.push({
        key: 'reemitir',
        label: 'Reemitir NFS-e',
        icon: 'refresh-outline',
        busy: reemitBusyId === item.id,
        onPress: () => void reemitir(item),
      });
    }
    itens.push(
      {
        key: 'email',
        label: 'Compartilhar por e-mail',
        icon: 'mail-outline',
        disabled: !podeDanfe,
        busy: shareBusyId === item.id,
        onPress: () => void compartilharDanfe(item),
      },
      {
        key: 'danfe',
        label: 'Baixar DANFE',
        icon: 'download-outline',
        disabled: !podeDanfe,
        busy: printBusyId === item.id,
        onPress: () => void baixarDanfe(item),
      },
      {
        key: 'xml',
        label: 'Baixar XML',
        icon: 'code-slash-outline',
        disabled: !podeXml,
        onPress: () => void baixarXml(item),
      },
    );
    if (podeCancelarNotaFiscal(item)) {
      itens.push({
        key: 'cancelar',
        label: 'Cancelar NFS-e',
        icon: 'close-circle-outline',
        danger: true,
        onPress: () => setCancelTarget(item),
      });
    }
    return itens;
  };

  const renderItem = ({ item, index }: { item: NotaFiscalListRow; index: number }) => {
    const st = corNotaFiscalStatus(item.status);
    const cli = item.cliente?.nome_cliente ?? '—';
    const podeDanfe = podeImprimirDanfe(item);
    const selecionada = selectedIds.includes(item.id);
    const isLast = index === filtered.length - 1;

    return (
      <View style={[styles.row, isLast && styles.rowLast]}>
        {podeDanfe ? (
          <Pressable onPress={() => alternarNota(item.id)} hitSlop={8} style={styles.check}>
            <Ionicons
              name={selecionada ? 'checkbox' : 'square-outline'}
              size={20}
              color={selecionada ? colors.orange : colors.gray400}
            />
          </Pressable>
        ) : (
          <View style={styles.check} />
        )}
        <View style={styles.colNum}>
          <Text style={styles.nfNum} numberOfLines={1}>
            {item.numero}
          </Text>
          {item.competencia ? (
            <Text style={styles.comp} numberOfLines={1}>
              {item.competencia}
            </Text>
          ) : null}
        </View>
        <View style={styles.colCli}>
          <Text style={styles.cli} numberOfLines={1}>
            {cli}
          </Text>
          {item.motivo_rejeicao ? (
            <Text style={styles.rejeicao} numberOfLines={1}>
              {item.motivo_rejeicao}
            </Text>
          ) : null}
        </View>
        <Text style={styles.colVal}>{formatBRL(item.valor_total)}</Text>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeTxt, { color: st.fg }]} numberOfLines={1}>
            {labelNotaFiscalStatus(item.status)}
          </Text>
        </View>
        <Pressable
          onPress={() => setAcoesNota(item)}
          style={styles.moreBtn}
          accessibilityLabel="Ações da nota"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.petroleum} />
        </Pressable>
      </View>
    );
  };

  const listHeader = (
    <View style={styles.topBar}>
      {homologacao ? (
        <View style={styles.homologBanner}>
          <Ionicons name="flask-outline" size={18} color={colors.petroleum} />
          <Text style={styles.homologTxt}>
            Ambiente de <Text style={styles.homologStrong}>homologação</Text> — NFS-e de serviço sem valor
            fiscal.
          </Text>
        </View>
      ) : (
        <View style={[styles.homologBanner, styles.prodBanner]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.petroleum} />
          <Text style={styles.homologTxt}>
            Ambiente de <Text style={styles.homologStrong}>produção</Text> — NFS-e com valor fiscal.
          </Text>
        </View>
      )}

      <Pressable style={styles.configLink} onPress={() => router.push('/(app)/configuracoes/nfe')}>
        <Ionicons name="settings-outline" size={16} color={colors.orange} />
        <Text style={styles.configLinkTxt}>Configurar emissão de NFS-e</Text>
      </Pressable>

      <Text style={styles.filterTitle}>Status</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {STATUS_OPTS.map((o) => {
          const active = statusFilter === o.id;
          const n = counts[o.id] ?? 0;
          return (
            <Pressable
              key={o.id}
              onPress={() => setStatusFilter(o.id)}
              style={[styles.chip, active && styles.chipOn]}
            >
              <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>
                {o.label}
                {o.id !== 'todos' ? ` (${n})` : ` (${counts.todos})`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {emitentes.length > 0 ? (
        <>
          <Text style={styles.filterTitle}>Empresa (emitente)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <Pressable
              onPress={() => setEmitenteFilter('todos')}
              style={[styles.chip, emitenteFilter === 'todos' && styles.chipOn]}
            >
              <Text style={[styles.chipTxt, emitenteFilter === 'todos' && styles.chipTxtOn]}>
                Todas
              </Text>
            </Pressable>
            {emitentes.map((e) => {
              const active = emitenteFilter === e.id;
              return (
                <Pressable
                  key={e.id}
                  onPress={() => setEmitenteFilter(e.id)}
                  style={[styles.chip, active && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtOn]} numberOfLines={1}>
                    {e.nome?.trim() || e.razao_social?.trim() || 'Emitente'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      <Text style={styles.filterTitle}>Cliente</Text>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.gray400} />
        <TextInput
          style={styles.searchIn}
          placeholder="Buscar por cliente, nº da nota…"
          placeholderTextColor={colors.gray400}
          value={clienteSearch}
          onChangeText={setClienteSearch}
        />
        {clienteSearch ? (
          <Pressable onPress={() => setClienteSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.gray400} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.resultRow}>
        <Text style={styles.resultTxt}>
          {filtered.length} de {rows.length} nota{rows.length === 1 ? '' : 's'}
        </Text>
        {temFiltroAtivo ? (
          <Pressable onPress={limparFiltros}>
            <Text style={styles.clearTxt}>Limpar filtros</Text>
          </Pressable>
        ) : null}
      </View>

      {baixaveisVisiveis.length ? (
        <View style={styles.loteBar}>
          <Pressable onPress={alternarTodasVisiveis} style={styles.loteCheck} hitSlop={6}>
            <Ionicons
              name={todasVisiveisMarcadas ? 'checkbox' : 'square-outline'}
              size={22}
              color={todasVisiveisMarcadas ? colors.orange : colors.gray400}
            />
            <Text style={styles.loteCheckTxt}>
              Selecionar todas visíveis ({selecionadasVisiveis.length}/{baixaveisVisiveis.length})
            </Text>
          </Pressable>
          <PrimaryButton
            title={batchBusy ? 'Baixando…' : 'Baixar DANFE e XML'}
            onPress={() => void baixarSelecionadas()}
            disabled={batchBusy || selecionadasVisiveis.length === 0}
            loading={batchBusy}
            style={styles.loteBtn}
          />
        </View>
      ) : null}
      {filtered.length > 0 ? (
        <View style={styles.tableHead}>
          <View style={styles.check} />
          <Text style={[styles.th, styles.colNum]}>Nota</Text>
          <Text style={[styles.th, styles.colCli]}>Cliente</Text>
          <Text style={[styles.th, styles.colVal]}>Valor</Text>
          <Text style={[styles.th, styles.colStatus]}>Status</Text>
          <View style={styles.moreBtn} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      {loading && !rows.length ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {rows.length === 0
                ? 'Nenhuma NFS-e ainda. Emita a partir de mensalidades, vendas ou Azoup - Web.'
                : 'Nenhuma nota com os filtros atuais.'}
            </Text>
          }
        />
      )}

      <AcoesMenuModal
        visible={acoesNota != null}
        title={acoesNota ? `NFS-e ${acoesNota.serie}/${acoesNota.numero}` : ''}
        subtitle={acoesNota?.cliente?.nome_cliente ?? undefined}
        items={acoesNota ? acoesDaNota(acoesNota) : []}
        onClose={() => setAcoesNota(null)}
      />

      <CancelarNotaFiscalModal
        visible={cancelTarget != null}
        nota={cancelTarget}
        loading={cancelBusy}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        onConfirm={(j) => void confirmarCancelamento(j)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  topBar: { paddingBottom: spacing.sm },
  homologBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#ffe082',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  prodBanner: {
    backgroundColor: '#e8f5e9',
    borderColor: '#c8e6c9',
  },
  homologTxt: { flex: 1, fontSize: 12, color: colors.gray800, lineHeight: 17 },
  homologStrong: { fontWeight: '800', color: colors.petroleum },
  configLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  configLinkTxt: { color: colors.orange, fontWeight: '700', fontSize: 13 },
  filterTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray600,
    marginBottom: 6,
    marginTop: 4,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  chipOn: {
    backgroundColor: colors.petroleum,
    borderColor: colors.petroleum,
  },
  chipTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
  },
  chipTxtOn: { color: colors.white },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    paddingHorizontal: spacing.sm,
    minHeight: 40,
    marginBottom: spacing.sm,
  },
  searchIn: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.petroleum,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  resultTxt: { fontSize: 12, color: colors.gray600, fontWeight: '600' },
  clearTxt: { fontSize: 12, color: colors.orange, fontWeight: '700' },
  loteBar: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  loteCheck: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loteCheckTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.petroleum },
  loteBtn: { minHeight: 44 },
  check: { width: 28, alignItems: 'center' },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    paddingVertical: 8,
    paddingRight: 8,
    backgroundColor: colors.petroleum,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  th: { fontSize: 10, fontWeight: '800', color: colors.white, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.gray100,
    paddingVertical: 8,
    paddingRight: 4,
    gap: 4,
  },
  rowLast: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  colNum: { width: 72 },
  colCli: { flex: 1, minWidth: 0 },
  colVal: { width: 88, textAlign: 'right', fontSize: 13, fontWeight: '700', color: colors.orange },
  colStatus: { width: 78, textAlign: 'center' },
  moreBtn: { width: 36, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  card: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  nfNum: { fontSize: 15, fontWeight: '800', color: colors.petroleum },
  cli: { fontSize: 14, fontWeight: '600', color: colors.gray800, marginTop: 2 },
  emitente: { fontSize: 11, color: colors.gray600, marginTop: 2 },
  comp: { fontSize: 12, color: colors.gray600, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  val: { fontSize: 18, fontWeight: '800', color: colors.orange, marginTop: spacing.sm },
  meta: { fontSize: 12, color: colors.gray600, marginTop: 4 },
  chave: { fontSize: 10, color: colors.gray400, marginTop: 4 },
  cancelMotivo: { fontSize: 12, color: colors.gray600, marginTop: spacing.sm, lineHeight: 17 },
  rejeicao: { fontSize: 12, color: colors.danger, marginTop: spacing.sm, lineHeight: 17 },
  date: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm },
  acoes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  btnAcao: { flex: 1, minWidth: 140, minHeight: 44 },
  empty: {
    textAlign: 'center',
    color: colors.gray400,
    marginTop: spacing.md,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
});
