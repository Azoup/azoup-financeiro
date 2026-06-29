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

  const executarEnvio = async (gerarNotaFiscal: boolean) => {
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
        const cert = await fetchCertificadoAtivo(user.id);
        if (!cert) {
          Toast.show({
            type: 'error',
            text1: 'Certificado A1 não cadastrado',
            text2: 'Vá em Configurações › NFS-e e envie o certificado antes de emitir notas.',
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
        dataVencimentoOverride: usarMesmaDataTodos && vencimento ? toISODate(vencimento) : null,
        competencia: competencia.trim() || null,
        gerarNotaFiscal,
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
          Use o filtro por mês de reajuste para listar quem reajusta no período, marque os clientes, aplique o
          percentual e depois gere as mensalidades.
        </Text>

        <Card style={styles.card}>
          <Text style={styles.h}>Reajuste do mês</Text>
          <Text style={styles.hint}>
            Informe o mês (MM/AAAA) em que a data de reajuste do cadastro cai — ex.: 06/2026 para junho. Só entram
            clientes com essa data de reajuste no cadastro.
          </Text>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Filtrar clientes com reajuste no mês</Text>
            <Switch value={filtrarPorMesReajuste} onValueChange={setFiltrarPorMesReajuste} />
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
              title="Selecionar todos da lista"
              variant="secondary"
              onPress={selecionarTodosLista}
              disabled={!rows.length || loading}
              style={styles.reajusteBtnFlex}
            />
            <PrimaryButton
              title="Aplicar reajuste"
              loading={busy}
              onPress={onAdicionarReajuste}
              disabled={!rows.length}
              style={styles.reajusteBtnFlex}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.h}>Outros filtros da lista</Text>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.gray400} />
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
            <Switch value={incluirCancelados} onValueChange={setIncluirCancelados} />
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
          rows.map((r) => {
            const seg = r.segmento_cliente?.nome ?? r.segmento_cliente_codigo ?? '—';
            const on = selected.has(r.id);
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
                    size={24}
                    color={on ? colors.orange : colors.gray400}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nome}>{r.nome_cliente}</Text>
                  {r.nome_empresa ? <Text style={styles.emp}>{r.nome_empresa}</Text> : null}
                  <Text style={styles.meta}>Segmento: {seg}</Text>
                  <Text style={styles.metaReaj}>
                    Reaj.:{' '}
                    {r.data_reajuste
                      ? formatBRDate(parseISODate(r.data_reajuste)) || r.data_reajuste
                      : '—'}
                    {' · '}1º venc.:{' '}
                    {r.data_inicio
                      ? formatBRDate(parseISODate(r.data_inicio)) || r.data_inicio
                      : '—'}
                  </Text>
                  <Text style={styles.metaProx}>Próx. mensalidade: {proxLabel}</Text>
                  <Text style={[styles.metaNf, !r.emite_nf && styles.metaNfOff]}>
                    NFS-e: {r.emite_nf ? 'Com NF' : 'Sem NF — não emite nota'}
                  </Text>
                  {r.cancelado ? <Text style={styles.cancel}>Cancelado</Text> : null}
                  <Text style={styles.val}>{formatBRL(r.valor_mensalidade)}</Text>
                </View>
              </Pressable>
            );
          })
        )}

        <Card style={styles.card}>
          <Text style={styles.h}>Dados da mensalidade</Text>
          <Text style={styles.hint}>
            Por padrão, cada cliente usa o próximo vencimento: última mensalidade gerada + 30 dias, ou o primeiro
            vencimento do cadastro (+ 30 em 30 se já passou).
          </Text>
          {targetIds.length > 1 && !usarMesmaDataTodos ? (
            <Text style={styles.autoHint}>
              {targetIds.length} clientes: vencimento calculado individualmente na geração.
            </Text>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.label}>Usar a mesma data para todos</Text>
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
          {usarMesmaDataTodos || targetIds.length <= 1 ? (
            <DatePickerField
              label={usarMesmaDataTodos ? 'Vencimento (todos os clientes)' : 'Próximo vencimento (sugestão)'}
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
          Se o percentual ainda estiver preenchido, o reajuste será aplicado de novo antes de gerar as mensalidades.
        </Text>
        <PrimaryButton title="Enviar" loading={busy} onPress={onAbrirEnviar} style={styles.enviar} />
        <Text style={styles.footerHint}>
          Ao enviar, escolha gerar só mensalidade ou mensalidade com NFS-e de serviço (homologação). Carnês em A receber.
        </Text>
      </ScrollView>
      <EnviarMensalidadeModal
        visible={enviarModalOpen}
        loading={busy}
        onClose={() => setEnviarModalOpen(false)}
        onSomenteMensalidade={() => void executarEnvio(false)}
        onMensalidadeComNf={() => void executarEnvio(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  lead: {
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  card: { marginBottom: spacing.md },
  h: { fontSize: 16, fontWeight: '800', color: colors.petroleum, marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.gray600, marginBottom: spacing.sm, lineHeight: 18 },
  autoHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.petroleum,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.gray600, marginBottom: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchIn: { flex: 1, paddingVertical: spacing.sm, fontSize: 15, color: colors.petroleum },
  chips: { marginBottom: spacing.md, flexGrow: 0 },
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  mesResumo: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  warnTxt: { fontSize: 12, color: colors.danger, marginBottom: spacing.sm },
  linkBtnInline: { alignSelf: 'flex-start', marginBottom: spacing.md },
  reajusteBtnRow: { flexDirection: 'row', gap: spacing.sm },
  reajusteBtnFlex: { flex: 1 },
  clearDate: { marginTop: spacing.sm, marginBottom: spacing.xs },
  clearDateTxt: { color: colors.orange, fontWeight: '700', fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  hintGerar: {
    fontSize: 12,
    color: colors.gray600,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  linkBtn: { padding: spacing.sm },
  linkTxt: { color: colors.orange, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', color: colors.gray400, marginVertical: spacing.lg },
  fetchError: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyAction: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
    borderWidth: 1,
    borderColor: colors.orange,
  },
  emptyActionTxt: {
    color: colors.petroleum,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowCardOn: { borderColor: colors.orange, backgroundColor: '#fffaf7' },
  check: { marginRight: spacing.sm, justifyContent: 'center' },
  nome: { fontSize: 16, fontWeight: '700', color: colors.petroleum },
  emp: { fontSize: 13, color: colors.gray600, marginTop: 2 },
  meta: { fontSize: 12, color: colors.gray600, marginTop: 4 },
  metaReaj: { fontSize: 12, color: colors.gray800, marginTop: 2 },
  metaProx: { fontSize: 11, color: colors.gray600, marginTop: 2 },
  metaNf: { fontSize: 11, fontWeight: '700', color: colors.success, marginTop: 2 },
  metaNfOff: { color: colors.danger },
  cancel: { fontSize: 11, fontWeight: '700', color: colors.danger, marginTop: 4 },
  val: { fontSize: 17, fontWeight: '800', color: colors.orange, marginTop: 6 },
  enviar: { marginTop: spacing.md },
  footerHint: { fontSize: 12, color: colors.gray600, marginTop: spacing.sm, lineHeight: 18 },
});
