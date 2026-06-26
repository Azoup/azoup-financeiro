import { DatePickerField } from '@/components/DatePickerField';
import { ContaReceberAcoesModal } from '@/components/contas-receber/ContaReceberAcoesModal';
import { ContaReceberPagarParcelaVendaModal } from '@/components/contas-receber/ContaReceberPagarParcelaVendaModal';
import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { MarcarPagamentoMensalidadeGeradaModal } from '@/components/mensalidades/MarcarPagamentoMensalidadeGeradaModal';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  fetchBoletoParcelaById,
  fetchContasReceberLista,
  sincronizarCarnesMensalidadesFaltantes,
  sincronizarCarnesVendasFaltantes,
} from '@/services/boletoParcelaService';
import {
  fetchMensalidadeGeradaById,
  registrarPagamentoMensalidadeGerada,
} from '@/services/mensalidadeGeradaService';
import {
  fetchNotaFiscalPorMensalidade,
  gerarNotaFiscalParaMensalidade,
  gerarNotaFiscalParaVenda,
} from '@/services/notaFiscalService';
import { sincronizarBoletosPendentes } from '@/services/sicoobBoletoService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import {
  fetchParcelaVendaById,
  fetchVendaParaNotaFiscal,
  registrarPagamentoVenda,
} from '@/services/vendasService';
import type { MensalidadeGerada } from '@/types/mensalidadeGerada';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';
import { colors, radius, spacing } from '@/theme/colors';
import type { ContaReceberListRow, ContaReceberOrigem } from '@/types/contasReceber';
import type { ContaReceberSituacao } from '@/utils/contaReceberCobranca';
import { buildContasReceberExport } from '@/utils/exportReportBuilders';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import { CONSULTA, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import {
  abrirWhatsAppCobrancaNaConversa,
  formatWhatsAppDisplay,
} from '@/utils/whatsappCobranca';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
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

type OrigemFiltro = 'todos' | ContaReceberOrigem;
type SituacaoFiltro = 'todos' | ContaReceberSituacao;

const ORIGEM_OPTS: { id: OrigemFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'venda', label: 'Venda' },
  { id: 'mensalidade', label: 'Mensalidade' },
];

const SITUACAO_OPTS: { id: SituacaoFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'aberto', label: 'Em aberto' },
  { id: 'pago', label: 'Pagos' },
  { id: 'cancelado', label: 'Cancelados' },
];

function origemLabel(origem: ContaReceberOrigem): string {
  return origem === 'mensalidade' ? 'Mensalidade' : 'Venda';
}

function origemStyle(origem: ContaReceberOrigem): { bg: string; fg: string } {
  return origem === 'mensalidade'
    ? { bg: '#fff3e0', fg: colors.orangeDark }
    : { bg: '#e3f2fd', fg: colors.petroleum };
}

function boletoRegistroLabel(status?: ContaReceberListRow['status_registro']): string {
  switch (status ?? 'informativo') {
    case 'registrado':
      return 'Sicoob';
    case 'pendente':
      return 'Registrando…';
    case 'erro':
      return 'Erro Sicoob';
    case 'pago':
      return 'Pago (Sicoob)';
    case 'baixado':
      return 'Baixado';
    default:
      return 'Informativo';
  }
}

export default function ContasReceberScreen() {
  const { user } = useAuth();
  const router = useRouter();
  useHardwareBackToConsulta(CONSULTA.contasReceber);

  const [allRows, setAllRows] = useState<ContaReceberListRow[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [vencimentoDe, setVencimentoDe] = useState<string | null>(null);
  const [vencimentoAte, setVencimentoAte] = useState<string | null>(null);
  const [origemFilter, setOrigemFilter] = useState<OrigemFiltro>('todos');
  const [situacaoFilter, setSituacaoFilter] = useState<SituacaoFiltro>('todos');
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftVencDe, setDraftVencDe] = useState<string | null>(null);
  const [draftVencAte, setDraftVencAte] = useState<string | null>(null);
  const [draftOrigem, setDraftOrigem] = useState<OrigemFiltro>('todos');
  const [draftSituacao, setDraftSituacao] = useState<SituacaoFiltro>('todos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [nomeBeneficiario, setNomeBeneficiario] = useState<string | null>(null);
  const [acoesItem, setAcoesItem] = useState<ContaReceberListRow | null>(null);
  const [payMensalidade, setPayMensalidade] = useState<MensalidadeGerada | null>(null);
  const [payVendaCtx, setPayVendaCtx] = useState<{
    vendaId: string;
    parcelaId: string;
    referenciaLabel: string;
    saldoMax: number;
  } | null>(null);
  const [nfBusy, setNfBusy] = useState(false);
  const [nfBusyId, setNfBusyId] = useState<string | null>(null);
  const [nfPosPagamentoMensalidade, setNfPosPagamentoMensalidade] = useState<MensalidadeGerada | null>(null);
  const [nfEmitindoPosPagamento, setNfEmitindoPosPagamento] = useState(false);
  const [nfConfirmItem, setNfConfirmItem] = useState<ContaReceberListRow | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      try {
        const [syncMen, syncVen] = await Promise.all([
          sincronizarCarnesMensalidadesFaltantes(user.id).catch((e) => {
            const msg = (e as Error).message;
            if (/mensalidade_id|018|019|034|boletos_parcela/i.test(msg)) {
              Toast.show({ type: 'error', text1: 'Banco desatualizado', text2: msg, visibilityTime: 8000 });
            }
            return { gerados: 0 };
          }),
          sincronizarCarnesVendasFaltantes(user.id).catch((e) => {
            const msg = (e as Error).message;
            if (/034|boletos_parcela|does not exist/i.test(msg)) {
              Toast.show({ type: 'error', text1: 'Banco desatualizado', text2: msg, visibilityTime: 8000 });
            }
            return { gerados: 0 };
          }),
        ]);
        if (syncMen.gerados > 0) {
          Toast.show({
            type: 'info',
            text1: `${syncMen.gerados} carnê(s) de mensalidade incluído(s) em A receber.`,
          });
        }
        if (syncVen.gerados > 0) {
          Toast.show({
            type: 'success',
            text1: `${syncVen.gerados} carnê(s) de venda incluído(s) em A receber.`,
          });
        }
      } catch (syncErr) {
        const msg = (syncErr as Error).message;
        if (/mensalidade_id|018|019|034|boletos_parcela/i.test(msg)) {
          Toast.show({ type: 'error', text1: 'Banco desatualizado', text2: msg, visibilityTime: 8000 });
        }
      }

      try {
        const sicoobSync = await sincronizarBoletosPendentes();
        if (sicoobSync.baixados > 0) {
          Toast.show({
            type: 'success',
            text1: `${sicoobSync.baixados} boleto(s) quitado(s) automaticamente via Sicoob.`,
          });
        }
      } catch {
        /* Sicoob inativo ou API indisponível em dev */
      }

      const [list, perfil] = await Promise.all([
        fetchContasReceberLista(user.id),
        fetchPerfilCobranca(user.id).catch(() => null),
      ]);
      setAllRows(list);
      setNomeBeneficiario(perfil?.razao_social?.trim() || null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    try {
      await sincronizarCarnesMensalidadesFaltantes(user.id).catch(() => undefined);
      await sincronizarCarnesVendasFaltantes(user.id).catch(() => undefined);
      await sincronizarBoletosPendentes().catch(() => undefined);
      const [list, perfil] = await Promise.all([
        fetchContasReceberLista(user.id),
        fetchPerfilCobranca(user.id).catch(() => null),
      ]);
      setAllRows(list);
      setNomeBeneficiario(perfil?.razao_social?.trim() || null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  };

  const resumo = useMemo(() => {
    let aberto = 0;
    let pago = 0;
    let valorAberto = 0;
    for (const r of allRows) {
      if (r.situacao_cobranca === 'pago') pago += 1;
      else if (r.situacao_cobranca === 'aberto') {
        aberto += 1;
        valorAberto += Number(r.valor_documento) || 0;
      }
    }
    return { aberto, pago, valorAberto };
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let list = allRows;
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (r) =>
          r.nome_cliente.toLowerCase().includes(term) ||
          r.numero_documento.toLowerCase().includes(term) ||
          r.referencia_label.toLowerCase().includes(term),
      );
    }
    if (origemFilter !== 'todos') {
      list = list.filter((r) => r.origem === origemFilter);
    }
    if (situacaoFilter !== 'todos') {
      list = list.filter((r) => r.situacao_cobranca === situacaoFilter);
    }
    if (vencimentoDe) {
      list = list.filter((r) => r.data_vencimento >= vencimentoDe);
    }
    if (vencimentoAte) {
      list = list.filter((r) => r.data_vencimento <= vencimentoAte);
    }
    return list;
  }, [allRows, debouncedSearch, origemFilter, situacaoFilter, vencimentoDe, vencimentoAte]);

  const temFiltroAtivo =
    Boolean(search.trim()) ||
    origemFilter !== 'todos' ||
    situacaoFilter !== 'aberto' ||
    Boolean(vencimentoDe) ||
    Boolean(vencimentoAte);

  const abrirFiltros = () => {
    setDraftVencDe(vencimentoDe);
    setDraftVencAte(vencimentoAte);
    setDraftOrigem(origemFilter);
    setDraftSituacao(situacaoFilter);
    setFilterOpen(true);
  };

  const aplicarFiltros = () => {
    setVencimentoDe(draftVencDe);
    setVencimentoAte(draftVencAte);
    setOrigemFilter(draftOrigem);
    setSituacaoFilter(draftSituacao);
    setFilterOpen(false);
  };

  const limparFiltros = () => {
    setSearch('');
    setVencimentoDe(null);
    setVencimentoAte(null);
    setOrigemFilter('todos');
    setSituacaoFilter('aberto');
    setDraftVencDe(null);
    setDraftVencAte(null);
    setDraftOrigem('todos');
    setDraftSituacao('aberto');
  };

  const enviarWhatsApp = (item: ContaReceberListRow) => {
    try {
      abrirWhatsAppCobrancaNaConversa(item, {
        nomeBeneficiario: nomeBeneficiario ?? undefined,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  const refreshLista = useCallback(async () => {
    if (!user?.id) return;
    const list = await fetchContasReceberLista(user.id);
    setAllRows(list);
  }, [user?.id]);

  const abrirAcoes = (item: ContaReceberListRow) => {
    setAcoesItem(item);
  };

  const fecharAcoes = () => {
    setAcoesItem(null);
  };

  const abrirPdf = async (boletoId: string) => {
    if (!user?.id) return;
    setPdfId(boletoId);
    try {
      const row = await fetchBoletoParcelaById(user.id, boletoId);
      if (!row) {
        Toast.show({ type: 'error', text1: 'Registro não encontrado.' });
        return;
      }
      if (row.pdf_url && row.status_registro === 'registrado') {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.open(row.pdf_url, '_blank', 'noopener,noreferrer');
        } else {
          const ok = await Linking.canOpenURL(row.pdf_url);
          if (ok) await Linking.openURL(row.pdf_url);
          else Toast.show({ type: 'error', text1: 'Não foi possível abrir o PDF do Sicoob.' });
        }
        return;
      }
      const html = buildBoletoCobrancaHtml(row);
      const { uri } = await Print.printToFileAsync({ html });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(uri, '_blank', 'noopener,noreferrer');
      } else {
        const ok = await Linking.canOpenURL(uri);
        if (ok) await Linking.openURL(uri);
        else Toast.show({ type: 'error', text1: 'Não foi possível abrir o PDF.' });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setPdfId(null);
    }
  };

  const iniciarPagamento = async (itemOverride?: ContaReceberListRow) => {
    const item = itemOverride ?? acoesItem;
    if (!user?.id || !item) return;
    fecharAcoes();
    try {
      if (item.origem === 'mensalidade' && item.mensalidade_id) {
        const m = await fetchMensalidadeGeradaById(user.id, item.mensalidade_id);
        if (!m) {
          Toast.show({ type: 'error', text1: 'Mensalidade não encontrada.' });
          return;
        }
        setPayMensalidade(m);
        return;
      }
      if (item.origem === 'venda' && item.venda_id && item.parcela_id) {
        const p = await fetchParcelaVendaById(item.parcela_id);
        if (!p) {
          Toast.show({ type: 'error', text1: 'Parcela não encontrada.' });
          return;
        }
        const saldoCent = Math.max(0, reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago));
        if (saldoCent <= 0) {
          Toast.show({ type: 'info', text1: 'Esta parcela já está quitada.' });
          await refreshLista();
          return;
        }
        setPayVendaCtx({
          vendaId: item.venda_id,
          parcelaId: item.parcela_id,
          referenciaLabel: item.referencia_label,
          saldoMax: centavosParaReais(saldoCent),
        });
        return;
      }
      Toast.show({ type: 'error', text1: 'Não foi possível identificar a origem do documento.' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  const confirmarPagamentoMensalidade = async (payload: {
    data_pagamento: string;
    valor_pago: number;
    forma_pagamento: string;
    observacao: string;
  }) => {
    if (!user?.id || !payMensalidade) return;
    const mensalidade = payMensalidade;
    await registrarPagamentoMensalidadeGerada(user.id, mensalidade.id, payload);
    setPayMensalidade(null);
    await refreshLista();
    const existente = await fetchNotaFiscalPorMensalidade(user.id, mensalidade.id).catch(() => null);
    if (!existente) {
      setNfPosPagamentoMensalidade(mensalidade);
    }
  };

  const confirmarPagamentoVenda = async (payload: {
    data_pagamento: string;
    valor_pago: number;
    observacao: string;
  }) => {
    if (!user?.id || !payVendaCtx) return;
    await registrarPagamentoVenda(user.id, payVendaCtx.vendaId, {
      ...payload,
      alocacao_manual: [{ parcela_id: payVendaCtx.parcelaId, valor: payload.valor_pago }],
    });
    setPayVendaCtx(null);
    await refreshLista();
  };

  const solicitarEmitirNf = (item: ContaReceberListRow) => {
    if (item.nota_fiscal_id) {
      router.push('/(app)/notas-fiscais');
      return;
    }
    fecharAcoes();
    setNfConfirmItem(item);
  };

  const descricaoConfirmNf = (item: ContaReceberListRow): string => {
    const valor = formatBRL(item.valor_documento);
    if (item.origem === 'mensalidade') {
      return `Gerar NFS-e de ${valor} para ${item.referencia_label}?`;
    }
    return `Gerar NFS-e de ${valor} para esta venda (${item.referencia_label})?`;
  };

  const emitirNotaFiscal = async (itemOverride?: ContaReceberListRow) => {
    const item = itemOverride ?? acoesItem;
    if (!user?.id || !item) return;
    if (item.nota_fiscal_id) {
      fecharAcoes();
      router.push('/(app)/notas-fiscais');
      return;
    }
    setNfBusy(true);
    setNfBusyId(item.id);
    try {
      if (item.origem === 'mensalidade' && item.mensalidade_id) {
        const m = await fetchMensalidadeGeradaById(user.id, item.mensalidade_id);
        if (!m) throw new Error('Mensalidade não encontrada.');
        const res = await gerarNotaFiscalParaMensalidade(user.id, {
          id: m.id,
          cliente_id: m.cliente_id,
          valor: m.valor,
          competencia: m.competencia,
        });
        if (res.success) {
          Toast.show({ type: 'success', text1: res.message ?? 'NFS-e emitida com sucesso.' });
          router.push('/(app)/notas-fiscais');
        } else if (res.ignorada) {
          Toast.show({ type: 'info', text1: res.message ?? 'Cliente marcado como Sem NF no cadastro.' });
        } else {
          Toast.show({ type: 'error', text1: res.message ?? 'Não foi possível emitir a NFS-e.' });
        }
      } else if (item.origem === 'venda' && item.venda_id) {
        const venda = await fetchVendaParaNotaFiscal(user.id, item.venda_id);
        if (!venda) throw new Error('Venda não encontrada.');
        const res = await gerarNotaFiscalParaVenda(user.id, venda);
        if (res.success) {
          Toast.show({ type: 'success', text1: 'NFS-e emitida com sucesso.' });
          router.push('/(app)/notas-fiscais');
        } else {
          Toast.show({ type: 'error', text1: res.message ?? 'NFS-e rejeitada.' });
        }
      } else {
        throw new Error('Origem do documento não identificada.');
      }
      fecharAcoes();
      setNfConfirmItem(null);
      await refreshLista();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setNfBusy(false);
      setNfBusyId(null);
    }
  };
    if (!user?.id || !nfPosPagamentoMensalidade) return;
    setNfEmitindoPosPagamento(true);
    try {
      const m = nfPosPagamentoMensalidade;
      const res = await gerarNotaFiscalParaMensalidade(user.id, {
        id: m.id,
        cliente_id: m.cliente_id,
        valor: m.valor,
        competencia: m.competencia,
      });
      if (res.success) {
        Toast.show({ type: 'success', text1: res.message ?? 'NFS-e emitida com sucesso.' });
        router.push('/(app)/notas-fiscais');
      } else if (res.ignorada) {
        Toast.show({ type: 'info', text1: res.message ?? 'Cliente sem NF no cadastro.' });
      } else {
        Toast.show({ type: 'error', text1: res.message ?? 'Não foi possível emitir a NFS-e.' });
      }
      await refreshLista();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setNfEmitindoPosPagamento(false);
      setNfPosPagamentoMensalidade(null);
    }
  };

  const verOrigem = () => {
    if (!acoesItem) return;
    fecharAcoes();
    if (acoesItem.origem === 'venda' && acoesItem.venda_id) {
      router.push(`/(app)/vendas/${acoesItem.venda_id}`);
      return;
    }
    if (acoesItem.cliente_id) {
      router.push(`/(app)/mensalidades?cliente=${acoesItem.cliente_id}`);
      return;
    }
    router.push('/(app)/mensalidades');
  };

  const renderItem = ({ item, index }: { item: ContaReceberListRow; index: number }) => {
    const pdfBusy = pdfId === item.id;
    const stOrig = origemStyle(item.origem);
    const venc = formatBRDate(parseISODate(item.data_vencimento)) || item.data_vencimento;
    const isLast = index === filteredRows.length - 1;
    const atrasado =
      item.situacao_cobranca === 'aberto' && item.parcela_status === 'atrasado';
    const temWhats = Boolean(item.whatsapp?.trim());
    const podeEmitirNf = item.situacao_cobranca !== 'cancelado' && !item.nota_fiscal_id;
    const nfBusyRow = nfBusyId === item.id;

    return (
      <View style={[styles.row, isLast && styles.rowLast]}>
        <Pressable
          style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
          onPress={() => abrirAcoes(item)}
          disabled={pdfBusy}
        >
          <View style={styles.colCliente}>
            <Text style={styles.cliNome} numberOfLines={2}>
              {item.nome_cliente}
            </Text>
            {atrasado ? <Text style={styles.cliAtraso}>Atrasado</Text> : null}
            {temWhats ? (
              <Text style={styles.cliWa} numberOfLines={1}>
                {formatWhatsAppDisplay(item.whatsapp!)}
              </Text>
            ) : (
              <Text style={styles.cliSemWa}>Sem WhatsApp no cadastro</Text>
            )}
          </View>
          <View style={[styles.tipoBadge, { backgroundColor: stOrig.bg }]}>
            <Text style={[styles.tipoTxt, { color: stOrig.fg }]}>{origemLabel(item.origem)}</Text>
          </View>
          <View
            style={[
              styles.tipoBadge,
              {
                backgroundColor:
                  item.status_registro === 'registrado'
                    ? '#e8f5e9'
                    : item.status_registro === 'erro'
                      ? '#ffebee'
                      : '#f1f5f9',
              },
            ]}
          >
            <Text
              style={[
                styles.tipoTxt,
                {
                  color:
                    item.status_registro === 'registrado'
                      ? '#2e7d32'
                      : item.status_registro === 'erro'
                        ? '#c62828'
                        : colors.gray600,
                },
              ]}
            >
              {boletoRegistroLabel(item.status_registro ?? 'informativo')}
            </Text>
          </View>
          <Text style={styles.colVenc}>{venc}</Text>
          <Text style={styles.colValor}>{formatBRL(item.valor_documento)}</Text>
        </Pressable>
        <View style={styles.colAcoes}>
          {item.situacao_cobranca === 'aberto' ? (
            <Pressable
              style={[styles.acaoBtn, styles.acaoPagar]}
              onPress={() => void iniciarPagamento(item)}
              accessibilityLabel="Marcar como pago"
            >
              <Ionicons name="cash-outline" size={18} color={colors.white} />
            </Pressable>
          ) : null}
          {podeEmitirNf ? (
            <Pressable
              style={[styles.acaoBtn, styles.acaoNf]}
              onPress={() => solicitarEmitirNf(item)}
              disabled={nfBusy}
              accessibilityLabel="Gerar e emitir NFS-e"
            >
              {nfBusyRow ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="receipt-outline" size={18} color={colors.white} />
              )}
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.acaoBtn, styles.acaoWa, !temWhats && styles.acaoBtnDisabled]}
            onPress={() => enviarWhatsApp(item)}
            disabled={!temWhats || pdfBusy}
            accessibilityLabel="Enviar cobrança por WhatsApp"
          >
            <Ionicons name="logo-whatsapp" size={18} color={temWhats ? colors.white : colors.gray400} />
          </Pressable>
          <Pressable
            style={styles.acaoBtn}
            onPress={() => abrirAcoes(item)}
            accessibilityLabel="Mais ações"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.petroleum} />
          </Pressable>
        </View>
      </View>
    );
  };

  const listHeader = (
    <>
      <View style={styles.toolbar}>
        <ExportReportButtons
          disabled={loading}
          getReport={() => buildContasReceberExport(filteredRows)}
        />
        <View style={styles.acoesRow}>
          <Pressable style={styles.acaoChip} onPress={() => router.push('/(app)/mensalidades/gerar')}>
            <Ionicons name="receipt-outline" size={16} color={colors.petroleum} />
            <Text style={styles.acaoChipTxt}>Gerar mensalidade</Text>
          </Pressable>
          <Pressable style={styles.acaoChip} onPress={() => router.push('/(app)/vendas/new')}>
            <Ionicons name="cart-outline" size={16} color={colors.petroleum} />
            <Text style={styles.acaoChipTxt}>Nova venda</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/(app)/configuracoes/perfil-cobranca')} style={styles.linkChip}>
          <Text style={styles.linkChipTxt}>Dados do beneficiário</Text>
        </Pressable>
      </View>

      <View style={styles.resumoStrip}>
        <View style={styles.resumoItem}>
          <Text style={styles.resumoVal}>{resumo.aberto}</Text>
          <Text style={styles.resumoLab}>Em aberto</Text>
        </View>
        <View style={styles.resumoItem}>
          <Text style={styles.resumoVal}>{formatBRL(resumo.valorAberto)}</Text>
          <Text style={styles.resumoLab}>Total a cobrar</Text>
        </View>
        <View style={styles.resumoItem}>
          <Text style={styles.resumoVal}>{resumo.pago}</Text>
          <Text style={styles.resumoLab}>Pagos</Text>
        </View>
      </View>

      <Text style={styles.lead}>
        Toque na linha para pagar, gerar NFS-e, abrir PDF ou enviar cobrança. Botão laranja = pagamento; azul = NFS-e.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.situacaoChips}>
        {SITUACAO_OPTS.map((o) => {
          const on = situacaoFilter === o.id;
          return (
            <Pressable
              key={o.id}
              style={[styles.sitChip, on && styles.sitChipOn]}
              onPress={() => setSituacaoFilter(o.id)}
            >
              <Text style={[styles.sitChipTxt, on && styles.sitChipTxtOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.gray400} />
          <TextInput
            style={styles.searchIn}
            placeholder="Buscar cliente ou documento"
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
        <Pressable style={styles.filterBtn} onPress={abrirFiltros}>
          <Ionicons name="options-outline" size={22} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.filterMeta}>
        <Text style={styles.resultCount}>
          {loading ? 'Carregando…' : `${filteredRows.length} de ${allRows.length} documento(s)`}
        </Text>
        {temFiltroAtivo ? (
          <Pressable onPress={limparFiltros}>
            <Text style={styles.clearLink}>Limpar filtros</Text>
          </Pressable>
        ) : null}
      </View>

      {filteredRows.length > 0 ? (
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.thCliente]}>Cliente</Text>
          <Text style={[styles.th, styles.thTipo]}>Tipo</Text>
          <Text style={[styles.th, styles.thVenc]}>Venc.</Text>
          <Text style={[styles.th, styles.thValor]}>Valor</Text>
          <View style={styles.thAcoes} />
        </View>
      ) : null}
    </>
  );

  if (loading && !allRows.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={filteredRows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {allRows.length === 0
              ? 'Nenhum documento ainda. Use "Gerar mensalidade" ou "Nova venda" acima.'
              : 'Nenhum resultado para os filtros atuais.'}
          </Text>
        }
      />

      <ContaReceberAcoesModal
        visible={acoesItem != null}
        item={acoesItem}
        onClose={fecharAcoes}
        onPagar={() => void iniciarPagamento()}
        onEmitirNf={() => acoesItem && solicitarEmitirNf(acoesItem)}
        onVerNota={() => {
          fecharAcoes();
          router.push('/(app)/notas-fiscais');
        }}
        onPdf={() => {
          if (acoesItem) void abrirPdf(acoesItem.id);
        }}
        onWhatsApp={() => {
          if (acoesItem) enviarWhatsApp(acoesItem);
        }}
        onVerOrigem={verOrigem}
        temNota={Boolean(acoesItem?.nota_fiscal_id)}
        nfBusy={nfBusy}
        pdfBusy={acoesItem != null && pdfId === acoesItem.id}
      />

      <MarcarPagamentoMensalidadeGeradaModal
        visible={payMensalidade != null}
        registro={payMensalidade}
        onClose={() => setPayMensalidade(null)}
        onConfirm={confirmarPagamentoMensalidade}
      />

      <ContaReceberPagarParcelaVendaModal
        visible={payVendaCtx != null}
        referenciaLabel={payVendaCtx?.referenciaLabel ?? ''}
        saldoMax={payVendaCtx?.saldoMax ?? 0}
        onClose={() => setPayVendaCtx(null)}
        onConfirm={confirmarPagamentoVenda}
      />

      <ConfirmarEmitirNfseModal
        visible={nfConfirmItem != null}
        titulo="Emitir NFS-e"
        descricao={nfConfirmItem ? descricaoConfirmNf(nfConfirmItem) : ''}
        botaoPrimario="Emitir NFS-e"
        botaoSecundario="Cancelar"
        loading={nfBusy}
        onClose={() => !nfBusy && setNfConfirmItem(null)}
        onEmitir={() => nfConfirmItem && void emitirNotaFiscal(nfConfirmItem)}
        onDepois={() => !nfBusy && setNfConfirmItem(null)}
      />

      <ConfirmarEmitirNfseModal
        visible={nfPosPagamentoMensalidade != null}
        loading={nfEmitindoPosPagamento}
        onClose={() => setNfPosPagamentoMensalidade(null)}
        onEmitir={() => void emitirNfPosPagamento()}
        onDepois={() => setNfPosPagamentoMensalidade(null)}
      />

      <Modal visible={filterOpen} animationType="slide" transparent onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Filtros</Text>
            <ScrollView
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScroll}
            >
              <Text style={styles.fLab}>Situação</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {SITUACAO_OPTS.map((o) => {
                  const on = draftSituacao === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setDraftSituacao(o.id)}
                    >
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.fLab}>Origem</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {ORIGEM_OPTS.map((o) => {
                  const on = draftOrigem === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setDraftOrigem(o.id)}
                    >
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.fLab}>Vencimento</Text>
              <Text style={styles.fHint}>Filtra pela data de vencimento do carnê (opcional).</Text>
              <DatePickerField
                label="Vencimento a partir de"
                value={draftVencDe ? new Date(draftVencDe + 'T12:00:00') : null}
                onChange={(d) => setDraftVencDe(d ? toISODate(d) : null)}
              />
              <DatePickerField
                label="Vencimento até"
                value={draftVencAte ? new Date(draftVencAte + 'T12:00:00') : null}
                onChange={(d) => setDraftVencAte(d ? toISODate(d) : null)}
                minimumDate={draftVencDe ? new Date(draftVencDe + 'T12:00:00') : undefined}
              />

              <Pressable style={styles.btnAplicar} onPress={aplicarFiltros}>
                <Text style={styles.btnAplicarTxt}>Aplicar</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.gray50 },
  toolbar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  acoesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  acaoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  acaoChipTxt: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
  linkChip: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    backgroundColor: 'rgba(13, 59, 79, 0.1)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  linkChipTxt: { color: colors.petroleum, fontWeight: '700', fontSize: 13 },
  resumoStrip: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  resumoItem: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
    alignItems: 'center',
  },
  resumoVal: { fontSize: 14, fontWeight: '800', color: colors.petroleum },
  resumoLab: { fontSize: 10, color: colors.gray600, marginTop: 2, textAlign: 'center' },
  lead: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  situacaoChips: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  sitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  sitChipOn: { borderColor: colors.orange, backgroundColor: 'rgba(232, 106, 36, 0.12)' },
  sitChipTxt: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  sitChipTxtOn: { color: colors.petroleum },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    paddingHorizontal: spacing.sm,
  },
  searchIn: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 15,
    color: colors.gray800,
  },
  filterBtn: {
    backgroundColor: colors.petroleum,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  resultCount: { fontSize: 12, color: colors.gray600 },
  clearLink: { fontSize: 12, fontWeight: '700', color: colors.orange },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.petroleum,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    marginHorizontal: spacing.md,
  },
  th: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  thCliente: { flex: 2, minWidth: 0 },
  thTipo: { width: 72, textAlign: 'center' },
  thVenc: { width: 64, textAlign: 'center' },
  thValor: { flex: 1, textAlign: 'right', paddingRight: spacing.xs },
  thIcon: { width: 22 },
  list: { paddingBottom: spacing.xl * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    marginHorizontal: spacing.md,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray100,
  },
  rowLast: {
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    borderBottomWidth: 1,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    gap: 4,
    minWidth: 0,
  },
  rowPressed: { backgroundColor: colors.gray100 },
  colAcoes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  acaoBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  acaoWa: {
    backgroundColor: '#25D366',
    borderColor: '#1da851',
  },
  acaoPagar: {
    backgroundColor: colors.orange,
    borderColor: colors.orangeDark,
  },
  acaoNf: {
    backgroundColor: colors.petroleum,
    borderColor: colors.petroleum,
  },
  acaoBtnDisabled: {
    backgroundColor: colors.gray100,
    borderColor: colors.gray200,
    opacity: 0.85,
  },
  colCliente: { flex: 2, minWidth: 0 },
  cliNome: { fontSize: 12, fontWeight: '600', color: colors.petroleum, lineHeight: 16 },
  cliAtraso: { fontSize: 10, fontWeight: '700', color: colors.danger, marginTop: 1 },
  cliWa: { fontSize: 10, color: '#1da851', marginTop: 2 },
  cliSemWa: { fontSize: 10, color: colors.gray400, marginTop: 2, fontStyle: 'italic' },
  tipoBadge: {
    width: 72,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  tipoTxt: { fontSize: 9, fontWeight: '800' },
  colVenc: { width: 64, fontSize: 11, color: colors.gray600, textAlign: 'center' },
  colValor: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.gray800, textAlign: 'right' },
  thAcoes: { width: 148 },
  empty: {
    textAlign: 'center',
    color: colors.gray600,
    padding: spacing.xl,
    fontSize: 14,
    lineHeight: 21,
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '85%',
    paddingTop: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.petroleum,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  modalScroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  fLab: { fontSize: 13, fontWeight: '700', color: colors.gray600, marginBottom: spacing.xs },
  fHint: { fontSize: 12, color: colors.gray400, marginBottom: spacing.sm, lineHeight: 17 },
  chipsRow: { gap: spacing.sm, paddingBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: 'rgba(232, 106, 36, 0.12)' },
  chipTxt: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  chipTxtOn: { color: colors.petroleum },
  btnAplicar: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnAplicarTxt: { color: colors.white, fontWeight: '800', fontSize: 16 },
});
