import { DatePickerField } from '@/components/DatePickerField';
import type { ParcelaVenda } from '@/types/vendas';
import { colors, radius, spacing } from '@/theme/colors';
import { formatBRL, parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';
import { parcelaStatusVisual } from '@/services/vendasService';
import MaskInput, { Masks } from 'react-native-mask-input';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Toast from 'react-native-toast-message';

type Props = {
  visible: boolean;
  onClose: () => void;
  parcelas: ParcelaVenda[];
  onSubmit: (payload: {
    data_pagamento: string;
    valor_pago: number;
    observacao: string;
    alocacao_manual?: { parcela_id: string; valor: number }[];
  }) => Promise<void>;
};

export function BaixaPagamentoModal({ visible, onClose, parcelas, onSubmit }: Props) {
  const abertas = useMemo(
    () =>
      parcelas.filter(
        (p) =>
          p.status !== 'cancelado' &&
          reaisParaCentavos(p.valor_pago) < reaisParaCentavos(p.valor),
      ),
    [parcelas],
  );

  const [dataPag, setDataPag] = useState<Date | null>(() => new Date());
  const [valorMask, setValorMask] = useState('');
  const [obs, setObs] = useState('');
  const [manual, setManual] = useState(false);
  const [manualMap, setManualMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setDataPag(new Date());
    setValorMask('');
    setObs('');
    setManual(false);
    setManualMap({});
  }, []);

  const saldoAbertoCent = useMemo(
    () =>
      abertas.reduce(
        (s, p) => s + (reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago)),
        0,
      ),
    [abertas],
  );

  const handleSubmit = async () => {
    const valor = parseBRLMasked(valorMask) ?? 0;
    if (valor <= 0) return;
    const valorCent = reaisParaCentavos(valor);
    let alocacao_manual: { parcela_id: string; valor: number }[] | undefined;
    if (manual) {
      const rows: { parcela_id: string; valor: number }[] = [];
      let sum = 0;
      for (const p of abertas) {
        const m = manualMap[p.id];
        if (!m) continue;
        const v = parseBRLMasked(m) ?? 0;
        const c = reaisParaCentavos(v);
        if (c <= 0) continue;
        const maxOpen = reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago);
        if (c > maxOpen) return;
        rows.push({ parcela_id: p.id, valor: v });
        sum += c;
      }
      if (sum !== valorCent) return;
      alocacao_manual = rows;
    }
    setLoading(true);
    try {
      await onSubmit({
        data_pagamento: toISODate(dataPag ?? new Date()),
        valor_pago: valor,
        observacao: obs,
        alocacao_manual,
      });
      reset();
      onClose();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const valorOk = (parseBRLMasked(valorMask) ?? 0) > 0;
  let manualOk = true;
  if (manual) {
    let sum = 0;
    for (const p of abertas) {
      const v = parseBRLMasked(manualMap[p.id] ?? '') ?? 0;
      sum += reaisParaCentavos(v);
      const maxOpen = reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago);
      if (reaisParaCentavos(v) > maxOpen) manualOk = false;
    }
    manualOk =
      manualOk &&
      sum === reaisParaCentavos(parseBRLMasked(valorMask) ?? 0) &&
      sum > 0;
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Dar baixa</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.gray600} />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Saldo em aberto: {formatBRL(centavosParaReais(saldoAbertoCent))}
          </Text>

          <DatePickerField label="Data do pagamento" value={dataPag} onChange={setDataPag} />

          <Text style={styles.label}>Valor pago</Text>
          <MaskInput
            style={styles.input}
            value={valorMask}
            onChangeText={(m) => setValorMask(m)}
            mask={Masks.BRL_CURRENCY}
            keyboardType="numeric"
            placeholder="R$ 0,00"
          />

          <View style={styles.rowSwitch}>
            <Text style={styles.label}>Alocação manual nas parcelas</Text>
            <Switch value={manual} onValueChange={setManual} trackColor={{ true: colors.orangeLight }} />
          </View>

          {manual ? (
            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="always">
              {abertas.map((p) => {
                const vis = parcelaStatusVisual(p);
                const rest = centavosParaReais(
                  reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago),
                );
                return (
                  <View key={p.id} style={styles.manRow}>
                    <Text style={styles.manLabel}>
                      #{p.numero_parcela} · máx {formatBRL(rest)} · {vis}
                    </Text>
                    <MaskInput
                      style={styles.inputSm}
                      value={manualMap[p.id] ?? ''}
                      onChangeText={(m) => setManualMap((prev) => ({ ...prev, [p.id]: m }))}
                      mask={Masks.BRL_CURRENCY}
                      keyboardType="numeric"
                      placeholder="R$ 0,00"
                    />
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          <Text style={styles.label}>Observação</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={obs}
            onChangeText={setObs}
            placeholder="Opcional"
            placeholderTextColor={colors.gray400}
            multiline
          />

          <Pressable
            style={[styles.primary, (!valorOk || !manualOk || loading) && styles.primaryDisabled]}
            disabled={!valorOk || !manualOk || loading}
            onPress={handleSubmit}
          >
            <Text style={styles.primaryTxt}>{loading ? 'Salvando…' : 'Confirmar baixa'}</Text>
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
  title: { fontSize: 20, fontWeight: '700', color: colors.petroleum },
  hint: { color: colors.gray600, marginTop: spacing.sm, marginBottom: spacing.md },
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
    minWidth: 140,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  rowSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  manRow: { marginBottom: spacing.md },
  manLabel: { fontSize: 12, color: colors.gray600 },
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
