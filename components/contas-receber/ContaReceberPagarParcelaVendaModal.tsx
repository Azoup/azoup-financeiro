import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { fetchFormasPagamentoAtivas } from '@/services/formasPagamentoService';
import type { FormaPagamento } from '@/types/vendas';
import { colors, radius, spacing } from '@/theme/colors';
import { formatBRL, parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';
import { reaisParaCentavos } from '@/utils/vendasParcelas';
import { Ionicons } from '@expo/vector-icons';
import MaskInput, { Masks } from 'react-native-mask-input';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Toast from 'react-native-toast-message';

type Props = {
  visible: boolean;
  referenciaLabel: string;
  saldoMax: number;
  onClose: () => void;
  onConfirm: (payload: {
    data_pagamento: string;
    valor_pago: number;
    observacao: string;
  }) => Promise<void>;
};

export function ContaReceberPagarParcelaVendaModal({
  visible,
  referenciaLabel,
  saldoMax,
  onClose,
  onConfirm,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [dataPag, setDataPag] = useState<Date | null>(() => new Date());
  const [valorMask, setValorMask] = useState('');
  const [obs, setObs] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setDataPag(new Date());
    setValorMask('');
    setObs('');
  }, []);

  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  const valorNum = parseBRLMasked(valorMask) ?? 0;
  const valorOk = valorNum > 0 && reaisParaCentavos(valorNum) <= reaisParaCentavos(saldoMax);

  const avançar = () => {
    if (!valorOk) {
      Toast.show({ type: 'error', text1: 'Informe um valor válido dentro do saldo em aberto.' });
      return;
    }
    setStep(2);
  };

  const enviar = async () => {
    if (!dataPag) return;
    setLoading(true);
    try {
      await onConfirm({
        data_pagamento: toISODate(dataPag),
        valor_pago: valorNum,
        observacao: obs,
      });
      Toast.show({ type: 'success', text1: 'Pagamento registrado.' });
      reset();
      onClose();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Ionicons name="cash-outline" size={28} color={colors.orange} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Marcar como pago</Text>
              <Text style={styles.sub}>{referenciaLabel}</Text>
              <Text style={styles.sub}>Saldo em aberto: {formatBRL(saldoMax)}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.gray600} />
            </Pressable>
          </View>

          {step === 1 ? (
            <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
              <DatePickerField label="Data do pagamento" value={dataPag} onChange={setDataPag} />
              <Text style={styles.label}>Valor pago</Text>
              <MaskInput
                style={styles.input}
                value={valorMask}
                onChangeText={setValorMask}
                mask={Masks.BRL_CURRENCY}
                keyboardType="numeric"
                placeholder={formatBRL(saldoMax)}
                placeholderTextColor={colors.gray400}
              />
              <Text style={styles.label}>Observação (opcional)</Text>
              <TextInput
                style={[styles.input, styles.area]}
                value={obs}
                onChangeText={setObs}
                placeholder="Notas internas"
                placeholderTextColor={colors.gray400}
                multiline
              />
              <PrimaryButton title="Revisar e confirmar" onPress={avançar} disabled={!valorOk} />
            </ScrollView>
          ) : (
            <View>
              <Text style={styles.revTitle}>Confirme os dados</Text>
              <View style={styles.revRow}>
                <Text style={styles.revLab}>Valor</Text>
                <Text style={styles.revVal}>{formatBRL(valorNum)}</Text>
              </View>
              <View style={styles.revRow}>
                <Text style={styles.revLab}>Data</Text>
                <Text style={styles.revVal}>
                  {dataPag ? toISODate(dataPag).split('-').reverse().join('/') : '—'}
                </Text>
              </View>
              {obs.trim() ? (
                <View style={styles.revRow}>
                  <Text style={styles.revLab}>Obs.</Text>
                  <Text style={styles.revVal}>{obs}</Text>
                </View>
              ) : null}
              <View style={styles.row2}>
                <PrimaryButton title="Voltar" variant="ghost" onPress={() => setStep(1)} style={{ flex: 1 }} />
                <PrimaryButton
                  title={loading ? 'Salvando…' : 'Confirmar'}
                  onPress={enviar}
                  loading={loading}
                  disabled={loading}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '88%',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray200,
    marginVertical: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '800', color: colors.petroleum },
  sub: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.petroleum,
  },
  area: { minHeight: 72, textAlignVertical: 'top' },
  revTitle: { fontSize: 16, fontWeight: '700', color: colors.petroleum, marginBottom: spacing.md },
  revRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  revLab: { fontSize: 14, color: colors.gray600 },
  revVal: { fontSize: 15, fontWeight: '700', color: colors.petroleum },
  row2: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
