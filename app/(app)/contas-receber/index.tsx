import { DatePickerField } from '@/components/DatePickerField';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  fetchBoletoParcelaById,
  fetchContasReceberLista,
  sincronizarCarnesMensalidadesFaltantes,
  sincronizarCarnesVendasFaltantes,
} from '@/services/boletoParcelaService';
import { sincronizarBoletosPendentes } from '@/services/sicoobBoletoService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
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

  const renderItem = ({ item, index }: { item: ContaReceberListRow; index: number }) => {
    const pdfBusy = pdfId === item.id;
    const stOrig = origemStyle(item.origem);
    const venc = formatBRDate(parseISODate(item.data_vencimento)) || item.data_vencimento;
    const isLast = index === filteredRows.length - 1;
    const atrasado =
      item.situacao_cobranca === 'aberto' && item.parcela_status === 'atrasado';
    const temWhats = Boolean(item.whatsapp?.trim());

    return (
      <View style={[styles.row, isLast && styles.rowLast]}>
        <Pressable
          style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
          onPress={() => void abrirPdf(item.id)}
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
            onPress={() => void abrirPdf(item.id)}
            disabled={pdfBusy}
            accessibilityLabel="Abrir PDF do carnê"
          >
            {pdfBusy ? (
              <ActivityIndicator size="small" color={colors.petroleum} />
            ) : (
              <Ionicons name="document-text-outline" size={18} color={colors.petroleum} />
            )}
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
        Botão verde abre o WhatsApp na conversa do número cadastrado do cliente, com a mensagem de cobrança pronta. Toque
        na linha abre o PDF.
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
  thAcoes: { width: 76 },
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
