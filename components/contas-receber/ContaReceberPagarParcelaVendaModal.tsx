import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
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
    desconto?: number;
    observacao: string;
    banco_recebimento: 'sicoob' | 'c6';
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
  const [descontoMask, setDescontoMask] = useState('');
  const [obs, setObs] = useState('');
  const [bancoRecebimento, setBancoRecebimento] = useState<'sicoob' | 'c6'>('sicoob');
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setDataPag(new Date());
    setValorMask('');
    setDescontoMask('');
    setObs('');
    setBancoRecebimento('sicoob');
  }, []);

  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  const valorNum = parseBRLMasked(valorMask) ?? 0;
  const descontoNum = parseBRLMasked(descontoMask) ?? 0;
  const saldoCent = reaisParaCentavos(saldoMax);
  const somaCent = reaisParaCentavos(valorNum) + reaisParaCentavos(descontoNum);
  const valorOk =
    somaCent > 0 &&
    reaisParaCentavos(valorNum) >= 0 &&
    reaisParaCentavos(descontoNum) >= 0 &&
    somaCent <= saldoCent;

  const onChangeDesconto = (mask: string) => {
    setDescontoMask(mask);
    const dCent = reaisParaCentavos(parseBRLMasked(mask) ?? 0);
    const sugerido = Math.max(0, saldoCent - Math.min(dCent, saldoCent)) / 100;
    setValorMask(sugerido > 0 ? formatBRL(sugerido) : '');
  };

  const avançar = () => {
    if (!valorOk) {
      Toast.show({
        type: 'error',
        text1: 'Informe valor e/ou desconto dentro do saldo em aberto.',
      });
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
        desconto: descontoNum > 0 ? descontoNum : undefined,
        observacao: obs,
        banco_recebimento: bancoRecebimento,
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
              <Text style={styles.label}>Banco do recebimento</Text>
              <Text style={styles.bancoHint}>Onde entrou o PIX/transferência.</Text>
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
              <Text style={styles.label}>Desconto (opcional)</Text>
              <MaskInput
                style={styles.input}
                value={descontoMask}
                onChangeText={onChangeDesconto}
                mask={Masks.BRL_CURRENCY}
                keyboardType="numeric"
                placeholder="R$ 0,00"
                placeholderTextColor={colors.gray400}
              />
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
              {descontoNum > 0 ? (
                <Text style={styles.hintLiq}>
                  Líquido desta baixa: {formatBRL(valorNum)} · abate {formatBRL(descontoNum)} do saldo
                </Text>
              ) : null}
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
                <Text style={styles.revLab}>Valor pago</Text>
                <Text style={styles.revVal}>{formatBRL(valorNum)}</Text>
              </View>
              {descontoNum > 0 ? (
                <View style={styles.revRow}>
                  <Text style={styles.revLab}>Desconto</Text>
                  <Text style={styles.revVal}>{formatBRL(descontoNum)}</Text>
                </View>
              ) : null}
              <View style={styles.revRow}>
                <Text style={styles.revLab}>Data</Text>
                <Text style={styles.revVal}>
                  {dataPag ? toISODate(dataPag).split('-').reverse().join('/') : '—'}
                </Text>
              </View>
              <View style={styles.revRow}>
                <Text style={styles.revLab}>Banco</Text>
                <Text style={styles.revVal}>
                  {bancoRecebimento === 'c6' ? 'C6 Bank' : 'Sicoob'}
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
  hintLiq: { fontSize: 12, color: colors.gray600, marginTop: 6 },
  bancoHint: { fontSize: 12, color: colors.gray600, marginBottom: spacing.xs },
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
