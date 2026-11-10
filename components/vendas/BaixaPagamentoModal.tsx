import { DatePickerField } from '@/components/DatePickerField';
import type { ParcelaVenda } from '@/types/vendas';
import { colors, radius, spacing } from '@/theme/colors';
import { formatBRL, parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';
import { parcelaStatusVisual } from '@/services/vendasService';
import MaskInput, { Masks } from 'react-native-mask-input';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Toast from 'react-native-toast-message';

type Props = {
  visible: boolean;
  onClose: () => void;
  parcelas: ParcelaVenda[];
  parcelaFocoId?: string | null;
  onSubmit: (payload: {
    data_pagamento: string;
    valor_pago: number;
    observacao: string;
    banco_recebimento: 'sicoob' | 'c6';
    alocacao_manual?: { parcela_id: string; valor: number }[];
  }) => Promise<void>;
};

function saldoParcelaCent(p: ParcelaVenda): number {
  return Math.max(
    0,
    reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago) - reaisParaCentavos(p.desconto ?? 0),
  );
}

export function BaixaPagamentoModal({
  visible,
  onClose,
  parcelas,
  parcelaFocoId,
  onSubmit,
}: Props) {
  const abertas = useMemo(
    () =>
      parcelas.filter(
        (p) => p.status !== 'cancelado' && saldoParcelaCent(p) > 0,
      ),
    [parcelas],
  );

  const [dataPag, setDataPag] = useState<Date | null>(() => new Date());
  const [obs, setObs] = useState('');
  const [bancoRecebimento, setBancoRecebimento] = useState<'sicoob' | 'c6'>('sicoob');
  const [manualMap, setManualMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setDataPag(new Date());
    setObs('');
    setBancoRecebimento('sicoob');
    setManualMap({});
  }, []);

  useEffect(() => {
    if (!visible) return;
    setDataPag(new Date());
    setObs('');
    setBancoRecebimento('sicoob');
    if (parcelaFocoId) {
      const p = abertas.find((x) => x.id === parcelaFocoId);
      if (p) {
        setManualMap({ [p.id]: formatBRL(centavosParaReais(saldoParcelaCent(p))) });
        return;
      }
    }
    setManualMap({});
  }, [visible, parcelaFocoId, abertas]);

  const alocRows = useMemo(() => {
    const rows: { parcela_id: string; valor: number; centavos: number }[] = [];
    for (const p of abertas) {
      const v = parseBRLMasked(manualMap[p.id] ?? '') ?? 0;
      const c = reaisParaCentavos(v);
      if (c <= 0) continue;
      rows.push({ parcela_id: p.id, valor: v, centavos: c });
    }
    return rows;
  }, [abertas, manualMap]);

  const somaCent = alocRows.reduce((s, r) => s + r.centavos, 0);
  const saldoAbertoCent = abertas.reduce((s, p) => s + saldoParcelaCent(p), 0);
  const estouro = abertas.some((p) => {
    const c = reaisParaCentavos(parseBRLMasked(manualMap[p.id] ?? '') ?? 0);
    return c > saldoParcelaCent(p);
  });
  const valorOk = somaCent > 0 && !estouro && somaCent <= saldoAbertoCent;

  const setParcelaMask = (id: string, mask: string) => {
    setManualMap((prev) => ({ ...prev, [id]: mask }));
  };

  const usarSaldo = (p: ParcelaVenda) => {
    setParcelaMask(p.id, formatBRL(centavosParaReais(saldoParcelaCent(p))));
  };

  const handleSubmit = async () => {
    if (!valorOk) return;
    const bancoEscolhido: 'sicoob' | 'c6' = bancoRecebimento === 'c6' ? 'c6' : 'sicoob';
    setLoading(true);
    try {
      await onSubmit({
        data_pagamento: toISODate(dataPag ?? new Date()),
        valor_pago: centavosParaReais(somaCent),
        observacao: obs,
        banco_recebimento: bancoEscolhido,
        alocacao_manual: alocRows.map((r) => ({ parcela_id: r.parcela_id, valor: r.valor })),
      });
      reset();
      onClose();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const titulo = parcelaFocoId
    ? `Dar baixa · parcela ${abertas.find((p) => p.id === parcelaFocoId)?.numero_parcela ?? ''}`
    : 'Dar baixa';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{titulo}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.gray600} />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Saldo em aberto: {formatBRL(centavosParaReais(saldoAbertoCent))}
          </Text>
          <Text style={styles.total}>
            Desta baixa: {formatBRL(centavosParaReais(somaCent))}
          </Text>

          <DatePickerField label="Data do pagamento" value={dataPag} onChange={setDataPag} />

          <Text style={styles.label}>Banco do recebimento</Text>
          <Text style={styles.bancoHint}>
            Informe onde entrou o PIX/transferência (mesmo sem boleto gerado).
          </Text>
          <View style={styles.bancoRow}>
            {(
              [
                { id: 'sicoob' as const, label: 'Sicoob' },
                { id: 'c6' as const, label: 'C6 Bank' },
              ] as const
            ).map((opt) => {
              const on = bancoRecebimento === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.bancoOpt, on && styles.bancoOptOn]}
                  onPress={() => setBancoRecebimento(opt.id)}
                >
                  <Text style={[styles.bancoOptTxt, on && styles.bancoOptTxtOn]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Valor em cada parcela</Text>
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="always">
            {abertas.map((p) => {
              const vis = parcelaStatusVisual(p);
              const rest = centavosParaReais(saldoParcelaCent(p));
              const foco = p.id === parcelaFocoId;
              return (
                <View key={p.id} style={[styles.manRow, foco && styles.manRowFoco]}>
                  <View style={styles.manHead}>
                    <Text style={styles.manLabel}>
                      Parcela {p.numero_parcela} · em aberto {formatBRL(rest)} · {vis}
                    </Text>
                    <Pressable onPress={() => usarSaldo(p)} hitSlop={8}>
                      <Text style={styles.usarSaldo}>Usar saldo</Text>
                    </Pressable>
                  </View>
                  <MaskInput
                    style={styles.inputSm}
                    value={manualMap[p.id] ?? ''}
                    onChangeText={(m) => setParcelaMask(p.id, m)}
                    mask={Masks.BRL_CURRENCY}
                    keyboardType="numeric"
                    placeholder="R$ 0,00"
                  />
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Observação</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={obs}
            onChangeText={setObs}
            placeholder="Opcional"
            placeholderTextColor={colors.gray400}
            multiline
          />

          <Text style={styles.bancoConfirm}>
            Recebimento em: {bancoRecebimento === 'c6' ? 'C6 Bank' : 'Sicoob'}
          </Text>
          <Pressable
            style={[styles.primary, (!valorOk || loading) && styles.primaryDisabled]}
            disabled={!valorOk || loading}
            onPress={() => void handleSubmit()}
          >
            <Text style={styles.primaryTxt}>
              {loading
                ? 'Salvando…'
                : `Confirmar baixa · ${bancoRecebimento === 'c6' ? 'C6' : 'Sicoob'}`}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.5)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    maxHeight: '90%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.petroleum, flex: 1, paddingRight: spacing.sm },
  hint: { color: colors.gray600, marginTop: spacing.sm },
  total: {
    color: colors.petroleum,
    fontWeight: '800',
    fontSize: 16,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.gray600, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.petroleum,
    marginTop: spacing.xs,
  },
  inputSm: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: 15,
    color: colors.petroleum,
    marginTop: 4,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  manRow: {
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
  },
  manRowFoco: {
    borderWidth: 1,
    borderColor: colors.orange,
  },
  manHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  manLabel: { fontSize: 12, color: colors.gray600, flex: 1 },
  usarSaldo: { fontSize: 12, fontWeight: '700', color: colors.orange },
  bancoHint: { fontSize: 12, color: colors.gray600, marginTop: 2, marginBottom: spacing.xs },
  bancoRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.xs },
  bancoOpt: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  bancoOptOn: {
    borderColor: colors.petroleum,
    backgroundColor: colors.white,
  },
  bancoOptTxt: { fontSize: 14, fontWeight: '700', color: colors.gray700 },
  bancoOptTxtOn: { color: colors.petroleum },
  bancoConfirm: {
    marginTop: spacing.md,
    fontSize: 13,
    fontWeight: '700',
    color: colors.orange,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryTxt: { color: colors.white, fontWeight: '700', fontSize: 16 },
});
