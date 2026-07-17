import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { PrimaryButton } from '@/components/PrimaryButton';
import { buildVendaDetailExport } from '@/utils/exportReportBuilders';
import { BaixaPagamentoModal } from '@/components/vendas/BaixaPagamentoModal';
import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { useAuth } from '@/context/AuthContext';
import {
  countBoletosVenda,
  regenerarCarneVenda,
} from '@/services/boletoParcelaService';
import {
  fetchNotaFiscalPorVenda,
  fetchUltimaNotaFiscalVenda,
  gerarNotaFiscalParaVenda,
} from '@/services/notaFiscalService';
import {
  cancelarVenda,
  fetchVendaDetail,
  fetchVendasFinanceiroLog,
  parcelaStatusVisual,
  registrarPagamentoVenda,
} from '@/services/vendasService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import type { VendaDetail } from '@/types/vendas';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { vendaDescricaoLinhas } from '@/utils/vendasDescricao';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';
import { CONSULTA, goToConsulta, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

function statusParcelaColor(s: string): string {
  switch (s) {
    case 'pago':
      return colors.success;
    case 'parcial':
      return colors.orange;
    case 'atrasado':
      return colors.danger;
    case 'cancelado':
      return colors.gray400;
    default:
      return colors.gray600;
  }
}

export default function VendaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  useHardwareBackToConsulta(CONSULTA.vendas);
  const [detail, setDetail] = useState<VendaDetail | null>(null);
  const [logs, setLogs] = useState<{ id: string; tipo: string; detalhe: unknown; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [baixaOpen, setBaixaOpen] = useState(false);
  const [notaFiscal, setNotaFiscal] = useState<NotaFiscalListRow | null>(null);
  const [notaFiscalUltima, setNotaFiscalUltima] = useState<NotaFiscalListRow | null>(null);
  const [emittingNf, setEmittingNf] = useState(false);
  const [nfConfirmOpen, setNfConfirmOpen] = useState(false);
  const [qtdCarne, setQtdCarne] = useState(0);
  const [gerandoCarne, setGerandoCarne] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || !id) return;
    setLoading(true);
    try {
      const [d, lg, nf, nfUlt, carne] = await Promise.all([
        fetchVendaDetail(user.id, id),
        fetchVendasFinanceiroLog(id),
        fetchNotaFiscalPorVenda(user.id, id).catch(() => null),
        fetchUltimaNotaFiscalVenda(user.id, id).catch(() => null),
        countBoletosVenda(user.id, id).catch(() => 0),
      ]);
      setDetail(d);
      setLogs(lg);
      setNotaFiscal(nf);
      setNotaFiscalUltima(nfUlt);
      setQtdCarne(carne);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, id]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPago = detail?.parcelas.reduce((s, p) => s + (Number(p.valor_pago) || 0), 0) ?? 0;
  const totalValor = detail ? Number(detail.valor_total) : 0;
  const pendente = Math.max(0, totalValor - totalPago);

  const onBaixa = async (payload: Parameters<typeof registrarPagamentoVenda>[2]) => {
    if (!user?.id || !id) return;
    await registrarPagamentoVenda(user.id, id, payload);
    Toast.show({ type: 'success', text1: 'Pagamento registrado.' });
    await load();
  };

  const onCancelar = () => {
    if (!user?.id || !id) return;
    Alert.alert('Cancelar venda', 'Confirma o cancelamento desta venda?', [
      { text: 'Não', style: 'cancel' },
      {
        text: 'Sim',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelarVenda(user.id, id);
            Toast.show({ type: 'success', text1: 'Venda cancelada.' });
            goToConsulta(CONSULTA.vendas);
          } catch (e) {
            Toast.show({ type: 'error', text1: (e as Error).message });
          }
        },
      },
    ]);
  };

  const avisoBoletoLog = logs.find((l) => l.tipo === 'aviso_boleto');
  const avisoBoletoMsg =
    avisoBoletoLog?.detalhe &&
    typeof avisoBoletoLog.detalhe === 'object' &&
    avisoBoletoLog.detalhe !== null &&
    'mensagem' in avisoBoletoLog.detalhe
      ? String((avisoBoletoLog.detalhe as { mensagem?: string }).mensagem ?? '')
      : '';

  const onGerarCarne = async () => {
    if (!user?.id || !id) return;
    setGerandoCarne(true);
    try {
      await regenerarCarneVenda(user.id, id);
      Toast.show({ type: 'success', text1: 'Carnê gerado.', text2: 'Veja em A receber.' });
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message, visibilityTime: 8000 });
    } finally {
      setGerandoCarne(false);
    }
  };

  const onEmitirNf = () => {
    if (!user?.id || !detail || !id) return;
    setNfConfirmOpen(true);
  };

  const executarEmitirNf = async (emitenteId?: string) => {
    if (!user?.id || !detail || !id) return;
    const descricao = vendaDescricaoLinhas(detail).join(' · ');
    setEmittingNf(true);
    try {
      const res = await gerarNotaFiscalParaVenda(
        user.id,
        {
          id,
          cliente_id: detail.cliente_id,
          valor_total: Number(detail.valor_total),
          descricao,
        },
        { emitenteId: emitenteId || undefined },
      );
      if (res.success) {
        setNfConfirmOpen(false);
        Toast.show({
          type: 'success',
          text1: 'NFS-e autorizada.',
          text2: 'Veja em Notas fiscais.',
        });
        await load();
        router.push('/(app)/notas-fiscais');
      } else {
        setNfConfirmOpen(false);
        Toast.show({
          type: 'error',
          text1: res.message ?? 'NFS-e rejeitada.',
          text2: res.notaId ? 'Veja o motivo em Notas fiscais.' : undefined,
          visibilityTime: 10000,
        });
        if (res.notaId) router.push('/(app)/notas-fiscais');
        await load();
      }
    } catch (e) {
      setNfConfirmOpen(false);
      Toast.show({ type: 'error', text1: (e as Error).message, visibilityTime: 10000 });
    } finally {
      setEmittingNf(false);
    }
  };

  if (loading && !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.miss}>Venda não encontrada.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ExportReportButtons getReport={() => buildVendaDetailExport(detail)} />
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.h1}>{detail.cliente.nome_cliente}</Text>
            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: colors.gray100 }]}>
                <Text style={styles.tagTxt}>{detail.status}</Text>
              </View>
              <View
                style={[
                  styles.tag,
                  { backgroundColor: detail.cliente.emite_nf ? '#e8f5e9' : '#fff3e0' },
                ]}
              >
                <Text
                  style={[
                    styles.tagTxt,
                    { color: detail.cliente.emite_nf ? '#2e7d32' : '#e65100' },
                  ]}
                >
                  {detail.cliente.emite_nf ? 'Com NF' : 'Sem NF'}
                </Text>
              </View>
            </View>
          </View>
          {detail.cliente.nome_empresa ? (
            <Text style={styles.emp}>{detail.cliente.nome_empresa}</Text>
          ) : null}
          {(() => {
            const linhas = vendaDescricaoLinhas(detail);
            if (linhas.length === 0) return null;
            if (linhas.length === 1) {
              return <Text style={styles.descSolo}>{linhas[0]}</Text>;
            }
            return (
              <>
                <Text style={styles.secDesc}>Itens</Text>
                {linhas.map((linha, i) => (
                  <View key={i} style={styles.descLineWrap}>
                    <Text style={styles.descBullet}>•</Text>
                    <Text style={styles.desc}>{linha}</Text>
                  </View>
                ))}
              </>
            );
          })()}
          <View style={styles.resumo}>
            <View>
              <Text style={styles.rLab}>Total</Text>
              <Text style={styles.rVal}>{formatBRL(detail.valor_total)}</Text>
            </View>
            <View>
              <Text style={styles.rLab}>Pago</Text>
              <Text style={[styles.rVal, { color: colors.success }]}>{formatBRL(totalPago)}</Text>
            </View>
            <View>
              <Text style={styles.rLab}>Pendente</Text>
              <Text style={[styles.rVal, { color: colors.orange }]}>{formatBRL(pendente)}</Text>
            </View>
          </View>
          <Text style={styles.meta}>Criada em {formatDateTimeBRFromISO(detail.created_at)}</Text>
        </Card>

        {avisoBoletoMsg && qtdCarne === 0 ? (
          <Card style={styles.avisoCard}>
            <Text style={styles.avisoTit}>Carnê não foi gerado na venda</Text>
            <Text style={styles.avisoTxt}>{avisoBoletoMsg}</Text>
          </Card>
        ) : null}

        <View style={styles.actions}>
          {qtdCarne === 0 && detail.status !== 'cancelada' ? (
            <PrimaryButton
              title={gerandoCarne ? 'Gerando carnê…' : 'Gerar carnê em A receber'}
              onPress={() => void onGerarCarne()}
              disabled={gerandoCarne}
            />
          ) : null}
          {qtdCarne > 0 ? (
            <Pressable style={styles.nfLink} onPress={() => router.push('/(app)/contas-receber')}>
              <Text style={styles.nfLinkTxt}>
                {qtdCarne} carnê(s) em A receber — abrir lista
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.orange} />
            </Pressable>
          ) : null}
          {!notaFiscal && detail.status !== 'cancelada' ? (
            <PrimaryButton
              title={emittingNf ? 'Emitindo NFS-e…' : 'Emitir NFS-e'}
              onPress={onEmitirNf}
              disabled={emittingNf}
            />
          ) : null}
          {notaFiscalUltima ? (
            <Pressable style={styles.nfLink} onPress={() => router.push('/(app)/notas-fiscais')}>
              <Text style={styles.nfLinkTxt}>
                NFS-e {notaFiscalUltima.serie}/{notaFiscalUltima.numero} — {notaFiscalUltima.status}
                {notaFiscalUltima.status === 'rejeitada' && notaFiscalUltima.motivo_rejeicao
                  ? ` · ${notaFiscalUltima.motivo_rejeicao.slice(0, 60)}`
                  : ''}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.orange} />
            </Pressable>
          ) : null}
          {!detail.cliente.emite_nf ? (
            <Pressable
              style={styles.nfHint}
              onPress={() => router.push(`/(app)/clients/${detail.cliente.id}`)}
            >
              <Text style={styles.nfHintTxt}>
                Cliente marcado como Sem NF — emissão manual permitida. Toque para editar o cadastro.
              </Text>
            </Pressable>
          ) : null}
          <PrimaryButton
            title="Dar baixa"
            onPress={() => setBaixaOpen(true)}
            disabled={pendente <= 0.009 || detail.status === 'cancelada'}
          />
          <PrimaryButton
            title="Cancelar venda"
            variant="danger"
            onPress={onCancelar}
            disabled={detail.status === 'cancelada' || totalPago > 0.009}
          />
        </View>

        <Text style={styles.sec}>Parcelas</Text>
        {detail.parcelas.map((p) => {
          const vis = parcelaStatusVisual(p);
          const open =
            p.status !== 'cancelado' &&
            reaisParaCentavos(p.valor_pago) < reaisParaCentavos(p.valor);
          const rest = centavosParaReais(
            reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago),
          );
          return (
            <Card key={p.id} style={styles.parc}>
              <View style={styles.rowBetween}>
                <Text style={styles.pNum}>Parcela {p.numero_parcela}</Text>
                <Text style={[styles.pSt, { color: statusParcelaColor(vis) }]}>{vis}</Text>
              </View>
              <Text style={styles.pForm}>{p.forma_pagamento?.nome ?? '—'}</Text>
              <Text style={styles.pVal}>{formatBRL(p.valor)}</Text>
              <Text style={styles.pSub}>
                Pago {formatBRL(p.valor_pago)}
                {open ? ` · em aberto ${formatBRL(rest)}` : ''}
              </Text>
              <Text style={styles.pVen}>Vencimento {p.data_vencimento.split('-').reverse().join('/')}</Text>
            </Card>
          );
        })}

        <Text style={styles.sec}>Pagamentos</Text>
        {detail.pagamentos.length === 0 ? (
          <Text style={styles.empty}>Nenhum pagamento ainda.</Text>
        ) : (
          detail.pagamentos.map((pay) => {
            const parts = detail.pagamento_parcelas.filter((x) => x.pagamento_id === pay.id);
            const parcLines = parts
              .map((pp) => {
                const pr = detail.parcelas.find((x) => x.id === pp.parcela_id);
                return pr ? `#${pr.numero_parcela}: ${formatBRL(pp.valor_aplicado)}` : '';
              })
              .filter(Boolean)
              .join(' · ');
            return (
              <Card key={pay.id} style={styles.payCard}>
                <Text style={styles.payVal}>{formatBRL(pay.valor_pago)}</Text>
                <Text style={styles.payDate}>
                  {pay.data_pagamento.split('-').reverse().join('/')} ·{' '}
                  {formatDateTimeBRFromISO(pay.created_at)}
                </Text>
                {pay.observacao ? <Text style={styles.payObs}>{pay.observacao}</Text> : null}
                {parcLines ? <Text style={styles.payParc}>Parcelas: {parcLines}</Text> : null}
                <Text style={styles.payUser}>Usuário: {pay.user_id.slice(0, 8)}…</Text>
              </Card>
            );
          })
        )}

        <Text style={styles.sec}>Histórico financeiro</Text>
        {logs.map((l) => (
          <View key={l.id} style={styles.logRow}>
            <Ionicons name="document-text-outline" size={18} color={colors.gray400} />
            <View style={{ flex: 1 }}>
              <Text style={styles.logTipo}>{l.tipo}</Text>
              <Text style={styles.logTime}>{formatDateTimeBRFromISO(l.created_at)}</Text>
              {l.detalhe != null ? (
                <Text style={styles.logDet} numberOfLines={3}>
                  {JSON.stringify(l.detalhe)}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <BaixaPagamentoModal
        visible={baixaOpen}
        onClose={() => setBaixaOpen(false)}
        parcelas={detail.parcelas}
        onSubmit={onBaixa}
      />

      <ConfirmarEmitirNfseModal
        visible={nfConfirmOpen}
        titulo="Emitir NFS-e"
        descricao={
          !detail.cliente.emite_nf
            ? `Gerar nota fiscal de ${formatBRL(detail.valor_total)} para esta venda? O cliente está como Sem NF no cadastro; a emissão manual será feita mesmo assim.`
            : `Gerar nota fiscal de ${formatBRL(detail.valor_total)} para esta venda?`
        }
        botaoPrimario="Emitir NFS-e"
        botaoSecundario="Cancelar"
        loading={emittingNf}
        onClose={() => !emittingNf && setNfConfirmOpen(false)}
        onEmitir={(emitenteId) => void executarEmitirNf(emitenteId)}
        onDepois={() => !emittingNf && setNfConfirmOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  miss: { color: colors.gray600 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  h1: { fontSize: 20, fontWeight: '800', color: colors.petroleum, flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tagRow: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  tagTxt: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  emp: { fontSize: 14, color: colors.gray600, marginTop: 4 },
  secDesc: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.gray600,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  descSolo: {
    marginTop: spacing.md,
    fontSize: 15,
    color: colors.gray800,
    lineHeight: 22,
  },
  descLineWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  descBullet: {
    fontSize: 15,
    color: colors.orange,
    lineHeight: 22,
    width: 14,
  },
  desc: { flex: 1, fontSize: 15, color: colors.gray800, lineHeight: 22 },
  resumo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
  },
  rLab: { fontSize: 11, color: colors.gray400, fontWeight: '600' },
  rVal: { fontSize: 16, fontWeight: '800', color: colors.petroleum, marginTop: 4 },
  meta: { marginTop: spacing.md, fontSize: 12, color: colors.gray400 },
  actions: { gap: spacing.sm, marginBottom: spacing.md },
  avisoCard: {
    marginBottom: spacing.md,
    borderColor: colors.orange,
    borderWidth: 1,
    backgroundColor: '#fff8e1',
  },
  avisoTit: { fontSize: 14, fontWeight: '800', color: colors.petroleum, marginBottom: spacing.xs },
  avisoTxt: { fontSize: 13, color: colors.gray800, lineHeight: 18 },
  nfLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  nfLinkTxt: { fontSize: 14, fontWeight: '600', color: colors.petroleum, flex: 1 },
  nfHint: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  nfHintTxt: { fontSize: 12, color: colors.gray800, lineHeight: 17 },
  sec: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.petroleum,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  parc: { marginBottom: spacing.sm },
  pNum: { fontSize: 15, fontWeight: '700', color: colors.petroleum },
  pSt: { fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  pForm: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  pVal: { fontSize: 18, fontWeight: '800', color: colors.orange, marginTop: spacing.xs },
  pSub: { fontSize: 13, color: colors.gray800, marginTop: 4 },
  pVen: { fontSize: 12, color: colors.gray400, marginTop: 4 },
  empty: { color: colors.gray400, marginBottom: spacing.md },
  payCard: { marginBottom: spacing.sm },
  payVal: { fontSize: 18, fontWeight: '800', color: colors.success },
  payDate: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  payObs: { fontSize: 14, color: colors.gray800, marginTop: spacing.sm },
  payParc: { fontSize: 12, color: colors.gray600, marginTop: 4 },
  payUser: { fontSize: 11, color: colors.gray400, marginTop: 6 },
  logRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  logTipo: { fontWeight: '700', color: colors.petroleum, textTransform: 'capitalize' },
  logTime: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  logDet: { fontSize: 11, color: colors.gray600, marginTop: 4, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }) },
});
