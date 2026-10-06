import { DatePickerField } from '@/components/DatePickerField';
import { AlterarVencimentoBoletoModal } from '@/components/contas-receber/AlterarVencimentoBoletoModal';
import { ContaReceberAcoesModal } from '@/components/contas-receber/ContaReceberAcoesModal';
import { ContaReceberPagarParcelaVendaModal } from '@/components/contas-receber/ContaReceberPagarParcelaVendaModal';
import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { MarcarPagamentoMensalidadeGeradaModal } from '@/components/mensalidades/MarcarPagamentoMensalidadeGeradaModal';
import { useAuth } from '@/context/AuthContext';
import { useEmpresaFiltro } from '@/context/EmpresaFiltroContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  fetchBoletoParcelaById,
  fetchContasReceberPagina,
} from '@/services/boletoParcelaService';
import { alterarVencimentoBoleto } from '@/services/cancelarBoletoBancoService';
import { reemitirBoletosC6 } from '@/services/c6BoletoService';
import { pickEmitenteC6 } from '@/services/c6ConfigService';
import { reemitirBoletosSicoob, sincronizarBoletosPendentes } from '@/services/sicoobBoletoService';
import { ensureEmitentes } from '@/services/nfseEmitenteService';
import {
  fetchMensalidadeGeradaById,
  cancelarMensalidadeGerada,
  reativarMensalidadeGerada,
  registrarPagamentoMensalidadeGerada,
} from '@/services/mensalidadeGeradaService';
import {
  fetchNotaFiscalById,
  fetchNotaFiscalPorMensalidade,
  gerarNotaFiscalParaMensalidade,
  gerarNotaFiscalParaVenda,
} from '@/services/notaFiscalService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import { fetchSegmentosCliente } from '@/services/segmentoClienteService';
import {
  cancelarParcelaVenda,
  reativarParcelaVenda,
  fetchParcelaVendaById,
  fetchVendaParaNotaFiscal,
  registrarPagamentoVenda,
} from '@/services/vendasService';
import type { MensalidadeGerada } from '@/types/mensalidadeGerada';
import type { SegmentoClienteRow } from '@/types/models';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';
import { colors, radius, spacing } from '@/theme/colors';
import type { ContaReceberListRow, ContaReceberOrigem } from '@/types/contasReceber';
import { confirmDestructive } from '@/utils/confirmDialog';
import type { ContaReceberSituacao } from '@/utils/contaReceberCobranca';
import { buildContasReceberExport } from '@/utils/exportReportBuilders';
import { abrirDocumentoBoleto } from '@/utils/openBoletoDocumento';
import { compartilharBoletoComFeedback } from '@/utils/compartilharBoletoEmail';
import { compartilharDanfseComFeedback } from '@/utils/danfseDocumento';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import { CONSULTA, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import {
  compartilharBoletoWhatsAppComFeedback,
  formatWhatsAppDisplay,
} from '@/utils/whatsappCobranca';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Toast from 'react-native-toast-message';

type OrigemFiltro = 'todos' | ContaReceberOrigem;
type SituacaoFiltro = 'todos' | ContaReceberSituacao;
type BancoFiltro = 'todos' | 'sicoob' | 'c6';

const BANCO_OPTS: { id: BancoFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'sicoob', label: 'Sicoob' },
  { id: 'c6', label: 'C6' },
];

const ORIGEM_OPTS: { id: OrigemFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'venda', label: 'Venda' },
  { id: 'mensalidade', label: 'Mensalidade' },
];

const SITUACAO_OPTS: { id: SituacaoFiltro; label: string }[] = [
  { id: 'aberto', label: 'Em aberto' },
  { id: 'pago', label: 'Pagos' },
  { id: 'cancelado', label: 'Cancelados' },
  { id: 'todos', label: 'Todos' },
];

function origemLabel(origem: ContaReceberOrigem): string {
  return origem === 'mensalidade' ? 'Mensalidade' : 'Venda';
}

function origemStyle(origem: ContaReceberOrigem): { bg: string; fg: string } {
  return origem === 'mensalidade'
    ? { bg: '#fff3e0', fg: colors.orangeDark }
    : { bg: '#e3f2fd', fg: colors.petroleum };
}

function boletoRegistroLabel(
  status?: ContaReceberListRow['status_registro'],
  tipo?: ContaReceberListRow['tipo_emissao'],
): string {
  const banco = tipo === 'c6' ? 'C6' : tipo === 'sicoob' ? 'Sicoob' : null;
  switch (status ?? 'informativo') {
    case 'registrado':
      return banco ?? 'Registrado';
    case 'pendente':
      return 'Registrando…';
    case 'erro':
      return banco ? `Erro ${banco}` : 'Erro registro';
    case 'pago':
      return banco ? `Pago (${banco})` : 'Pago';
    case 'baixado':
      return 'Baixado';
    default:
      return 'Informativo';
  }
}

export default function ContasReceberScreen() {
  const { user } = useAuth();
  const { emitenteInicial, empresaId } = useEmpresaFiltro();
  const router = useRouter();
  useHardwareBackToConsulta(CONSULTA.contasReceber);

  const [allRows, setAllRows] = useState<ContaReceberListRow[]>([]);
  const [pagina, setPagina] = useState(1);
  const [totalDocumentos, setTotalDocumentos] = useState(0);
  const pedidoLista = useRef(0);
  const syncPagamentos = useRef(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [vencimentoDe, setVencimentoDe] = useState<string | null>(null);
  const [vencimentoAte, setVencimentoAte] = useState<string | null>(null);
  const [pagamentoDe, setPagamentoDe] = useState<string | null>(null);
  const [pagamentoAte, setPagamentoAte] = useState<string | null>(null);
  const [totalRecebido, setTotalRecebido] = useState(0);
  const [origemFilter, setOrigemFilter] = useState<OrigemFiltro>('todos');
  const [situacaoFilter, setSituacaoFilter] = useState<SituacaoFiltro>('aberto');
  const [segmentoFilter, setSegmentoFilter] = useState<string>('todos');
  const [bancoFilter, setBancoFilter] = useState<BancoFiltro>('todos');
  const [segmentos, setSegmentos] = useState<SegmentoClienteRow[]>([]);
  const [soRegistrando, setSoRegistrando] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftOrigem, setDraftOrigem] = useState<OrigemFiltro>('todos');
  const [draftSituacao, setDraftSituacao] = useState<SituacaoFiltro>('aberto');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);
  const [whatsBusyId, setWhatsBusyId] = useState<string | null>(null);
  const [emailNotaBusyId, setEmailNotaBusyId] = useState<string | null>(null);
  const [c6BusyId, setC6BusyId] = useState<string | null>(null);
  const [sicoobBusyId, setSicoobBusyId] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [reativarBusyId, setReativarBusyId] = useState<string | null>(null);
  const [nomeBeneficiario, setNomeBeneficiario] = useState<string | null>(null);
  const [acoesItem, setAcoesItem] = useState<ContaReceberListRow | null>(null);
  const [vencimentoItem, setVencimentoItem] = useState<ContaReceberListRow | null>(null);
  const [novaDataVenc, setNovaDataVenc] = useState<string | null>(null);
  const [vencBusy, setVencBusy] = useState(false);
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
  const [nfConfirmCompetencia, setNfConfirmCompetencia] = useState<string | null>(null);
  const [nfConfirmDisc, setNfConfirmDisc] = useState<string | undefined>(undefined);

  const carregar = useCallback(async (opts?: { silencioso?: boolean }) => {
    if (!user?.id) return;
    const silencioso = opts?.silencioso === true;
    const pedido = silencioso ? pedidoLista.current : ++pedidoLista.current;
    if (!silencioso) setLoading(true);
    try {
      const [lista, perfil] = await Promise.all([
        fetchContasReceberPagina(user.id, {
          page: pagina,
          search: debouncedSearch,
          origem: origemFilter,
          situacao: situacaoFilter,
          vencimentoDe,
          vencimentoAte,
          pagamentoDe,
          pagamentoAte,
          segmentoCodigo: segmentoFilter === 'todos' ? null : segmentoFilter,
          banco: bancoFilter,
          emitenteId: empresaId === 'todos' ? null : empresaId,
          statusRegistro: soRegistrando ? 'pendente' : undefined,
        }),
        fetchPerfilCobranca(user.id).catch(() => null),
      ]);
      if (pedido !== pedidoLista.current) return;
      setAllRows(lista.rows);
      setTotalDocumentos(lista.total);
      setTotalRecebido(lista.totalRecebido ?? 0);
      const ultima = Math.max(1, Math.ceil(lista.total / lista.pageSize) || 1);
      if (pagina > ultima) setPagina(ultima);
      setNomeBeneficiario(perfil?.razao_social?.trim() || null);
    } catch (e) {
      if (pedido !== pedidoLista.current || silencioso) return;
      Toast.show({ type: 'error', text1: (e as Error).message });
      setAllRows([]);
      setTotalDocumentos(0);
      setTotalRecebido(0);
    } finally {
      if (!silencioso && pedido === pedidoLista.current) setLoading(false);
    }
  }, [
    user?.id,
    pagina,
    debouncedSearch,
    origemFilter,
    situacaoFilter,
    vencimentoDe,
    vencimentoAte,
    pagamentoDe,
    pagamentoAte,
    segmentoFilter,
    bancoFilter,
    empresaId,
    soRegistrando,
  ]);

  useEffect(() => {
    setPagina(1);
  }, [debouncedSearch, origemFilter, situacaoFilter, segmentoFilter, bancoFilter, vencimentoDe, vencimentoAte, pagamentoDe, pagamentoAte, empresaId, soRegistrando]);

  useEffect(() => {
    void fetchSegmentosCliente().then(setSegmentos);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || syncPagamentos.current) return undefined;
      syncPagamentos.current = true;
      let ativo = true;
      void (async () => {
        let pagos = 0;
        try {
          for (let i = 0; i < 20 && ativo; i += 1) {
            const r = await sincronizarBoletosPendentes();
            pagos += r.baixados;
            const erros = (r.resultados ?? []).filter((item) => item.erro);
            if (i === 0 && erros.length > 0 && erros.length === (r.resultados ?? []).length) {
              Toast.show({
                type: 'error',
                text1: 'Não consegui consultar o pagamento no banco',
                text2: String(erros[0]?.erro ?? ''),
                visibilityTime: 9000,
              });
            }
            if (r.baixados > 0 && ativo) void carregar({ silencioso: true });
            if (!r.temMais) break;
          }
        } catch {
          /* a lista segue; a consulta diária continua no servidor */
        } finally {
          syncPagamentos.current = false;
        }
        if (ativo && pagos > 0) {
          Toast.show({
            type: 'success',
            text1: pagos === 1 ? '1 boleto pago foi atualizado.' : `${pagos} boletos pagos foram atualizados.`,
          });
          void carregar({ silencioso: true });
        }
      })();
      return () => {
        ativo = false;
      };
    }, [user?.id, carregar]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await carregar();
    } finally {
      setRefreshing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const list = [...allRows];
    list.sort((a, b) => {
      const nome = String(a.nome_cliente ?? '').localeCompare(String(b.nome_cliente ?? ''), 'pt-BR', {
        sensitivity: 'base',
      });
      if (nome !== 0) return nome;
      if (a.data_vencimento !== b.data_vencimento) return a.data_vencimento < b.data_vencimento ? -1 : 1;
      return Number(a.valor_documento) - Number(b.valor_documento);
    });
    return list;
  }, [allRows]);

  const totalPaginas = Math.max(1, Math.ceil(totalDocumentos / 40));

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

  const temFiltroAtivo =
    Boolean(search.trim()) ||
    origemFilter !== 'todos' ||
    situacaoFilter !== 'aberto' ||
    Boolean(vencimentoDe) ||
    Boolean(vencimentoAte) ||
    Boolean(pagamentoDe) ||
    Boolean(pagamentoAte) ||
    segmentoFilter !== 'todos' ||
    bancoFilter !== 'todos' ||
    soRegistrando;

  const abrirFiltros = () => {
    setDraftOrigem(origemFilter);
    setDraftSituacao(situacaoFilter);
    setFilterOpen(true);
  };

  const aplicarFiltros = () => {
    setOrigemFilter(draftOrigem);
    setSituacaoFilter(draftSituacao);
    setFilterOpen(false);
  };

  const limparFiltros = () => {
    setSearch('');
    setVencimentoDe(null);
    setVencimentoAte(null);
    setPagamentoDe(null);
    setPagamentoAte(null);
    setSegmentoFilter('todos');
    setBancoFilter('todos');
    setOrigemFilter('todos');
    setSituacaoFilter('aberto');
    setSoRegistrando(false);
    setDraftOrigem('todos');
    setDraftSituacao('aberto');
  };

  const enviarWhatsApp = async (item: ContaReceberListRow) => {
    setWhatsBusyId(item.id);
    try {
      await compartilharBoletoWhatsAppComFeedback(item, {
        nomeBeneficiario: nomeBeneficiario ?? undefined,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setWhatsBusyId(null);
    }
  };

  const enviarEmail = async (item: ContaReceberListRow) => {
    setEmailBusyId(item.id);
    try {
      await compartilharBoletoComFeedback(item);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setEmailBusyId(null);
    }
  };

  const enviarEmailNota = async (item: ContaReceberListRow) => {
    if (!user?.id || !item.nota_fiscal_id) return;
    setEmailNotaBusyId(item.id);
    try {
      const nota = await fetchNotaFiscalById(user.id, item.nota_fiscal_id);
      if (!nota) throw new Error('NFS-e não encontrada.');
      await compartilharDanfseComFeedback(nota);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setEmailNotaBusyId(null);
    }
  };

  const oferecerCompartilharNotaEmitida = (notaId: string) => {
    if (!user?.id) return;
    Alert.alert(
      'NFS-e emitida',
      'Deseja enviar a NFS-e por e-mail ao cliente?',
      [
        {
          text: 'Depois',
          style: 'cancel',
          onPress: () => router.push('/(app)/notas-fiscais'),
        },
        {
          text: 'Enviar',
          onPress: () => {
            void (async () => {
              try {
                const nota = await fetchNotaFiscalById(user.id, notaId);
                if (nota) await compartilharDanfseComFeedback(nota);
              } catch (e) {
                Toast.show({ type: 'error', text1: (e as Error).message });
              }
              router.push('/(app)/notas-fiscais');
            })();
          },
        },
      ],
    );
  };

  const refreshLista = useCallback(async () => {
    await carregar();
  }, [carregar]);

  const abrirAcoes = (item: ContaReceberListRow) => {
    setAcoesItem(item);
  };

  const fecharAcoes = () => {
    setAcoesItem(null);
  };

  const abrirAlterarVencimento = () => {
    if (!acoesItem) return;
    setVencimentoItem(acoesItem);
    setNovaDataVenc(acoesItem.data_vencimento.slice(0, 10));
    setAcoesItem(null);
  };

  const salvarNovoVencimento = async () => {
    if (!vencimentoItem || !novaDataVenc) return;
    if (novaDataVenc === vencimentoItem.data_vencimento.slice(0, 10)) {
      Toast.show({ type: 'info', text1: 'Esta já é a data de vencimento.' });
      return;
    }
    setVencBusy(true);
    try {
      const result = await alterarVencimentoBoleto(vencimentoItem.id, novaDataVenc);
      setVencimentoItem(null);
      await refreshLista();
      Toast.show({
        type: 'success',
        text1: 'Vencimento alterado',
        text2: result.message,
        visibilityTime: 8000,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Não alterou o vencimento',
        text2: (e as Error).message,
        visibilityTime: 9000,
      });
    } finally {
      setVencBusy(false);
    }
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
      await abrirDocumentoBoleto(row);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setPdfId(null);
    }
  };

  const registrarNoC6 = async (boletoId: string) => {
    if (!user?.id) return;
    setC6BusyId(boletoId);
    try {
      const row = await fetchBoletoParcelaById(user.id, boletoId);
      if (!row) throw new Error('Boleto não encontrado.');
      const list = await ensureEmitentes(user.id);
      const emitente =
        (row.emitente_id ? list.find((e) => e.id === row.emitente_id) : null) ??
        pickEmitenteC6(list);
      if (!emitente?.id) {
        throw new Error('Cadastre o CNPJ 05.320.214/0001-69 (C6) em Configurações › NFS-e.');
      }
      const lote = await reemitirBoletosC6(user.id, emitente.id, [boletoId]);
      await refreshLista();
      const { resumoEmailBoletosLote } = await import('@/utils/resumoEmailBoleto');
      const emailMsg = resumoEmailBoletosLote(lote);
      Toast.show({
        type: 'success',
        text1: 'Boleto real registrado no C6.',
        text2: emailMsg || undefined,
        visibilityTime: emailMsg ? 8000 : 4000,
      });
      const updated = await fetchBoletoParcelaById(user.id, boletoId);
      if (updated) await abrirDocumentoBoleto(updated);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setC6BusyId(null);
    }
  };

  const registrarNoSicoob = async (boletoId: string) => {
    if (!user?.id) return;
    setSicoobBusyId(boletoId);
    try {
      const lote = await reemitirBoletosSicoob(user.id, [boletoId]);
      await refreshLista();
      const { resumoEmailBoletosLote } = await import('@/utils/resumoEmailBoleto');
      const emailMsg = resumoEmailBoletosLote(lote);
      Toast.show({
        type: 'success',
        text1: 'Boleto registrado no Sicoob.',
        text2: emailMsg || undefined,
        visibilityTime: emailMsg ? 8000 : 4000,
      });
      const updated = await fetchBoletoParcelaById(user.id, boletoId);
      if (updated) await abrirDocumentoBoleto(updated);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSicoobBusyId(null);
    }
  };

  const cancelarBoleto = async (itemOverride?: ContaReceberListRow) => {
    const item = itemOverride ?? acoesItem;
    if (!user?.id || !item || item.situacao_cobranca !== 'aberto') return;
    const ok = await confirmDestructive(
      'Cancelar boleto',
      item.origem === 'mensalidade'
        ? 'O mês ficará cancelado (não pago) e o boleto será baixado/cancelado no banco se estiver registrado. Continuar?'
        : 'A parcela ficará cancelada e o boleto será baixado/cancelado no banco se estiver registrado. Continuar?',
    );
    if (!ok) return;
    fecharAcoes();
    setCancelBusyId(item.id);
    try {
      if (item.origem === 'mensalidade' && item.mensalidade_id) {
        await cancelarMensalidadeGerada(user.id, item.mensalidade_id);
      } else if (item.origem === 'venda' && item.parcela_id) {
        await cancelarParcelaVenda(user.id, item.parcela_id);
      } else {
        throw new Error('Não foi possível identificar a cobrança para cancelar.');
      }
      await refreshLista();
      Toast.show({ type: 'success', text1: 'Boleto cancelado no sistema e no banco (quando aplicável).' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setCancelBusyId(null);
    }
  };

  const reativarBoleto = async (itemOverride?: ContaReceberListRow) => {
    const item = itemOverride ?? acoesItem;
    if (!user?.id || !item || item.situacao_cobranca !== 'cancelado') return;
    const ok = await confirmDestructive(
      'Reativar cobrança',
      'A cobrança volta para em aberto no sistema. O boleto no banco não é alterado por esta ação.',
    );
    if (!ok) return;
    fecharAcoes();
    setReativarBusyId(item.id);
    try {
      if (item.origem === 'mensalidade' && item.mensalidade_id) {
        await reativarMensalidadeGerada(user.id, item.mensalidade_id);
      } else if (item.origem === 'venda' && item.parcela_id) {
        await reativarParcelaVenda(user.id, item.parcela_id);
      } else {
        throw new Error('Não foi possível identificar a cobrança para reativar.');
      }
      await refreshLista();
      Toast.show({ type: 'success', text1: 'Cobrança reativada (em aberto).' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setReativarBusyId(null);
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

  const solicitarEmitirNf = async (item: ContaReceberListRow) => {
    if (item.nota_fiscal_id) {
      router.push('/(app)/notas-fiscais');
      return;
    }
    fecharAcoes();
    let competencia: string | null = null;
    let disc: string | undefined;
    if (user?.id && item.origem === 'mensalidade' && item.mensalidade_id) {
      const m = await fetchMensalidadeGeradaById(user.id, item.mensalidade_id).catch(() => null);
      competencia = m?.competencia ?? null;
    } else if (user?.id && item.origem === 'venda' && item.venda_id) {
      const venda = await fetchVendaParaNotaFiscal(user.id, item.venda_id).catch(() => null);
      disc = venda?.descricao || undefined;
    }
    setNfConfirmCompetencia(competencia);
    setNfConfirmDisc(disc);
    setNfConfirmItem(item);
  };

  const descricaoConfirmNf = (item: ContaReceberListRow): string => {
    const valor = formatBRL(item.valor_documento);
    if (item.origem === 'mensalidade') {
      return `Gerar NFS-e de ${valor} para ${item.referencia_label}?`;
    }
    return `Gerar NFS-e de ${valor} para esta venda (${item.referencia_label})?`;
  };

  const emitirNotaFiscal = async (
    itemOverride?: ContaReceberListRow,
    emitenteId?: string,
    discriminacao?: string,
  ) => {
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
      const opts = { emitenteId: emitenteId || undefined, descricaoServico: discriminacao };
      if (item.origem === 'mensalidade' && item.mensalidade_id) {
        const m = await fetchMensalidadeGeradaById(user.id, item.mensalidade_id);
        if (!m) throw new Error('Mensalidade não encontrada.');
        const res = await gerarNotaFiscalParaMensalidade(
          user.id,
          {
            id: m.id,
            cliente_id: m.cliente_id,
            valor: m.valor,
            competencia: m.competencia,
          },
          opts,
        );
        if (res.success) {
          fecharAcoes();
          setNfConfirmItem(null);
          await refreshLista();
          if (res.notaId) {
            oferecerCompartilharNotaEmitida(res.notaId);
          } else {
            Toast.show({ type: 'success', text1: res.message ?? 'NFS-e emitida com sucesso.' });
            router.push('/(app)/notas-fiscais');
          }
        } else if (res.ignorada) {
          Toast.show({ type: 'info', text1: res.message ?? 'Cliente marcado como Sem NF no cadastro.' });
        } else {
          Toast.show({ type: 'error', text1: res.message ?? 'Não foi possível emitir a NFS-e.' });
          if (res.notaId) router.push('/(app)/notas-fiscais');
        }
      } else if (item.origem === 'venda' && item.venda_id) {
        const venda = await fetchVendaParaNotaFiscal(user.id, item.venda_id);
        if (!venda) throw new Error('Venda não encontrada.');
        const res = await gerarNotaFiscalParaVenda(user.id, venda, opts);
        if (res.success) {
          fecharAcoes();
          setNfConfirmItem(null);
          await refreshLista();
          if (res.notaId) {
            oferecerCompartilharNotaEmitida(res.notaId);
          } else {
            Toast.show({ type: 'success', text1: 'NFS-e emitida com sucesso.' });
            router.push('/(app)/notas-fiscais');
          }
        } else {
          Toast.show({ type: 'error', text1: res.message ?? 'NFS-e rejeitada.' });
          if (res.notaId) router.push('/(app)/notas-fiscais');
        }
      } else {
        throw new Error('Origem do documento não identificada.');
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setNfBusy(false);
      setNfBusyId(null);
    }
  };

  const emitirNfPosPagamento = async (emitenteId?: string, discriminacao?: string) => {
    if (!user?.id || !nfPosPagamentoMensalidade) return;
    setNfEmitindoPosPagamento(true);
    try {
      const m = nfPosPagamentoMensalidade;
      const res = await gerarNotaFiscalParaMensalidade(
        user.id,
        {
          id: m.id,
          cliente_id: m.cliente_id,
          valor: m.valor,
          competencia: m.competencia,
        },
        { emitenteId: emitenteId || undefined, descricaoServico: discriminacao },
      );
      if (res.success) {
        if (res.notaId) {
          oferecerCompartilharNotaEmitida(res.notaId);
        } else {
          Toast.show({ type: 'success', text1: res.message ?? 'NFS-e emitida com sucesso.' });
          router.push('/(app)/notas-fiscais');
        }
      } else if (res.ignorada) {
        Toast.show({ type: 'info', text1: res.message ?? 'Cliente sem NF no cadastro.' });
      } else {
        Toast.show({ type: 'error', text1: res.message ?? 'Não foi possível emitir a NFS-e.' });
        if (res.notaId) router.push('/(app)/notas-fiscais');
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
    const pagoEm = item.data_pagamento
      ? formatBRDate(parseISODate(item.data_pagamento)) || item.data_pagamento
      : '—';
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
            {item.nosso_numero_banco ? (
              <Text style={styles.cliNn} numberOfLines={1}>
                Nosso nº {item.nosso_numero_banco}
              </Text>
            ) : null}
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
              {boletoRegistroLabel(item.status_registro ?? 'informativo', item.tipo_emissao)}
            </Text>
          </View>
          <Text style={styles.colSeg} numberOfLines={2}>
            {item.segmento_nome || '—'}
          </Text>
          <Text style={styles.colVenc}>{venc}</Text>
          <Text style={styles.colPago}>{pagoEm}</Text>
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
            style={[styles.acaoBtn, styles.acaoWa, (!temWhats || whatsBusyId === item.id) && styles.acaoBtnDisabled]}
            onPress={() => void enviarWhatsApp(item)}
            disabled={!temWhats || pdfBusy || whatsBusyId === item.id}
            accessibilityLabel="Enviar cobrança por WhatsApp"
          >
            {whatsBusyId === item.id ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="logo-whatsapp" size={18} color={temWhats ? colors.white : colors.gray400} />
            )}
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
          <Text style={styles.resumoLab}>Em aberto nesta página</Text>
        </View>
        <View style={styles.resumoItem}>
          <Text style={styles.resumoVal}>{formatBRL(resumo.valorAberto)}</Text>
          <Text style={styles.resumoLab}>A cobrar nesta página</Text>
        </View>
        <View style={styles.resumoItem}>
          <Text style={styles.resumoVal}>{resumo.pago}</Text>
          <Text style={styles.resumoLab}>Pagos nesta página</Text>
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
        <Pressable
          style={[styles.sitChip, soRegistrando && styles.sitChipOn]}
          onPress={() => setSoRegistrando((v) => !v)}
        >
          <Text style={[styles.sitChipTxt, soRegistrando && styles.sitChipTxtOn]}>Registrando</Text>
        </Pressable>
      </ScrollView>

      <Text style={styles.segLabel}>Banco</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.situacaoChips}>
        {BANCO_OPTS.map((o) => {
          const on = bancoFilter === o.id;
          return (
            <Pressable
              key={o.id}
              style={[styles.sitChip, on && styles.sitChipOn]}
              onPress={() => setBancoFilter(o.id)}
            >
              <Text style={[styles.sitChipTxt, on && styles.sitChipTxtOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.segLabel}>Segmento</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.situacaoChips}>
        <Pressable
          style={[styles.sitChip, segmentoFilter === 'todos' && styles.sitChipOn]}
          onPress={() => setSegmentoFilter('todos')}
        >
          <Text style={[styles.sitChipTxt, segmentoFilter === 'todos' && styles.sitChipTxtOn]}>Todos</Text>
        </Pressable>
        {segmentos.map((s) => {
          const on = segmentoFilter === s.codigo;
          return (
            <Pressable
              key={s.codigo}
              style={[styles.sitChip, on && styles.sitChipOn]}
              onPress={() => setSegmentoFilter(s.codigo)}
            >
              <Text style={[styles.sitChipTxt, on && styles.sitChipTxtOn]}>{s.nome}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.datasFiltro}>
        <Text style={styles.dataGrupo}>Vencimento</Text>
        <View style={styles.dataLinha}>
          <View style={styles.datasCol}>
            <DatePickerField
              compact
              label="De"
              value={vencimentoDe ? new Date(`${vencimentoDe}T12:00:00`) : null}
              onChange={(d) => setVencimentoDe(d ? toISODate(d) : null)}
            />
          </View>
          <View style={styles.datasCol}>
            <DatePickerField
              compact
              label="Até"
              value={vencimentoAte ? new Date(`${vencimentoAte}T12:00:00`) : null}
              onChange={(d) => setVencimentoAte(d ? toISODate(d) : null)}
              minimumDate={vencimentoDe ? new Date(`${vencimentoDe}T12:00:00`) : undefined}
            />
          </View>
        </View>
        <Text style={styles.dataGrupo}>Pagamento</Text>
        <View style={styles.dataLinha}>
          <View style={styles.datasCol}>
            <DatePickerField
              compact
              label="De"
              value={pagamentoDe ? new Date(`${pagamentoDe}T12:00:00`) : null}
              onChange={(d) => setPagamentoDe(d ? toISODate(d) : null)}
            />
          </View>
          <View style={styles.datasCol}>
            <DatePickerField
              compact
              label="Até"
              value={pagamentoAte ? new Date(`${pagamentoAte}T12:00:00`) : null}
              onChange={(d) => setPagamentoAte(d ? toISODate(d) : null)}
              minimumDate={pagamentoDe ? new Date(`${pagamentoDe}T12:00:00`) : undefined}
            />
          </View>
        </View>
      </View>
      <View style={styles.recebidoCard}>
        <Text style={styles.recebidoLab}>Recebido no filtro</Text>
        <Text style={styles.recebidoVal}>{formatBRL(totalRecebido)}</Text>
      </View>

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
          {loading
            ? 'Carregando…'
            : `Página ${pagina} de ${totalPaginas} · ${totalDocumentos} documento(s)`}
        </Text>
        <View style={styles.pagerBtns}>
          <Pressable disabled={pagina <= 1 || loading} onPress={() => setPagina((p) => Math.max(1, p - 1))}>
            <Text style={[styles.pagerTxt, pagina <= 1 && styles.pagerTxtOff]}>Anterior</Text>
          </Pressable>
          <Pressable
            disabled={pagina >= totalPaginas || loading}
            onPress={() => setPagina((p) => p + 1)}
          >
            <Text style={[styles.pagerTxt, pagina >= totalPaginas && styles.pagerTxtOff]}>Próxima</Text>
          </Pressable>
        </View>
        {temFiltroAtivo ? (
          <Pressable onPress={limparFiltros}>
            <Text style={styles.clearLink}>Limpar filtros</Text>
          </Pressable>
        ) : null}
      </View>

      {filteredRows.length > 0 ? (
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.thCliente]}>Cliente</Text>
          <Text style={[styles.th, styles.thSeg]}>Segmento</Text>
          <Text style={[styles.th, styles.thTipo]}>Tipo</Text>
          <Text style={[styles.th, styles.thVenc]}>Venc.</Text>
          <Text style={[styles.th, styles.thPago]}>Pago em</Text>
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
            {soRegistrando && allRows.length === 0
              ? 'Nenhum boleto com status Registrando.'
              : temFiltroAtivo
                ? 'Nenhum resultado para os filtros atuais.'
                : 'Nenhum documento ainda. Use "Gerar mensalidade" ou "Nova venda" acima.'}
          </Text>
        }
      />

      <ContaReceberAcoesModal
        visible={acoesItem != null}
        item={acoesItem}
        onClose={fecharAcoes}
        onPagar={() => void iniciarPagamento()}
        onAlterarVencimento={abrirAlterarVencimento}
        onCancelar={() => void cancelarBoleto()}
        onReativar={() => void reativarBoleto()}
        onEmitirNf={() => acoesItem && solicitarEmitirNf(acoesItem)}
        onVerNota={() => {
          fecharAcoes();
          router.push('/(app)/notas-fiscais');
        }}
        onPdf={() => {
          if (acoesItem) void abrirPdf(acoesItem.id);
        }}
        onRegistrarC6={() => {
          if (acoesItem) void registrarNoC6(acoesItem.id);
        }}
        onRegistrarSicoob={() => {
          if (acoesItem) void registrarNoSicoob(acoesItem.id);
        }}
        onWhatsApp={() => {
          if (acoesItem) void enviarWhatsApp(acoesItem);
        }}
        onEmail={() => {
          if (acoesItem) void enviarEmail(acoesItem);
        }}
        onEmailNota={() => {
          if (acoesItem) void enviarEmailNota(acoesItem);
        }}
        onVerOrigem={verOrigem}
        temNota={Boolean(acoesItem?.nota_fiscal_id)}
        nfBusy={nfBusy}
        pdfBusy={acoesItem != null && pdfId === acoesItem.id}
        c6Busy={acoesItem != null && c6BusyId === acoesItem.id}
        sicoobBusy={acoesItem != null && sicoobBusyId === acoesItem.id}
        emailBusy={acoesItem != null && emailBusyId === acoesItem.id}
        emailNotaBusy={acoesItem != null && emailNotaBusyId === acoesItem.id}
        whatsBusy={acoesItem != null && whatsBusyId === acoesItem.id}
        cancelBusy={acoesItem != null && cancelBusyId === acoesItem.id}
        reativarBusy={acoesItem != null && reativarBusyId === acoesItem.id}
      />

      <AlterarVencimentoBoletoModal
        item={vencimentoItem}
        dataIso={novaDataVenc}
        onChangeData={setNovaDataVenc}
        busy={vencBusy}
        onClose={() => {
          if (!vencBusy) setVencimentoItem(null);
        }}
        onConfirm={() => void salvarNovoVencimento()}
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
        onEmitir={(emitenteId, discriminacao) =>
          nfConfirmItem && void emitirNotaFiscal(nfConfirmItem, emitenteId, discriminacao)
        }
        onDepois={() => !nfBusy && setNfConfirmItem(null)}
        competencia={nfConfirmCompetencia}
        discriminacaoInicial={nfConfirmDisc}
        emitenteIdInicial={emitenteInicial()}
      />

      <ConfirmarEmitirNfseModal
        visible={nfPosPagamentoMensalidade != null}
        loading={nfEmitindoPosPagamento}
        onClose={() => setNfPosPagamentoMensalidade(null)}
        onEmitir={(emitenteId, discriminacao) => void emitirNfPosPagamento(emitenteId, discriminacao)}
        onDepois={() => setNfPosPagamentoMensalidade(null)}
        competencia={nfPosPagamentoMensalidade?.competencia}
        emitenteIdInicial={emitenteInicial(nfPosPagamentoMensalidade?.cliente_emitente_nf_id)}
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
    gap: 8,
  },
  pagerBtns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pagerTxt: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
  pagerTxtOff: { color: colors.gray400 },
  resultCount: { flex: 1, fontSize: 12, color: colors.gray600 },
  cliNn: { fontSize: 11, color: colors.gray600, marginTop: 2 },
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
  thSeg: { width: 88 },
  segLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray600,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
  },
  thTipo: { width: 72, textAlign: 'center' },
  thVenc: { width: 64, textAlign: 'center' },
  thPago: { width: 72, textAlign: 'center' },
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
  colSeg: { width: 88, fontSize: 11, color: colors.gray600 },
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
  datasFiltro: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    gap: 2,
  },
  dataGrupo: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
    marginTop: spacing.xs,
  },
  dataLinha: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  datasCol: { flex: 1, minWidth: 0 },
  recebidoCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#e8f5e9',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recebidoLab: { fontSize: 13, fontWeight: '700', color: '#1b5e20' },
  recebidoVal: { fontSize: 16, fontWeight: '800', color: '#1b5e20' },
  colVenc: { width: 64, fontSize: 11, color: colors.gray600, textAlign: 'center' },
  colPago: { width: 72, fontSize: 11, color: colors.gray600, textAlign: 'center' },
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
