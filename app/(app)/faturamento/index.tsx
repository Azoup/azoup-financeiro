import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useEmpresaFiltro } from '@/context/EmpresaFiltroContext';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchAzoupFaturas } from '@/services/azoupFaturasService';
import { emitirNfseClienteAzoup } from '@/services/azoupNfseService';
import { colors, radius, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import type { AzoupFaturaResumo } from '@/types/azoupAdmin';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, formatMesAnoBR, parseISODate, toISODate } from '@/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
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

type StatusAba = 'todos' | 'draft' | 'open' | 'overdue' | 'pago';

const STATUS_ABAS: { id: StatusAba; label: string }[] = [
  { id: 'todos', label: 'Todas as faturas' },
  { id: 'draft', label: 'Provisórias' },
  { id: 'open', label: 'Abertas' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'pago', label: 'Pagas' },
];

function inicioMes(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function fimMes(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function formatDataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function competenciaLabel(comp: string | null | undefined): string {
  if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return '—';
  const [y, m] = comp.split('-').map(Number);
  return formatMesAnoBR(y, m);
}

function statusBadge(status: string): { label: string; bg: string; fg: string } {
  const s = status.toLowerCase();
  if (s === 'pago' || s === 'paid') {
    return { label: 'Paga', bg: colors.successSoft, fg: colors.success };
  }
  if (s === 'draft') {
    return { label: 'Provisória', bg: colors.gray100, fg: colors.gray600 };
  }
  if (s === 'open') {
    return { label: 'Aberta', bg: 'rgba(37, 99, 235, 0.12)', fg: '#1D4ED8' };
  }
  if (s === 'overdue' || s === 'vencida') {
    return { label: 'Vencida', bg: colors.dangerSoft, fg: colors.danger };
  }
  return { label: status || '—', bg: colors.gray100, fg: colors.gray600 };
}

export default function FaturamentoScreen() {
  const { user } = useAuth();
  const { emitenteInicial } = useEmpresaFiltro();
  const [from, setFrom] = useState(inicioMes);
  const [to, setTo] = useState(fimMes);
  const [draftFrom, setDraftFrom] = useState(inicioMes);
  const [draftTo, setDraftTo] = useState(fimMes);
  const [statusAba, setStatusAba] = useState<StatusAba>('pago');
  const [rows, setRows] = useState<AzoupFaturaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 280);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [emitLoading, setEmitLoading] = useState(false);
  const [emitMsg, setEmitMsg] = useState<string | null>(null);
  const [alvoUnico, setAlvoUnico] = useState<AzoupFaturaResumo | null>(null);

  const load = useCallback(async (periodoFrom: string, periodoTo: string, status: StatusAba) => {
    const data = await fetchAzoupFaturas({ from: periodoFrom, to: periodoTo, status });
    setRows(data.faturas);
    setError(null);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load(from, to, statusAba);
      } catch (e) {
        if (alive) {
          setRows([]);
          setError((e as Error).message);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to, statusAba, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(from, to, statusAba);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [from, to, statusAba, load]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((f) => {
      const hay = [
        f.cliente_nome,
        f.cliente_email ?? '',
        f.numero ?? '',
        f.stripe_invoice_id,
        f.empresa_matriz_cnpj ?? '',
        f.empresa_matriz_nome ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rows, debouncedSearch]);

  const emitiveis = useMemo(
    () =>
      filtered.filter(
        (f) => f.pode_emitir_nf && f.azoup_cliente_id && !f.nfse_emitida && (f.status === 'pago' || f.status === 'paid'),
      ),
    [filtered],
  );

  const allSelected = emitiveis.length > 0 && emitiveis.every((f) => selected.has(f.id));

  const toggleTodos = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(emitiveis.map((f) => f.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const alvosEmitir = useMemo(() => {
    if (alvoUnico) return [alvoUnico];
    return filtered.filter(
      (f) => selected.has(f.id) && f.pode_emitir_nf && f.azoup_cliente_id && !f.nfse_emitida,
    );
  }, [alvoUnico, filtered, selected]);

  const pedirEmitirUm = (f: AzoupFaturaResumo) => {
    if (f.nfse_emitida) {
      router.push('/(app)/notas-fiscais');
      return;
    }
    if (!f.pode_emitir_nf || !f.azoup_cliente_id) {
      setEmitMsg('Cliente sem CNPJ da empresa matriz, fatura sem valor ou ainda não paga.');
      return;
    }
    setAlvoUnico(f);
    setEmitMsg(null);
    setConfirmVisible(true);
  };

  const pedirEmitirSelecionados = () => {
    const list = filtered.filter(
      (f) => selected.has(f.id) && f.pode_emitir_nf && f.azoup_cliente_id && !f.nfse_emitida,
    );
    if (!list.length) {
      setEmitMsg('Selecione ao menos uma fatura paga ainda sem NFS-e.');
      return;
    }
    setAlvoUnico(null);
    setEmitMsg(null);
    setConfirmVisible(true);
  };

  const onConfirmEmitir = async (emitenteId: string, discriminacao: string) => {
    if (!user?.id || !alvosEmitir.length) return;
    setEmitLoading(true);
    setEmitMsg(null);
    let ok = 0;
    let fail = 0;
    const erros: string[] = [];
    try {
      for (const f of alvosEmitir) {
        if (!f.azoup_cliente_id) {
          fail += 1;
          continue;
        }
        try {
          const res = await emitirNfseClienteAzoup(user.id, f.azoup_cliente_id, {
            emitenteId: emitenteId || null,
            valorReais: (f.valor_centavos || 0) / 100,
            competencia: f.competencia,
            stripeInvoiceId: f.stripe_invoice_id,
            descricaoServico:
              discriminacao?.trim() ||
              `Assinatura Azoup — fatura ${f.numero || f.stripe_invoice_id} — ${f.competencia || ''}`,
          });
          if (res.success) ok += 1;
          else {
            fail += 1;
            if (res.message) erros.push(`${f.cliente_nome}: ${res.message}`);
          }
        } catch (e) {
          fail += 1;
          erros.push(`${f.cliente_nome}: ${(e as Error).message}`);
        }
      }
      setEmitMsg(
        fail === 0
          ? `${ok} NFS-e emitida(s) com sucesso.`
          : `${ok} ok · ${fail} falha(s).${erros[0] ? ` ${erros[0]}` : ''}`,
      );
      if (ok > 0) {
        setConfirmVisible(false);
        setAlvoUnico(null);
        setSelected(new Set());
        await load(from, to, statusAba);
      }
    } finally {
      setEmitLoading(false);
    }
  };

  const aplicarPeriodo = () => {
    if (!draftFrom || !draftTo) {
      setError('Informe a data inicial e a data final.');
      return;
    }
    if (draftFrom > draftTo) {
      setError('A data inicial não pode ser maior que a final.');
      return;
    }
    setError(null);
    setFrom(draftFrom);
    setTo(draftTo);
  };

  const mesAtual = () => {
    const f = inicioMes();
    const t = fimMes();
    setDraftFrom(f);
    setDraftTo(t);
    setFrom(f);
    setTo(t);
  };

  const mesAnterior = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const f = inicioMes(d);
    const t = fimMes(d);
    setDraftFrom(f);
    setDraftTo(t);
    setFrom(f);
    setTo(t);
  };

  const renderItem = ({ item }: { item: AzoupFaturaResumo }) => {
    const on = selected.has(item.id);
    const valor = formatBRL((item.valor_centavos || 0) / 100);
    const badge = statusBadge(item.status);
    const podeSelecionar = Boolean(item.pode_emitir_nf && !item.nfse_emitida);
    return (
      <View style={styles.row}>
        <Pressable
          onPress={() => podeSelecionar && toggleOne(item.id)}
          style={styles.checkCell}
          disabled={!podeSelecionar}
        >
          <Ionicons
            name={on ? 'checkbox' : 'square-outline'}
            size={22}
            color={podeSelecionar ? (on ? colors.orange : colors.gray400) : colors.gray200}
          />
        </Pressable>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.valor}>{valor}</Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeTxt, { color: badge.fg }]}>{badge.label}</Text>
            </View>
            {item.nfse_emitida ? (
              <View style={styles.badgeNf}>
                <Text style={styles.badgeNfTxt}>NFS-e emitida</Text>
              </View>
            ) : null}
            <Text style={styles.freq}>{item.frequencia || 'Mensal'}</Text>
          </View>
          <Text style={styles.numero} numberOfLines={1}>
            {item.numero || item.stripe_invoice_id}
          </Text>
          <Text style={styles.cliente} numberOfLines={1}>
            {item.cliente_nome}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.cliente_email || '—'} · competência {competenciaLabel(item.competencia)} ·{' '}
            {formatDataCurta(item.data_pagamento || item.vencimento || item.periodo_inicio || item.criado_em)}
          </Text>
          {!item.pode_emitir_nf && !item.nfse_emitida ? (
            <Text style={styles.warn}>
              {item.status !== 'pago' && item.status !== 'paid'
                ? 'Só é possível emitir NFS-e de faturas pagas'
                : 'Sem CNPJ da matriz — não é possível emitir NFS-e'}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => pedirEmitirUm(item)}
          style={[
            styles.emitBtn,
            item.nfse_emitida && styles.emitBtnDone,
            !item.pode_emitir_nf && !item.nfse_emitida && styles.emitBtnOff,
          ]}
          disabled={!item.pode_emitir_nf && !item.nfse_emitida}
        >
          <Ionicons
            name={item.nfse_emitida ? 'checkmark-circle-outline' : 'receipt-outline'}
            size={18}
            color={
              item.nfse_emitida
                ? colors.success
                : item.pode_emitir_nf
                  ? colors.orange
                  : colors.gray300
            }
          />
          <Text
            style={[
              styles.emitBtnTxt,
              item.nfse_emitida && styles.emitBtnTxtDone,
              !item.pode_emitir_nf && !item.nfse_emitida && styles.emitBtnTxtOff,
            ]}
          >
            {item.nfse_emitida ? 'Ver nota' : 'Emitir'}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <Text style={styles.title}>Faturamento Stripe</Text>
        <Text style={styles.sub}>
          Faturas do Azoup Web. Emita a NFS-e com o valor e a competência de cada fatura paga.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {STATUS_ABAS.map((aba) => {
            const on = statusAba === aba.id;
            return (
              <Pressable
                key={aba.id}
                onPress={() => setStatusAba(aba.id)}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{aba.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.periodRow}>
          <View style={styles.periodField}>
            <DatePickerField
              compact
              label="Data inicial"
              value={parseISODate(draftFrom)}
              onChange={(d) => setDraftFrom(d ? toISODate(d) : '')}
            />
          </View>
          <View style={styles.periodField}>
            <DatePickerField
              compact
              label="Data final"
              value={parseISODate(draftTo)}
              onChange={(d) => setDraftTo(d ? toISODate(d) : '')}
              minimumDate={parseISODate(draftFrom) ?? undefined}
            />
          </View>
          <Pressable onPress={aplicarPeriodo} style={styles.applyBtn}>
            <Text style={styles.applyTxt}>Filtrar</Text>
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          <Pressable onPress={mesAtual} style={styles.chip}>
            <Text style={styles.chipTxt}>Mês atual</Text>
          </Pressable>
          <Pressable onPress={mesAnterior} style={styles.chip}>
            <Text style={styles.chipTxt}>Mês anterior</Text>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.gray400} />
          <TextInput
            style={styles.searchIn}
            placeholder="Buscar cliente, e-mail ou nº da fatura…"
            placeholderTextColor={colors.gray400}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.selectBar}>
          <Pressable
            onPress={toggleTodos}
            style={[styles.selectAllBtn, emitiveis.length === 0 && styles.selectAllBtnOff]}
            disabled={emitiveis.length === 0}
          >
            <Ionicons
              name={allSelected ? 'checkbox' : 'square-outline'}
              size={20}
              color={emitiveis.length === 0 ? colors.gray300 : colors.orange}
            />
            <Text
              style={[styles.selectAllTxt, emitiveis.length === 0 && { color: colors.gray400 }]}
            >
              {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
            </Text>
          </Pressable>
          {selected.size > 0 ? (
            <Text style={styles.batchTxt}>{selected.size} selecionada(s)</Text>
          ) : (
            <Text style={styles.selectHint}>
              {emitiveis.length > 0
                ? `${emitiveis.length} pronta(s) para emitir`
                : 'Nenhuma fatura emitível nesta lista'}
            </Text>
          )}
        </View>

        {selected.size > 0 ? (
          <View style={styles.batchBar}>
            <PrimaryButton title="Emitir selecionadas" onPress={pedirEmitirSelecionados} />
          </View>
        ) : null}

        {emitMsg ? <Text style={styles.msg}>{emitMsg}</Text> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.orange} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhuma fatura neste período.</Text>}
          ListFooterComponent={
            <Text style={styles.footer}>
              {filtered.length} item(ns) · {formatBRDate(parseISODate(from))} a{' '}
              {formatBRDate(parseISODate(to))}
            </Text>
          }
        />
      )}

      <ConfirmarEmitirNfseModal
        visible={confirmVisible}
        titulo={alvosEmitir.length > 1 ? `Emitir ${alvosEmitir.length} NFS-e` : 'Emitir NFS-e'}
        descricao={
          alvosEmitir.length === 1
            ? `${alvosEmitir[0].cliente_nome} · ${formatBRL((alvosEmitir[0].valor_centavos || 0) / 100)} · competência ${competenciaLabel(alvosEmitir[0].competencia)}`
            : `${alvosEmitir.length} faturas · cada nota usa o valor e a data da respectiva fatura.`
        }
        loading={emitLoading}
        onClose={() => {
          if (emitLoading) return;
          setConfirmVisible(false);
          setAlvoUnico(null);
        }}
        onEmitir={(emitenteId, discriminacao) => void onConfirmEmitir(emitenteId, discriminacao)}
        onDepois={() => {
          setConfirmVisible(false);
          setAlvoUnico(null);
        }}
        competencia={alvosEmitir[0]?.competencia}
        emitenteIdInicial={emitenteInicial()}
        discriminacaoInicial={
          alvosEmitir.length === 1
            ? `Assinatura Azoup — fatura ${alvosEmitir[0].numero || alvosEmitir[0].stripe_invoice_id} — ${alvosEmitir[0].competencia || ''}`
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  filters: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
    backgroundColor: '#fff',
  },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.petroleum },
  sub: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  tabsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  tab: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tabOn: { borderBottomColor: colors.petroleum },
  tabTxt: { fontSize: 13, color: colors.gray500, fontWeight: '600' },
  tabTxtOn: { color: colors.petroleum, fontWeight: '700' },
  periodRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
  periodField: { flexGrow: 1, minWidth: 140, flex: 1 },
  applyBtn: {
    backgroundColor: colors.petroleum,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  applyTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.gray50,
  },
  chipTxt: { fontSize: 12, color: colors.gray700, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  searchIn: { flex: 1, fontSize: 14, color: colors.gray800, outlineStyle: 'none' } as object,
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.orangeSoft,
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectAllBtnOff: {
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
  },
  selectAllTxt: { fontSize: 13, fontWeight: '700', color: colors.orangeDark },
  selectHint: { fontSize: 12, color: colors.gray500, flexShrink: 1 },
  batchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  batchTxt: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
  msg: { fontSize: 13, color: colors.success, fontWeight: '600' },
  err: { fontSize: 13, color: colors.danger },
  list: { padding: spacing.md, paddingBottom: 40, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  checkCell: { padding: 4 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  valor: { fontFamily: fonts.bold, fontSize: 16, color: colors.petroleum },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  badgeNf: {
    backgroundColor: 'rgba(13, 59, 79, 0.1)',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeNfTxt: { fontSize: 11, fontWeight: '700', color: colors.petroleum },
  freq: { fontSize: 12, color: colors.gray500 },
  numero: { fontSize: 13, color: colors.gray700, fontWeight: '600' },
  cliente: { fontSize: 14, color: colors.gray800, fontWeight: '600' },
  meta: { fontSize: 12, color: colors.gray500 },
  warn: { fontSize: 11, color: colors.orangeDark, marginTop: 2 },
  emitBtn: {
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.orangeSoft,
    backgroundColor: colors.orangeSoft,
  },
  emitBtnDone: {
    borderColor: colors.successSoft,
    backgroundColor: colors.successSoft,
  },
  emitBtnOff: { borderColor: colors.gray100, backgroundColor: colors.gray50 },
  emitBtnTxt: { fontSize: 11, fontWeight: '700', color: colors.orangeDark },
  emitBtnTxtDone: { color: colors.success },
  emitBtnTxtOff: { color: colors.gray300 },
  empty: { textAlign: 'center', color: colors.gray500, marginTop: 40 },
  footer: { textAlign: 'center', color: colors.gray400, fontSize: 12, marginTop: 12 },
});
