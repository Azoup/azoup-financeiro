import { EnviarMensalidadeModal } from '@/components/mensalidades/EnviarMensalidadeModal';
import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildGerarMensalidadeExport } from '@/utils/exportReportBuilders';
import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  applyReajusteMensalidadePercentual,
  fetchClientesParaGerarMensalidades,
  type GerarMensalidadeFiltrosClientes,
} from '@/services/clientsService';
import {
  criarMensalidadesGeradasLote,
  fetchUltimoVencimentoMensalidadePorCliente,
} from '@/services/mensalidadeGeradaService';
import { sincronizarCarnesMensalidadesFaltantes } from '@/services/boletoParcelaService';
import { fetchCertificadoAtivoEmitente, ensureEmitentes } from '@/services/nfseEmitenteService';
import { fetchCertificadoAtivo } from '@/services/nfeConfigService';
import { fetchSegmentosCliente } from '@/services/segmentoClienteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { ClienteListItem, SegmentoClienteRow } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import {
  formatBRDate,
  isoRangeMesCalendario,
  labelMesAnoBR,
  mesAnoAtualBR,
  parseISODate,
  parseMesAnoBR,
  toISODate,
} from '@/utils/date';
import { calcProximoVencimentoMensalidade } from '@/utils/mensalidadeVencimento';
import { CONSULTA, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

const CLIENTES_POR_PAGINA = 10;

function targetsFromSelection(rows: ClienteListItem[], selected: Set<string>): string[] {
  const rowIds = rows.map((r) => r.id);
  const rowSet = new Set(rowIds);
  if (selected.size > 0) {
    const picked = [...selected].filter((id) => rowSet.has(id));
    if (picked.length > 0) return picked;
  }
  return rowIds;
}

export default function GerarMensalidadeScreen() {
  const { user, loading: authLoading, session } = useAuth();
  const router = useRouter();
  useHardwareBackToConsulta(CONSULTA.mensalidades);
  const { cliente: clienteParam } = useLocalSearchParams<{ cliente?: string | string[] }>();
  const clientePre = Array.isArray(clienteParam) ? clienteParam[0] : clienteParam;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 320);
  const [segmento, setSegmento] = useState<string | 'todos'>('todos');
  const [incluirCancelados, setIncluirCancelados] = useState(false);
  const [mesReajusteStr, setMesReajusteStr] = useState(mesAnoAtualBR);
  const [filtrarPorMesReajuste, setFiltrarPorMesReajuste] = useState(false);
  const [segmentos, setSegmentos] = useState<SegmentoClienteRow[]>([]);
  const [rows, setRows] = useState<ClienteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [enviarModalOpen, setEnviarModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [percentStr, setPercentStr] = useState('');
  const [competencia, setCompetencia] = useState('');
  const [ultimosVencimento, setUltimosVencimento] = useState<Map<string, string>>(new Map());
  const [usarMesmaDataTodos, setUsarMesmaDataTodos] = useState(false);
  const [vencimento, setVencimento] = useState<Date | null>(null);
  const [pagina, setPagina] = useState(1);
  const [valoresTemporarios, setValoresTemporarios] = useState<Record<string, number>>({});
  const [editandoValorId, setEditandoValorId] = useState<string | null>(null);
  const [valorEdicao, setValorEdicao] = useState('');

  const mesReajusteRange = useMemo(() => {
    if (!filtrarPorMesReajuste) return null;
    const parsed = parseMesAnoBR(mesReajusteStr);
    if (!parsed) return null;
    return isoRangeMesCalendario(parsed.year, parsed.month);
  }, [filtrarPorMesReajuste, mesReajusteStr]);

  const mesReajusteLabel = useMemo(() => {
    const parsed = parseMesAnoBR(mesReajusteStr);
    return parsed ? labelMesAnoBR(parsed.year, parsed.month) : null;
  }, [mesReajusteStr]);

  const filters: GerarMensalidadeFiltrosClientes = useMemo(
    () => ({
      search: debouncedSearch,
      segmentoCodigo: segmento,
      incluirCancelados,
      mesReajusteDe: mesReajusteRange?.de ?? null,
      mesReajusteAte: mesReajusteRange?.ate ?? null,
    }),
    [debouncedSearch, segmento, incluirCancelados, mesReajusteRange],
  );

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!session?.user?.id) {
      setRows([]);
      setFetchError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const list = await fetchClientesParaGerarMensalidades(session.user.id, filters);
      setRows(list);
    } catch (e) {
      const message = (e as Error).message;
      setFetchError(message);
      Toast.show({ type: 'error', text1: message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authLoading, session?.user?.id, filters]);

  useEffect(() => {
    fetchSegmentosCliente().then(setSegmentos);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.id || !rows.length) {
      setUltimosVencimento(new Map());
      return;
    }
    let alive = true;
    (async () => {
      try {
        const map = await fetchUltimoVencimentoMensalidadePorCliente(
          user.id,
          rows.map((r) => r.id),
        );
        if (alive) setUltimosVencimento(map);
      } catch {
        if (alive) setUltimosVencimento(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, rows]);

  const vencimentoPorCliente = useCallback(
    (clienteId: string, dataInicio: string | null) =>
      calcProximoVencimentoMensalidade({
        dataInicio,
        ultimoVencimento: ultimosVencimento.get(clienteId) ?? null,
      }),
    [ultimosVencimento],
  );

  const targetIds = useMemo(
    () => targetsFromSelection(rows, selected),
    [rows, selected],
  );

  const totalPaginas = Math.max(1, Math.ceil(rows.length / CLIENTES_POR_PAGINA));
  const rowsPagina = useMemo(() => {
    const inicio = (pagina - 1) * CLIENTES_POR_PAGINA;
    return rows.slice(inicio, inicio + CLIENTES_POR_PAGINA);
  }, [pagina, rows]);
  const totalMensalidadesSelecionadas = useMemo(() => {
    const ids = new Set(targetIds);
    return rows.reduce(
      (total, row) =>
        total +
        (ids.has(row.id)
          ? (valoresTemporarios[row.id] ?? Number(row.valor_mensalidade)) || 0
          : 0),
      0,
    );
  }, [rows, targetIds, valoresTemporarios]);

  useEffect(() => {
    setPagina(1);
  }, [filters]);

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas));
  }, [totalPaginas]);

  useEffect(() => {
    if (usarMesmaDataTodos) return;
    if (targetIds.length !== 1) {
      setVencimento(null);
      return;
    }
    const row = rows.find((r) => r.id === targetIds[0]);
    if (!row) return;
    setVencimento(vencimentoPorCliente(row.id, row.data_inicio ?? null));
  }, [targetIds, rows, ultimosVencimento, usarMesmaDataTodos, vencimentoPorCliente]);

  useEffect(() => {
    if (clientePre && rows.some((r) => r.id === clientePre)) {
      setSelected(new Set([String(clientePre)]));
    }
  }, [clientePre, rows]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleTodos = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const selecionarTodosLista = () => {
    setSelected(new Set(rows.map((r) => r.id)));
  };

  const abrirEdicaoValor = (row: ClienteListItem) => {
    const atual = (valoresTemporarios[row.id] ?? Number(row.valor_mensalidade)) || 0;
    setEditandoValorId(row.id);
    setValorEdicao(atual.toFixed(2).replace('.', ','));
  };

  const salvarValorTemporario = (clienteId: string) => {
    const valor = Number(valorEdicao.trim().replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      Toast.show({ type: 'error', text1: 'Informe um valor de mensalidade válido.' });
      return;
    }
    setValoresTemporarios((atuais) => ({ ...atuais, [clienteId]: valor }));
    setEditandoValorId(null);
    setValorEdicao('');
  };

  const onAdicionarReajuste = async () => {
    if (!user?.id) return;
    const pct = parseFloat(percentStr.replace(',', '.'));
    const ids = targetIds;
    if (!ids.length) {
      Toast.show({ type: 'error', text1: 'Selecione ao menos um cliente na lista.' });
      return;
    }
    if (!Number.isFinite(pct) || pct === 0) {
      Toast.show({ type: 'error', text1: 'Informe um percentual de reajuste válido (ex.: 5 para +5%).' });
      return;
    }
    setBusy(true);
    try {
      await applyReajusteMensalidadePercentual(user.id, ids, pct);
      Toast.show({ type: 'success', text1: 'Reajuste aplicado aos clientes escolhidos.' });
      setPercentStr('');
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const executarEnvio = async (gerarNotaFiscal: boolean, emitenteId?: string) => {
    if (!user?.id) return;
    const ids = targetIds;
    if (!ids.length) {
      Toast.show({ type: 'error', text1: 'Não há clientes na lista para gerar mensalidade.' });
      return;
    }
    if (usarMesmaDataTodos && !vencimento) {
      Toast.show({ type: 'error', text1: 'Informe a data de vencimento para aplicar a todos.' });
      return;
    }

    const clientesSelecionados = rows.filter((r) => ids.includes(r.id));
    if (gerarNotaFiscal) {
      const semNf = clientesSelecionados.filter((r) => !r.emite_nf);
      if (semNf.length === clientesSelecionados.length) {
        Toast.show({
          type: 'error',
          text1: 'Nenhum cliente selecionado emite NFS-e',
          text2: `Marque "Com NF" no cadastro: ${semNf.map((c) => c.nome_cliente).join(', ')}`,
          visibilityTime: 10000,
        });
        return;
      }
      try {
        const emitentes = await ensureEmitentes(user.id);
        const eid = emitenteId || emitentes.find((e) => e.padrao)?.id || emitentes[0]?.id;
        const cert = eid
          ? await fetchCertificadoAtivoEmitente(user.id, eid)
          : await fetchCertificadoAtivo(user.id);
        if (!cert) {
          Toast.show({
            type: 'error',
            text1: 'Certificado A1 não cadastrado',
            text2: 'Vá em Configurações › NFS-e e envie o certificado do CNPJ escolhido.',
            visibilityTime: 10000,
          });
          return;
        }
      } catch (e) {
        Toast.show({ type: 'error', text1: (e as Error).message, visibilityTime: 9000 });
        return;
      }
      if (semNf.length > 0) {
        Toast.show({
          type: 'info',
          text1: `${semNf.length} cliente(s) sem NF no cadastro`,
          text2: 'Serão ignorados na NFS-e; a mensalidade será gerada normalmente.',
          visibilityTime: 8000,
        });
      }
    }

    setBusy(true);
    try {
      const pctRaw = percentStr.trim().replace(',', '.');
      if (pctRaw) {
        const pct = parseFloat(pctRaw);
        if (!Number.isFinite(pct) || pct === 0) {
          Toast.show({ type: 'error', text1: 'Percentual de reajuste inválido.' });
          setBusy(false);
          return;
        }
        await applyReajusteMensalidadePercentual(user.id, ids, pct);
        setPercentStr('');
        await load();
      }
      const { criados, ignorados, semVencimento, avisoBoleto, nf } = await criarMensalidadesGeradasLote({
        userId: user.id,
        clienteIds: ids,
        valoresPorCliente: valoresTemporarios,
        dataVencimentoOverride: usarMesmaDataTodos && vencimento ? toISODate(vencimento) : null,
        competencia: competencia.trim() || null,
        gerarNotaFiscal,
        emitenteId: gerarNotaFiscal ? emitenteId || null : null,
      });
      const extras: string[] = [];
      if (ignorados > 0) extras.push(`${ignorados} sem valor de mensalidade`);
      if (semVencimento > 0) extras.push(`${semVencimento} sem primeiro vencimento no cadastro`);
      if (gerarNotaFiscal && nf) {
        extras.push(`${nf.emitidas} NFS-e autorizada(s)`);
        if (nf.rejeitadas > 0) extras.push(`${nf.rejeitadas} NF rejeitada(s) — veja em Notas fiscais`);
        if (nf.ignoradas > 0) extras.push(`${nf.ignoradas} sem NF no cadastro`);
      }
      if (avisoBoleto) {
        Toast.show({
          type: 'info',
          text1: 'Carnê informativo em A receber',
          text2: avisoBoleto,
          visibilityTime: 9000,
        });
      }
      await sincronizarCarnesMensalidadesFaltantes(user.id).catch(() => undefined);

      const nfFalhou = gerarNotaFiscal && nf && nf.emitidas === 0;
      const nfDetalhe =
        nf?.erros?.[0] ??
        (nf && nf.ignoradas > 0
          ? 'Cliente marcado como Sem NF no cadastro — edite o cliente e marque Com NF.'
          : null) ??
        (nf && nf.rejeitadas > 0
          ? 'Abra Notas fiscais para ver o motivo da rejeição.'
          : null);

      Toast.show({
        type: nfFalhou ? 'error' : 'success',
        text1: `${criados} mensalidade(s) gerada(s).${extras.length ? ` ${extras.join('; ')}.` : ''}`,
        text2: nfFalhou
          ? nfDetalhe ?? 'Nenhuma NFS-e foi autorizada. Verifique certificado e configurações.'
          : gerarNotaFiscal
            ? 'Veja as notas em Notas fiscais.'
            : 'Confira em A receber.',
        visibilityTime: nfFalhou ? 12000 : 5000,
      });
      setEnviarModalOpen(false);
      router.replace(gerarNotaFiscal ? '/(app)/notas-fiscais' : '/(app)/contas-receber');
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onAbrirEnviar = () => {
    if (!targetIds.length) {
      Toast.show({ type: 'error', text1: 'Não há clientes na lista para gerar mensalidade.' });
      return;
    }
    setEnviarModalOpen(true);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="always">
        <ExportReportButtons
          compact
          disabled={loading}
          getReport={() =>
            buildGerarMensalidadeExport(rows, {
              competencia: competencia.trim(),
              vencimento: vencimento ? formatBRDate(vencimento) : '—',
              segmento: segmento === 'todos' ? 'Todos' : segmento,
              incluirCancelados,
              mesReajuste:
                filtrarPorMesReajuste && mesReajusteLabel
                  ? mesReajusteLabel
                  : 'Sem filtro por mês',
            })
          }
        />
        <Text style={styles.lead}>
          Filtre por mês de reajuste, selecione os clientes, aplique o percentual e gere as mensalidades.
        </Text>

        <Card style={styles.card} padded={false}>
          <Text style={styles.h}>Reajuste do mês</Text>
          <Text style={styles.hint}>
            Mês (MM/AAAA) da data de reajuste no cadastro — ex.: 06/2026.
          </Text>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Filtrar por mês de reajuste</Text>
            <View style={styles.switchScale}>
              <Switch value={filtrarPorMesReajuste} onValueChange={setFiltrarPorMesReajuste} />
            </View>
          </View>
          <Text style={styles.label}>Mês do reajuste</Text>
          <TextInput
            style={styles.input}
            value={mesReajusteStr}
            onChangeText={(t) => setMesReajusteStr(t.replace(/[^\d/]/g, '').slice(0, 7))}
            placeholder="MM/AAAA (ex.: 06/2026)"
            placeholderTextColor={colors.gray400}
            keyboardType="number-pad"
            editable={filtrarPorMesReajuste}
          />
          {filtrarPorMesReajuste && !parseMesAnoBR(mesReajusteStr) ? (
            <Text style={styles.warnTxt}>Informe o mês no formato MM/AAAA.</Text>
          ) : null}
          {filtrarPorMesReajuste && mesReajusteLabel ? (
            <Text style={styles.mesResumo}>
              {loading ? 'Carregando…' : `${rows.length} cliente(s) com reajuste em ${mesReajusteLabel}`}
            </Text>
          ) : null}
          <Pressable
            onPress={() => {
              setMesReajusteStr(mesAnoAtualBR());
              setFiltrarPorMesReajuste(true);
            }}
            style={styles.linkBtnInline}
          >
            <Text style={styles.linkTxt}>Usar mês atual</Text>
          </Pressable>
          <Text style={styles.label}>Percentual de reajuste (%)</Text>
          <TextInput
            style={styles.input}
            value={percentStr}
            onChangeText={(t) => setPercentStr(t.replace(/[^\d.,-]/g, ''))}
            placeholder="Ex.: 5 para +5%"
            placeholderTextColor={colors.gray400}
            keyboardType="decimal-pad"
          />
          <View style={styles.reajusteBtnRow}>
            <PrimaryButton
              title="Selec. todos"
              variant="secondary"
              size="compact"
              onPress={selecionarTodosLista}
              disabled={!rows.length || loading}
              style={styles.reajusteBtnFlex}
            />
            <PrimaryButton
              title="Aplicar reajuste"
              size="compact"
              loading={busy}
              onPress={onAdicionarReajuste}
              disabled={!rows.length}
              style={styles.reajusteBtnFlex}
            />
          </View>
        </Card>

        <Card style={styles.card} padded={false}>
          <Text style={styles.h}>Filtros</Text>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={15} color={colors.gray400} />
            <TextInput
              style={styles.searchIn}
              placeholder="Nome, empresa ou documento"
              placeholderTextColor={colors.gray400}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <Text style={styles.label}>Segmento</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            <Pressable
              style={[styles.chip, segmento === 'todos' && styles.chipOn]}
              onPress={() => setSegmento('todos')}
            >
              <Text style={[styles.chipTxt, segmento === 'todos' && styles.chipTxtOn]}>Todos</Text>
            </Pressable>
            {segmentos.map((s) => {
              const on = segmento === s.codigo;
              return (
                <Pressable
                  key={s.codigo}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setSegmento(s.codigo)}
                >
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]} numberOfLines={1}>
                    {s.nome}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Incluir cancelados</Text>
            <View style={styles.switchScale}>
              <Switch value={incluirCancelados} onValueChange={setIncluirCancelados} />
            </View>
          </View>
          {filtrarPorMesReajuste ? (
            <Pressable
              onPress={() => setFiltrarPorMesReajuste(false)}
              style={styles.clearDate}
            >
              <Text style={styles.clearDateTxt}>Mostrar todos os clientes (sem filtro de mês)</Text>
            </Pressable>
          ) : null}
        </Card>

        <View style={styles.listHead}>
          <Text style={styles.h}>Clientes ({rows.length})</Text>
          <Pressable onPress={toggleTodos} style={styles.linkBtn}>
            <Text style={styles.linkTxt}>{allSelected ? 'Limpar seleção' : 'Selecionar todos'}</Text>
          </Pressable>
        </View>

        {fetchError ? <Text style={styles.fetchError}>{fetchError}</Text> : null}

        {!loading && rows.length === 0 && filtrarPorMesReajuste ? (
          <Pressable
            style={styles.emptyAction}
            onPress={() => setFiltrarPorMesReajuste(false)}
          >
            <Text style={styles.emptyActionTxt}>
              Nenhum cliente com reajuste em {mesReajusteLabel ?? mesReajusteStr}. Toque aqui para listar
              todos os clientes.
            </Text>
          </Pressable>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing.lg }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            {filtrarPorMesReajuste
              ? 'Nenhum cliente com reajuste neste mês. Desative o filtro por mês ou altere MM/AAAA.'
              : 'Nenhum cliente com os filtros atuais.'}
          </Text>
        ) : (
          rowsPagina.map((r) => {
            const seg = r.segmento_cliente?.nome ?? r.segmento_cliente_codigo ?? '—';
            const on = selected.has(r.id);
            const valorTemporario = valoresTemporarios[r.id];
            const valorExibido = (valorTemporario ?? Number(r.valor_mensalidade)) || 0;
            const proxVenc = vencimentoPorCliente(r.id, r.data_inicio ?? null);
            const proxLabel = proxVenc
              ? formatBRDate(proxVenc)
              : r.data_inicio
                ? '—'
                : 'Cadastre 1º vencimento';
            return (
              <Pressable key={r.id} style={[styles.rowCard, on && styles.rowCardOn]} onPress={() => toggleRow(r.id)}>
                <View style={styles.check}>
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? colors.orange : colors.gray400}
                  />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.nome} numberOfLines={2}>{r.nome_cliente}</Text>
                  {r.nome_empresa ? <Text style={styles.emp} numberOfLines={1}>{r.nome_empresa}</Text> : null}
                  <Text style={styles.meta} numberOfLines={1}>Seg. {seg}</Text>
                  <Text style={styles.metaReaj} numberOfLines={2}>
                    Reaj. {r.data_reajuste ? formatBRDate(parseISODate(r.data_reajuste)) || r.data_reajuste : '—'}
                    {' · '}1º venc. {r.data_inicio ? formatBRDate(parseISODate(r.data_inicio)) || r.data_inicio : '—'}
                  </Text>
                  <Text style={styles.metaProx} numberOfLines={1}>Próx. {proxLabel}</Text>
                  <Text style={[styles.metaNf, !r.emite_nf && styles.metaNfOff]} numberOfLines={1}>
                    {r.emite_nf ? 'Com NFS-e' : 'Sem NFS-e'}
                  </Text>
                  {r.cancelado ? <Text style={styles.cancel}>Cancelado</Text> : null}
                  <Text style={styles.val}>{formatBRL(valorExibido)}</Text>
                  {valorTemporario != null ? (
                    <Text style={styles.valorOriginal} numberOfLines={1}>
                      Só este mês · cadastro {formatBRL(r.valor_mensalidade)}
                    </Text>
                  ) : null}
                  {on ? (
                    editandoValorId === r.id ? (
                      <View style={styles.valorEdicaoBox}>
                        <TextInput
                          style={styles.valorEdicaoInput}
                          value={valorEdicao}
                          onChangeText={(texto) =>
                            setValorEdicao(texto.replace(/[^\d.,]/g, ''))
                          }
                          keyboardType="decimal-pad"
                          placeholder="0,00"
                          placeholderTextColor={colors.gray400}
                          autoFocus
                          onPressIn={(evento) => evento.stopPropagation()}
                        />
                        <Pressable
                          style={styles.valorSalvarBtn}
                          onPress={(evento) => {
                            evento.stopPropagation();
                            salvarValorTemporario(r.id);
                          }}
                        >
                          <Ionicons name="checkmark" size={14} color={colors.white} />
                        </Pressable>
                        <Pressable
                          style={styles.valorCancelarBtn}
                          onPress={(evento) => {
                            evento.stopPropagation();
                            setEditandoValorId(null);
                            setValorEdicao('');
                          }}
                        >
                          <Ionicons name="close" size={15} color={colors.gray600} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        style={styles.alterarValorBtn}
                        onPress={(evento) => {
                          evento.stopPropagation();
                          abrirEdicaoValor(r);
                        }}
                      >
                        <Ionicons name="create-outline" size={12} color={colors.orangeDark} />
                        <Text style={styles.alterarValorTxt}>Alterar valor</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}

        {!loading && rows.length > 0 ? (
          <>
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

            <View style={styles.totalSelecionado}>
              <Text style={styles.totalSelecionadoLabel}>
                Total das mensalidades selecionadas ({targetIds.length})
              </Text>
              <Text style={styles.totalSelecionadoValor}>
                {formatBRL(totalMensalidadesSelecionadas)}
              </Text>
            </View>
          </>
        ) : null}

        <Card style={styles.card} padded={false}>
          <Text style={styles.h}>Dados da mensalidade</Text>
          <Text style={styles.hint}>
            Vencimento automático: última mensalidade + 30 dias ou 1º vencimento do cadastro.
          </Text>
          {targetIds.length > 1 && !usarMesmaDataTodos ? (
            <Text style={styles.autoHint}>
              {targetIds.length} clientes com vencimento individual.
            </Text>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.label}>Mesma data para todos</Text>
            <View style={styles.switchScale}>
              <Switch
                value={usarMesmaDataTodos}
                onValueChange={(v) => {
                  setUsarMesmaDataTodos(v);
                  if (!v && targetIds.length === 1) {
                    const row = rows.find((r) => r.id === targetIds[0]);
                    if (row) setVencimento(vencimentoPorCliente(row.id, row.data_inicio ?? null));
                  }
                }}
              />
            </View>
          </View>
          {usarMesmaDataTodos || targetIds.length <= 1 ? (
            <DatePickerField
              compact
              label={usarMesmaDataTodos ? 'Vencimento (todos)' : 'Próximo vencimento'}
              value={vencimento}
              onChange={setVencimento}
            />
          ) : null}
          <Text style={styles.label}>Competência (opcional)</Text>
          <TextInput
            style={styles.input}
            value={competencia}
            onChangeText={setCompetencia}
            placeholder="Ex.: 05/2026"
            placeholderTextColor={colors.gray400}
          />
        </Card>

        <Text style={styles.hintGerar}>
          Percentual preenchido será reaplicado antes de gerar.
        </Text>
        <PrimaryButton title="Enviar" size="compact" loading={busy} onPress={onAbrirEnviar} style={styles.enviar} />
        <Text style={styles.footerHint}>
          Escolha gerar só mensalidade ou com NFS-e. Carnês em A receber.
        </Text>
      </ScrollView>
      <EnviarMensalidadeModal
        visible={enviarModalOpen}
        loading={busy}
        onClose={() => setEnviarModalOpen(false)}
        onSomenteMensalidade={() => void executarEnvio(false)}
        onMensalidadeComNf={(emitenteId) => void executarEnvio(true, emitenteId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  scroll: { padding: spacing.sm, paddingBottom: spacing.xl },
  lead: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  card: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  h: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: 4,
  },
  hint: {
    fontSize: 11,
    color: colors.gray600,
    marginBottom: spacing.xs,
    lineHeight: 15,
  },
  autoHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.petroleum,
    marginBottom: spacing.xs,
    lineHeight: 14,
  },
  label: { fontSize: 11, fontWeight: '600', color: colors.gray600, marginBottom: 2 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 34,
  },
  searchIn: { flex: 1, paddingVertical: 6, fontSize: 13, color: colors.petroleum },
  chips: { marginBottom: spacing.sm, flexGrow: 0 },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.xs,
  },
  chipOn: { backgroundColor: colors.petroleum, borderColor: colors.petroleum },
  chipTxt: { fontSize: 11, color: colors.gray800 },
  chipTxtOn: { color: colors.white, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  switchScale: {
    transform: [{ scale: 0.82 }],
  },
  mesResumo: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  warnTxt: { fontSize: 10, color: colors.danger, marginBottom: spacing.xs },
  linkBtnInline: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  reajusteBtnRow: { flexDirection: 'row', gap: spacing.xs },
  reajusteBtnFlex: { flex: 1 },
  clearDate: { marginTop: spacing.xs, marginBottom: 2 },
  clearDateTxt: { color: colors.orange, fontWeight: '700', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  hintGerar: {
    fontSize: 11,
    color: colors.gray600,
    marginBottom: spacing.xs,
    lineHeight: 15,
  },
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  linkBtn: { padding: spacing.xs },
  linkTxt: { color: colors.orange, fontWeight: '700', fontSize: 12 },
  empty: { textAlign: 'center', color: colors.gray400, marginVertical: spacing.md, fontSize: 12 },
  fetchError: {
    marginBottom: spacing.xs,
    color: colors.danger,
    fontSize: 11,
    lineHeight: 15,
  },
  emptyAction: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: colors.orangeMuted,
  },
  emptyActionTxt: {
    color: colors.petroleum,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
  },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  rowCardOn: { borderColor: colors.orangeMuted, backgroundColor: '#fffaf7' },
  check: { marginRight: spacing.xs, justifyContent: 'flex-start', paddingTop: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  nome: { fontSize: 13, fontWeight: '700', color: colors.petroleum, lineHeight: 16 },
  emp: { fontSize: 10, color: colors.gray600, marginTop: 1 },
  meta: { fontSize: 10, color: colors.gray600, marginTop: 2 },
  metaReaj: { fontSize: 10, color: colors.gray800, marginTop: 1, lineHeight: 13 },
  metaProx: { fontSize: 10, color: colors.gray600, marginTop: 1 },
  metaNf: { fontSize: 10, fontWeight: '700', color: colors.success, marginTop: 1 },
  metaNfOff: { color: colors.danger },
  cancel: { fontSize: 10, fontWeight: '700', color: colors.danger, marginTop: 2 },
  val: { fontSize: 14, fontWeight: '800', color: colors.orange, marginTop: 4 },
  valorOriginal: { fontSize: 10, color: colors.gray600, marginTop: 1 },
  alterarValorBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.orangeSoft,
  },
  alterarValorTxt: { color: colors.orangeDark, fontSize: 10, fontWeight: '700' },
  valorEdicaoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  valorEdicaoInput: {
    flex: 1,
    minHeight: 30,
    borderWidth: 1,
    borderColor: colors.orangeMuted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    color: colors.petroleum,
    backgroundColor: colors.white,
    fontSize: 12,
  },
  valorSalvarBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.orange,
  },
  valorCancelarBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  paginacao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  paginaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 30,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  paginaBtnDisabled: {
    backgroundColor: colors.gray50,
    borderColor: colors.gray100,
  },
  paginaBtnTxt: { color: colors.petroleum, fontSize: 11, fontWeight: '700' },
  paginaBtnTxtDisabled: { color: colors.gray400 },
  paginaInfo: { color: colors.gray600, fontSize: 11, fontWeight: '600' },
  totalSelecionado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: colors.orangeMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  totalSelecionadoLabel: {
    flex: 1,
    color: colors.petroleum,
    fontSize: 11,
    fontWeight: '700',
  },
  totalSelecionadoValor: {
    color: colors.orangeDark,
    fontSize: 15,
    fontWeight: '800',
  },
  enviar: { marginTop: spacing.sm },
  footerHint: { fontSize: 11, color: colors.gray600, marginTop: spacing.xs, lineHeight: 15 },
});
