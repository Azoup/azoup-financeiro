import { Card } from '@/components/Card';
import { ClientForm, clienteToFormValues } from '@/components/ClientForm';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildClientDetailExport, buildClientFormExport } from '@/utils/exportReportBuilders';
import { MarcarPagamentoMensalidadeGeradaModal } from '@/components/mensalidades/MarcarPagamentoMensalidadeGeradaModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  deleteCliente,
  fetchClienteDetail,
  getClientePdfSignedUrl,
  setClienteCancelado,
  updateCliente,
} from '@/services/clientsService';
import {
  fetchMensalidadesGeradasPorCliente,
  mensalidadeGeradaStatusVisual,
  podeRegistrarPagamentoMensalidadeGerada,
  registrarPagamentoMensalidadeGerada,
} from '@/services/mensalidadeGeradaService';
import { colors, radius, spacing } from '@/theme/colors';
import type { MensalidadeGerada } from '@/types/mensalidadeGerada';
import type { ClienteFormValues, ContatoClienteInput } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, formatDateTimeBRFromISO, parseISODate } from '@/utils/date';
import { reaisParaCentavos } from '@/utils/vendasParcelas';
import { CONSULTA, goToConsulta, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  useHardwareBackToConsulta(CONSULTA.clients);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [modalJustificativaVisible, setModalJustificativaVisible] = useState(false);
  const [justificativaDraft, setJustificativaDraft] = useState('');
  const [confirmJustificativaBusy, setConfirmJustificativaBusy] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchClienteDetail>>>(null);
  const [mensalidadesGeradas, setMensalidadesGeradas] = useState<MensalidadeGerada[]>([]);
  const [registroPagamento, setRegistroPagamento] = useState<MensalidadeGerada | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !id) return;
    setLoading(true);
    try {
      const row = await fetchClienteDetail(user.id, String(id));
      setData(row);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, id]);

  useEffect(() => {
    if (!user?.id || !id || !data) return;
    let cancelled = false;
    fetchMensalidadesGeradasPorCliente(user.id, String(id))
      .then((rows) => {
        if (!cancelled) setMensalidadesGeradas(rows);
      })
      .catch(() => {
        if (!cancelled) setMensalidadesGeradas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, id, data?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const initialForm: ClienteFormValues | undefined = useMemo(() => {
    if (!data) return undefined;
    const contatos: ContatoClienteInput[] = data.contatos_cliente.map((c) => ({
      nome_contato: c.nome_contato,
      tipo_contato: c.tipo_contato,
      valor_contato: c.valor_contato,
    }));
    return clienteToFormValues(data, contatos);
  }, [data]);

  const onUpdate = async (values: ClienteFormValues) => {
    if (!user?.id || !id) return;
    try {
      await updateCliente(user.id, String(id), values);
      Toast.show({ type: 'success', text1: 'Cliente atualizado.' });
      setMode('view');
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  const openPdf = async () => {
    if (!data?.pdf_path) return;
    setPdfBusy(true);
    try {
      const url = await getClientePdfSignedUrl(data.pdf_path);
      const ok = await Linking.canOpenURL(url);
      if (ok) {
        await Linking.openURL(url);
      } else {
        Toast.show({ type: 'error', text1: 'Não foi possível abrir o PDF.' });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setPdfBusy(false);
    }
  };

  const reloadMensalidadesGeradas = useCallback(async () => {
    if (!user?.id || !id) return;
    try {
      const rows = await fetchMensalidadesGeradasPorCliente(user.id, String(id));
      setMensalidadesGeradas(rows);
    } catch {
      setMensalidadesGeradas([]);
    }
  }, [user?.id, id]);

  const onPagamentoMensalidadeGerada = async (payload: {
    data_pagamento: string;
    valor_pago: number;
    forma_pagamento: string;
    observacao: string;
  }) => {
    if (!user?.id || !registroPagamento) return;
    await registrarPagamentoMensalidadeGerada(user.id, registroPagamento.id, payload);
    setRegistroPagamento(null);
    await reloadMensalidadesGeradas();
  };

  const onToggleCancelado = async (cancelado: boolean) => {
    if (!user?.id || !id) return;
    if (cancelado) {
      setJustificativaDraft('');
      setModalJustificativaVisible(true);
      return;
    }
    setCancelBusy(true);
    try {
      await setClienteCancelado(user.id, String(id), false);
      await load();
      Toast.show({
        type: 'success',
        text1: 'Cliente reativado.',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  const onConfirmarCancelamentoComJustificativa = async () => {
    const t = justificativaDraft.trim();
    if (!t) {
      Toast.show({ type: 'error', text1: 'Informe a justificativa do cancelamento.' });
      return;
    }
    if (!user?.id || !id) return;
    setConfirmJustificativaBusy(true);
    try {
      await setClienteCancelado(user.id, String(id), true, t);
      setModalJustificativaVisible(false);
      setJustificativaDraft('');
      await load();
      Toast.show({
        type: 'success',
        text1: 'Cliente marcado como cancelado.',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setConfirmJustificativaBusy(false);
    }
  };

  const onDelete = () => {
    Alert.alert(
      'Excluir cliente',
      'Esta ação não pode ser desfeita. Deseja excluir o cliente e todos os contatos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id || !id) return;
            try {
              await deleteCliente(user.id, String(id));
              Toast.show({ type: 'success', text1: 'Cliente excluído.' });
              router.replace('/(app)/clients');
            } catch (e) {
              Toast.show({ type: 'error', text1: (e as Error).message });
            }
          },
        },
      ],
    );
  };

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.miss}>Cliente não encontrado.</Text>
        <PrimaryButton title="Voltar" variant="secondary" onPress={() => goToConsulta(CONSULTA.clients)} />
      </View>
    );
  }

  if (mode === 'edit' && initialForm) {
    return (
      <View style={[styles.screen, styles.screenFormInset]}>
        <View style={styles.actionsRow}>
          <PrimaryButton
            title="Cancelar edição"
            variant="ghost"
            onPress={() => setMode('view')}
            style={styles.flexBtn}
          />
        </View>
        {initialForm ? (
          <ExportReportButtons
            getReport={() => buildClientFormExport(initialForm, `Cliente — ${initialForm.nome_cliente}`)}
          />
        ) : null}
        <ClientForm
          key={String(id)}
          initial={initialForm}
          onSubmit={onUpdate}
          submitLabel="Salvar alterações"
        />
      </View>
    );
  }

  const d1 = parseISODate(data.data_inicio);
  const d2 = parseISODate(data.data_reajuste);
  const dUltimo = parseISODate(data.ultimo_reajuste);

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <ExportReportButtons
        disabled={!data}
        getReport={() => {
          if (!data) throw new Error('Carregue o cliente antes de exportar.');
          return buildClientDetailExport(data, mensalidadesGeradas);
        }}
      />
      <View style={styles.actionsRow}>
        <PrimaryButton title="Editar" onPress={() => setMode('edit')} style={styles.flexBtn} />
        <PrimaryButton
          title="Excluir"
          variant="danger"
          onPress={onDelete}
          style={styles.flexBtn}
        />
      </View>

      <Card style={styles.block}>
        <Text style={styles.h}>Situação</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchTextCol}>
            <Text style={styles.switchLabel}>Cliente cancelado</Text>
            <Text style={styles.switchSub}>
              Cancelados não entram na contagem nem na soma de mensalidades do painel. Você pode reativar a
              qualquer momento.
            </Text>
          </View>
          {cancelBusy ? (
            <ActivityIndicator color={colors.orange} style={styles.switchSpinner} />
          ) : (
            <Switch
              accessibilityLabel="Alternar cliente cancelado"
              value={Boolean(data.cancelado)}
              onValueChange={onToggleCancelado}
              trackColor={{ false: colors.gray200, true: 'rgba(232, 106, 36, 0.45)' }}
              thumbColor={data.cancelado ? colors.orange : colors.gray400}
            />
          )}
        </View>
        {data.cancelado ? (
          <View style={styles.justifBox}>
            <Text style={styles.justifTitle}>Motivo do cancelamento</Text>
            <Text style={styles.justifBody}>
              {data.ultima_justificativa_cancelamento?.trim()
                ? data.ultima_justificativa_cancelamento.trim()
                : '— Justificativa não registrada (cadastro anterior à exigência).'}
            </Text>
          </View>
        ) : null}
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Dados principais</Text>
        <Row label="Situação" value={data.cancelado ? 'Cancelado' : 'Ativo'} />
        <Row label="Documento" value={data.documento} />
        <Row label="CNPJ" value={data.cnpj?.trim() || '—'} />
        <Row label="Inscrição estadual" value={data.inscricao_estadual?.trim() || '—'} />
        <Row label="Cliente" value={data.nome_cliente} />
        <Row label="Empresa" value={data.nome_empresa || '—'} />
        <Row
          label="Data de criação do cadastro"
          value={formatDateTimeBRFromISO(data.created_at) || '—'}
        />
        {data.updated_at ? (
          <Row
            label="Última alteração"
            value={formatDateTimeBRFromISO(data.updated_at) || '—'}
          />
        ) : null}
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Endereço</Text>
        <Row label="CEP" value={data.cep || '—'} />
        <Row label="Logradouro" value={data.logradouro || '—'} />
        <Row label="Número" value={data.numero || '—'} />
        <Row label="Complemento" value={data.complemento || '—'} />
        <Row label="Bairro" value={data.bairro || '—'} />
        <Row label="Cidade / UF" value={formatCidadeUf(data.cidade, data.uf)} />
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Contatos</Text>
        {data.contatos_cliente.length === 0 ? (
          <Text style={styles.muted}>Nenhum contato.</Text>
        ) : (
          data.contatos_cliente.map((c) => (
            <View key={c.id} style={styles.contact}>
              <Text style={styles.contactName}>{c.nome_contato}</Text>
              <Text style={styles.contactMeta}>
                {c.tipo_contato === 'email' ? 'E-mail' : 'WhatsApp'} · {c.valor_contato}
              </Text>
              <Text style={styles.contactCreated}>
                Criado em: {formatDateTimeBRFromISO(c.created_at) || '—'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Financeiro</Text>
        <Row label="Mês de entrada" value={data.mes_entrada || '—'} />
        <Row
          label="Mensalidade antes do último reajuste"
          value={
            data.valor_mensalidade_anterior != null
              ? formatBRL(data.valor_mensalidade_anterior)
              : '—'
          }
        />
        <Row label="Mensalidade atual" value={formatBRL(data.valor_mensalidade)} />
        <Row
          label="Segmento"
          value={
            data.segmento_cliente?.nome
              ? `${data.segmento_cliente.nome} (${data.segmento_cliente_codigo ?? data.segmento_cliente.codigo})`
              : data.segmento_cliente_codigo || '—'
          }
        />
        {data.tipo_ramo ? <Row label="Ramo (legado)" value={data.tipo_ramo} /> : null}
        <Row label="Nota fiscal" value={data.emite_nf ? 'Com NF' : 'Sem NF'} />
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Mensalidades geradas</Text>
        <Text style={styles.mensalidadeLead}>
          Controle recebimentos no histórico global ou marque pagamentos por aqui.
        </Text>
        <View style={styles.mensalidadeActions}>
          <PrimaryButton
            title="Gerar mensalidade"
            onPress={() => router.push(`/(app)/mensalidades/gerar?cliente=${encodeURIComponent(String(id))}`)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            title="Histórico completo"
            variant="secondary"
            onPress={() => router.push(`/(app)/mensalidades?cliente=${id}`)}
            style={{ flex: 1 }}
          />
        </View>
        {mensalidadesGeradas.length === 0 ? (
          <Text style={styles.muted}>Nenhuma mensalidade gerada para este cliente.</Text>
        ) : (
          mensalidadesGeradas.slice(0, 8).map((m) => {
            const vis = mensalidadeGeradaStatusVisual(m);
            const pend = Math.max(0, reaisParaCentavos(m.valor) - reaisParaCentavos(m.valor_pago)) / 100;
            const showPay = podeRegistrarPagamentoMensalidadeGerada(m);
            return (
              <View key={m.id} style={styles.mensalidadeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mensalidadeComp}>
                    {m.competencia ?? '—'} · venc. {m.data_vencimento.split('-').reverse().join('/')}
                  </Text>
                  <Text style={styles.mensalidadeVals}>
                    {formatBRL(m.valor)} · pago {formatBRL(m.valor_pago)} · pend. {formatBRL(pend)}
                  </Text>
                  <Text style={styles.mensalidadeSt}>{vis}</Text>
                </View>
                {showPay ? (
                  <Pressable style={styles.btnMiniPago} onPress={() => setRegistroPagamento(m)}>
                    <Text style={styles.btnMiniPagoTxt}>Pago</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Datas</Text>
        <Row label="Primeiro vencimento" value={formatBRDate(d1) || '—'} />
        <Row label="Reajuste" value={formatBRDate(d2) || '—'} />
        <Row label="Último reajuste" value={formatBRDate(dUltimo) || '—'} />
      </Card>

      <Card style={styles.block}>
        <Text style={styles.h}>Observações</Text>
        <Text style={styles.obs}>{data.observacao?.trim() ? data.observacao : '—'}</Text>
      </Card>

      {data.pdf_path ? (
        <Card style={styles.block}>
          <Text style={styles.h}>Documento PDF</Text>
          <PrimaryButton
            title="Abrir PDF"
            variant="secondary"
            onPress={openPdf}
            loading={pdfBusy}
          />
        </Card>
      ) : null}
    </ScrollView>
    {user?.id ? (
      <MarcarPagamentoMensalidadeGeradaModal
        visible={registroPagamento != null}
        registro={registroPagamento}
        onClose={() => setRegistroPagamento(null)}
        onConfirm={onPagamentoMensalidadeGerada}
      />
    ) : null}
    <Modal
      visible={modalJustificativaVisible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!confirmJustificativaBusy) {
          setModalJustificativaVisible(false);
          setJustificativaDraft('');
        }
      }}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={() => {
          if (!confirmJustificativaBusy) {
            setModalJustificativaVisible(false);
            setJustificativaDraft('');
          }
        }}
      >
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Cancelar cliente</Text>
          <Text style={styles.modalHint}>
            Informe o motivo. O texto será salvo e exibido na ficha deste cliente.
          </Text>
          <TextInput
            value={justificativaDraft}
            onChangeText={setJustificativaDraft}
            multiline
            placeholder="Ex.: encerrou contrato, inadimplência, pedido do cliente…"
            placeholderTextColor={colors.gray400}
            style={styles.modalInput}
            editable={!confirmJustificativaBusy}
          />
          <View style={styles.modalActions}>
            <PrimaryButton
              title="Voltar"
              variant="ghost"
              disabled={confirmJustificativaBusy}
              onPress={() => {
                setModalJustificativaVisible(false);
                setJustificativaDraft('');
              }}
              style={styles.modalBtn}
            />
            <PrimaryButton
              title="Confirmar"
              loading={confirmJustificativaBusy}
              onPress={onConfirmarCancelamentoComJustificativa}
              style={styles.modalBtn}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

function formatCidadeUf(cidade: string | null, uf: string | null): string {
  const c = cidade?.trim();
  const u = uf?.trim();
  if (c && u) return `${c} / ${u}`;
  if (c) return c;
  if (u) return u;
  return '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  screenFormInset: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.gray50,
  },
  miss: {
    fontSize: 16,
    color: colors.gray600,
    marginBottom: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  flexBtn: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchTextCol: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.petroleum,
  },
  switchSub: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 18,
  },
  switchSpinner: {
    marginRight: spacing.sm,
  },
  justifBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(232, 106, 36, 0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(232, 106, 36, 0.25)',
  },
  justifTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  justifBody: {
    fontSize: 15,
    color: colors.gray800,
    lineHeight: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  modalHint: {
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 16,
    color: colors.gray800,
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalBtn: {
    flex: 1,
  },
  block: {
    marginBottom: spacing.md,
  },
  h: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  row: {
    marginBottom: spacing.sm,
  },
  rowLabel: {
    fontSize: 12,
    color: colors.gray600,
    fontWeight: '600',
  },
  rowValue: {
    fontSize: 16,
    color: colors.gray800,
    marginTop: 2,
  },
  contact: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray100,
  },
  contactName: {
    fontWeight: '600',
    color: colors.petroleum,
  },
  contactMeta: {
    marginTop: 2,
    color: colors.gray600,
    fontSize: 14,
  },
  contactCreated: {
    marginTop: 4,
    fontSize: 12,
    color: colors.gray400,
  },
  muted: {
    color: colors.gray400,
  },
  obs: {
    fontSize: 15,
    color: colors.gray800,
    lineHeight: 22,
  },
  mensalidadeLead: {
    fontSize: 13,
    color: colors.gray600,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  mensalidadeActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  mensalidadeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray100,
    gap: spacing.sm,
  },
  mensalidadeComp: { fontSize: 13, fontWeight: '600', color: colors.petroleum },
  mensalidadeVals: { fontSize: 12, color: colors.gray600, marginTop: 4 },
  mensalidadeSt: { fontSize: 11, fontWeight: '700', color: colors.orange, marginTop: 4, textTransform: 'capitalize' },
  btnMiniPago: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  btnMiniPagoTxt: { color: colors.white, fontWeight: '800', fontSize: 13 },
});
