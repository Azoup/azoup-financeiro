import { Card } from '@/components/Card';
import { DatePickerField } from '@/components/DatePickerField';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { PrimaryButton } from '@/components/PrimaryButton';
import { buildNovaVendaExport } from '@/utils/exportReportBuilders';
import { ClienteVendaPicker } from '@/components/vendas/ClienteVendaPicker';
import { useAuth } from '@/context/AuthContext';
import { fetchFormasPagamentoAtivas } from '@/services/formasPagamentoService';
import { createVendaWithParcelas, type ClienteVendaOption } from '@/services/vendasService';
import { colors, radius, spacing } from '@/theme/colors';
import type { FormaPagamento } from '@/types/vendas';
import { formatBRL, parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';
import {
  gerarPreviewParcelas,
  rebalancearGrupo,
  centavosParaReais,
  type ParcelaPreview,
} from '@/utils/vendasParcelas';
import { CONSULTA, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import MaskInput, { Masks } from 'react-native-mask-input';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

type Grupo = {
  key: string;
  formaId: string;
  valorGrupoMask: string;
  qtd: string;
  intervalo: string;
  dataPrimeira: Date;
};

function newGrupo(formaId: string, valorMask: string): Grupo {
  return {
    key: Math.random().toString(36).slice(2),
    formaId,
    valorGrupoMask: valorMask,
    qtd: '1',
    intervalo: '30',
    dataPrimeira: new Date(),
  };
}

function newDescItemKey(): string {
  return Math.random().toString(36).slice(2);
}

function buildPreviews(totalCent: number, grupos: Grupo[]): ParcelaPreview[] | null {
  let num = 1;
  let gi = 0;
  const all: ParcelaPreview[] = [];
  let sumGrupos = 0;
  for (const g of grupos) {
    const vg = parseBRLMasked(g.valorGrupoMask) ?? 0;
    const gc = Math.round(vg * 100);
    sumGrupos += gc;
    if (gc <= 0) {
      gi++;
      continue;
    }
    const qtd = Math.max(1, parseInt(g.qtd, 10) || 1);
    const intervalo = Math.max(0, parseInt(g.intervalo, 10) || 0);
    const chunk = gerarPreviewParcelas({
      grupoIndex: gi,
      numeroInicialGlobal: num,
      valorGrupoCentavos: gc,
      qtdParcelas: qtd,
      intervaloDias: intervalo,
      dataPrimeira: g.dataPrimeira,
      formaPagamentoId: g.formaId,
    });
    all.push(...chunk);
    num += chunk.length;
    gi++;
  }
  if (sumGrupos !== totalCent) return null;
  return all;
}

export default function NovaVendaScreen() {
  const { user } = useAuth();
  const router = useRouter();
  useHardwareBackToConsulta(CONSULTA.vendas);
  const [cliente, setCliente] = useState<ClienteVendaOption | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [descItens, setDescItens] = useState<{ key: string; value: string }[]>([
    { key: newDescItemKey(), value: '' },
  ]);
  const [valorTotalMask, setValorTotalMask] = useState('');
  const [formas, setFormas] = useState<FormaPagamento[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaPreview[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMask, setEditMask] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchFormasPagamentoAtivas().then(setFormas);
  }, []);

  const totalNum = parseBRLMasked(valorTotalMask) ?? 0;
  const totalCent = Math.round(totalNum * 100);

  useEffect(() => {
    setGrupos((prev) => {
      if (prev.length !== 1) return prev;
      const g0 = prev[0];
      if (g0.valorGrupoMask === valorTotalMask) return prev;
      return [{ ...g0, valorGrupoMask: valorTotalMask }];
    });
  }, [valorTotalMask, grupos.length]);

  const syncParcelas = useCallback(() => {
    if (!totalCent || grupos.length === 0) {
      setParcelas([]);
      return;
    }
    const built = buildPreviews(totalCent, grupos);
    if (!built) {
      setParcelas([]);
      return;
    }
    setParcelas(built);
  }, [totalCent, grupos]);

  useEffect(() => {
    syncParcelas();
  }, [syncParcelas]);

  const addGrupo = () => {
    const first = formas[0]?.id ?? '';
    if (!first) {
      Toast.show({ type: 'error', text1: 'Formas de pagamento indisponíveis.' });
      return;
    }
    setGrupos((prev) => {
      if (prev.length === 0) {
        return [newGrupo(first, valorTotalMask || '')];
      }
      return [...prev, newGrupo(first, '')];
    });
  };

  const removeGrupo = (key: string) => {
    setGrupos((prev) => prev.filter((g) => g.key !== key));
  };

  const updateGrupo = (key: string, patch: Partial<Grupo>) => {
    setGrupos((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  };

  const formaNome = (id: string) => formas.find((f) => f.id === id)?.nome ?? '—';

  const addDescItem = () => {
    setDescItens((prev) => [...prev, { key: newDescItemKey(), value: '' }]);
  };

  const removeDescItem = (key: string) => {
    setDescItens((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((x) => x.key !== key);
    });
  };

  const setDescItemValue = (key: string, value: string) => {
    setDescItens((prev) => prev.map((x) => (x.key === key ? { ...x, value } : x)));
  };

  const linhasDescricao = useMemo(
    () => descItens.map((x) => x.value.trim()).filter(Boolean),
    [descItens],
  );

  const somaOk = useMemo(() => {
    if (!grupos.length || !totalCent) return false;
    let s = 0;
    for (const g of grupos) {
      const v = parseBRLMasked(g.valorGrupoMask) ?? 0;
      s += Math.round(v * 100);
    }
    return s === totalCent;
  }, [grupos, totalCent]);

  const openEdit = (p: ParcelaPreview) => {
    setEditingId(p.tempId);
    setEditMask('');
  };

  const applyEdit = () => {
    if (!editingId) return;
    const v = parseBRLMasked(editMask) ?? 0;
    const c = Math.round(v * 100);
    if (c <= 0) {
      setEditingId(null);
      return;
    }
    setParcelas((prev) => rebalancearGrupo(prev, editingId, c));
    setEditingId(null);
    setEditMask('');
  };

  const onSave = async () => {
    if (!user?.id) return;
    if (!cliente) {
      Toast.show({ type: 'error', text1: 'Selecione um cliente.' });
      return;
    }
    if (linhasDescricao.length === 0) {
      Toast.show({ type: 'error', text1: 'Informe a descrição da venda.' });
      return;
    }
    if (!somaOk || !parcelas.length) {
      Toast.show({
        type: 'error',
        text1: 'Ajuste os valores dos grupos para somar ao total e gerar parcelas.',
      });
      return;
    }
    const sorted = [...parcelas].sort((a, b) => a.numeroGlobal - b.numeroGlobal);
    const input = {
      cliente_id: cliente.id,
      descricao_itens: descItens.map((x) => x.value),
      valor_total: totalNum,
      parcelas: sorted.map((p, idx) => ({
        grupo_index: p.grupoIndex,
        numero_parcela: idx + 1,
        valor: Math.round(p.valorCentavos) / 100,
        data_vencimento: toISODate(p.vencimento),
        forma_pagamento_id: p.formaPagamentoId,
      })),
    };
    setSaving(true);
    try {
      const result = await createVendaWithParcelas(user.id, input);
      if (result.avisoBoleto) {
        Toast.show({
          type: 'info',
          text1: 'Venda registrada.',
          text2: result.avisoBoleto,
        });
      } else {
        Toast.show({ type: 'success', text1: 'Venda registrada.' });
      }
      router.replace(`/(app)/vendas/${result.id}`);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <ExportReportButtons
          getReport={() => {
            const formaNome = (id: string) => formas.find((f) => f.id === id)?.nome ?? '—';
            return buildNovaVendaExport({
              cliente: cliente?.nome_cliente ?? '—',
              descricao: descItens.map((d) => d.value.trim()).filter(Boolean).join(' · '),
              valorTotal: valorTotalMask || formatBRL(0),
              parcelas: parcelas.map((p) => ({
                numero: p.numeroGlobal,
                vencimento: toISODate(p.vencimento).split('-').reverse().join('/'),
                valor: formatBRL(centavosParaReais(p.valorCentavos)),
                forma: formaNome(p.formaPagamentoId),
              })),
            });
          }}
        />
        <Card>
          <Text style={styles.section}>Cliente</Text>
          <Pressable style={styles.selectBtn} onPress={() => setPickerOpen(true)}>
            <Ionicons name="person-outline" size={22} color={colors.orange} />
            <View style={{ flex: 1 }}>
              {cliente ? (
                <>
                  <Text style={styles.selectMain}>{cliente.nome_cliente}</Text>
                  {cliente.nome_empresa ? (
                    <Text style={styles.selectSub}>{cliente.nome_empresa}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.placeholder}>Toque para buscar cliente</Text>
              )}
            </View>
            <Ionicons name="chevron-down" size={20} color={colors.gray400} />
          </Pressable>
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <Text style={[styles.section, styles.sectionInline]}>Descrição</Text>
            <Pressable style={styles.addChipSmall} onPress={addDescItem}>
              <Ionicons name="add" size={16} color={colors.white} />
              <Text style={styles.addChipTxt}>Item</Text>
            </Pressable>
          </View>
          <Text style={styles.descHint}>
            Um item: descrição simples. Vários itens: cada bloco vira um item; use excluir para remover (só com mais
            de um).
          </Text>
          {descItens.map((item, idx) => (
            <View key={item.key} style={styles.descItemCard}>
              <View style={styles.descItemHead}>
                <Text style={styles.descItemTitle}>Item {idx + 1}</Text>
                {descItens.length > 1 ? (
                  <Pressable onPress={() => removeDescItem(item.key)} hitSlop={8} style={styles.descTrash}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={styles.descInput}
                placeholder="Descrição deste item…"
                placeholderTextColor={colors.gray400}
                value={item.value}
                onChangeText={(t) => setDescItemValue(item.key, t)}
                multiline
              />
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.section}>Valor total</Text>
          <MaskInput
            style={styles.mask}
            value={valorTotalMask}
            onChangeText={setValorTotalMask}
            mask={Masks.BRL_CURRENCY}
            keyboardType="numeric"
            placeholder="R$ 0,00"
            placeholderTextColor={colors.gray400}
          />
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.section}>Formas de pagamento</Text>
            <Pressable style={styles.addChip} onPress={addGrupo}>
              <Ionicons name="add" size={18} color={colors.white} />
              <Text style={styles.addChipTxt}>Adicionar</Text>
            </Pressable>
          </View>
          {!somaOk && grupos.length > 0 && totalCent > 0 ? (
            <Text style={styles.warn}>
              A soma dos valores alocados por forma deve ser igual ao valor total.
            </Text>
          ) : null}
          {grupos.map((g) => (
            <View key={g.key} style={styles.grupo}>
              <View style={styles.rowBetween}>
                <Text style={styles.grupoTitle}>Grupo</Text>
                <Pressable onPress={() => removeGrupo(g.key)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
              <Text style={styles.label}>Forma</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                {formas.map((f) => {
                  const on = f.id === g.formaId;
                  return (
                    <Pressable
                      key={f.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => updateGrupo(g.key, { formaId: f.id })}
                    >
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{f.nome}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {grupos.length > 1 ? (
                <>
                  <Text style={styles.label}>Valor desta forma</Text>
                  <MaskInput
                    style={styles.mask}
                    value={g.valorGrupoMask}
                    onChangeText={(m) => updateGrupo(g.key, { valorGrupoMask: m })}
                    mask={Masks.BRL_CURRENCY}
                    keyboardType="numeric"
                    placeholder="R$ 0,00"
                    placeholderTextColor={colors.gray400}
                  />
                </>
              ) : (
                <Text style={styles.hint}>Valor do grupo = valor total da venda.</Text>
              )}
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Parcelas</Text>
                  <TextInput
                    style={styles.input}
                    value={g.qtd}
                    onChangeText={(t) => updateGrupo(g.key, { qtd: t.replace(/\D/g, '') })}
                    keyboardType="number-pad"
                    placeholder="1"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Intervalo (dias)</Text>
                  <TextInput
                    style={styles.input}
                    value={g.intervalo}
                    onChangeText={(t) => updateGrupo(g.key, { intervalo: t.replace(/\D/g, '') })}
                    keyboardType="number-pad"
                    placeholder="30"
                  />
                </View>
              </View>
              <DatePickerField
                label="Primeira parcela"
                value={g.dataPrimeira}
                onChange={(d) => d && updateGrupo(g.key, { dataPrimeira: d })}
              />
            </View>
          ))}
        </Card>

        {parcelas.length > 0 ? (
          <Card>
            <Text style={styles.section}>Parcelas ({parcelas.length})</Text>
            <Text style={styles.subHint}>
              Toque em editar para ajustar o valor de uma parcela; as demais do mesmo grupo
              recalculam automaticamente.
            </Text>
            {[...parcelas]
              .sort((a, b) => a.numeroGlobal - b.numeroGlobal)
              .map((p) => (
                <View key={p.tempId} style={styles.parcCard}>
                  <View style={styles.parcHead}>
                    <Text style={styles.parcNum}>#{p.numeroGlobal}</Text>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: colors.gray100 },
                      ]}
                    >
                      <Text style={styles.badgeTxt}>{formaNome(p.formaPagamentoId)}</Text>
                    </View>
                  </View>
                  <Text style={styles.parcVal}>{formatBRL(centavosParaReais(p.valorCentavos))}</Text>
                  <Text style={styles.parcVen}>
                    Venc. {toISODate(p.vencimento).split('-').reverse().join('/')}
                  </Text>
                  {editingId === p.tempId ? (
                    <View style={styles.editBox}>
                      <MaskInput
                        style={styles.mask}
                        value={editMask}
                        onChangeText={setEditMask}
                        mask={Masks.BRL_CURRENCY}
                        keyboardType="numeric"
                        placeholder="Novo valor"
                        placeholderTextColor={colors.gray400}
                      />
                      <View style={styles.editActions}>
                        <PrimaryButton title="Cancelar" variant="ghost" onPress={() => setEditingId(null)} style={{ flex: 1 }} />
                        <PrimaryButton title="Aplicar" onPress={applyEdit} style={{ flex: 1 }} />
                      </View>
                    </View>
                  ) : (
                    <Pressable style={styles.editLink} onPress={() => openEdit(p)}>
                      <Ionicons name="pencil" size={16} color={colors.orange} />
                      <Text style={styles.editLinkTxt}>Editar valor</Text>
                    </Pressable>
                  )}
                </View>
              ))}
          </Card>
        ) : null}

        <PrimaryButton title="Salvar venda" loading={saving} disabled={saving} onPress={onSave} />
      </ScrollView>

      {user?.id ? (
        <ClienteVendaPicker
          visible={pickerOpen}
          userId={user.id}
          onClose={() => setPickerOpen(false)}
          onSelect={setCliente}
          selectedId={cliente?.id}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
    backgroundColor: colors.gray50,
  },
  section: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
  },
  sectionInline: {
    marginBottom: 0,
    flex: 1,
    minWidth: 0,
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  selectMain: { fontSize: 16, fontWeight: '600', color: colors.petroleum },
  selectSub: { fontSize: 14, color: colors.gray600, marginTop: 2 },
  placeholder: { fontSize: 16, color: colors.gray400 },
  addChipSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  descHint: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  descItemCard: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.gray50,
  },
  descItemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  descItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
  },
  descTrash: {
    padding: spacing.xs,
  },
  descInput: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 72,
    textAlignVertical: 'top',
    fontSize: 16,
    color: colors.petroleum,
    backgroundColor: colors.white,
  },
  mask: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.petroleum,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  addChipTxt: { color: colors.white, fontWeight: '700', fontSize: 13 },
  warn: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  grupo: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.gray50,
  },
  grupoTitle: { fontWeight: '600', color: colors.gray800 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  chips: { flexGrow: 0, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  chipOn: { backgroundColor: colors.petroleum, borderColor: colors.petroleum },
  chipTxt: { fontSize: 13, color: colors.gray800 },
  chipTxtOn: { color: colors.white, fontWeight: '600' },
  hint: { fontSize: 13, color: colors.gray600, marginTop: spacing.xs },
  row2: { flexDirection: 'row', gap: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.petroleum,
  },
  subHint: { fontSize: 12, color: colors.gray600, marginBottom: spacing.md },
  parcCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray100,
    marginBottom: spacing.sm,
  },
  parcHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  parcNum: { fontSize: 16, fontWeight: '800', color: colors.petroleum },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  badgeTxt: { fontSize: 11, fontWeight: '600', color: colors.gray800 },
  parcVal: { fontSize: 20, fontWeight: '700', color: colors.orange, marginTop: spacing.xs },
  parcVen: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  editLinkTxt: { color: colors.orange, fontWeight: '600', fontSize: 14 },
  editBox: { marginTop: spacing.sm },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
