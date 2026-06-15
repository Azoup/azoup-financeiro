import { DatePickerField } from '@/components/DatePickerField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { fetchFormasPagamentoAtivas } from '@/services/formasPagamentoService';
import type { MensalidadeGerada } from '@/types/mensalidadeGerada';
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
  registro: MensalidadeGerada | null;
  onClose: () => void;
  onConfirm: (payload: {
    data_pagamento: string;
    valor_pago: number;
    forma_pagamento: string;
    observacao: string;
  }) => Promise<void>;
};

export function MarcarPagamentoMensalidadeGeradaModal({ visible, registro, onClose, onConfirm }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [dataPag, setDataPag] = useState<Date | null>(() => new Date());
  const [valorMask, setValorMask] = useState('');
  const [formaNome, setFormaNome] = useState('');
  const [obs, setObs] = useState('');
  const [formas, setFormas] = useState<FormaPagamento[]>([]);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setDataPag(new Date());
    setValorMask('');
    setFormaNome('');
    setObs('');
  }, []);

  useEffect(() => {
    if (visible) {
      reset();
      fetchFormasPagamentoAtivas().then((f) => {
        setFormas(f);
        if (f[0]) setFormaNome(f[0].nome);
      });
    }
  }, [visible, reset]);

  const saldo =
    registro == null
      ? 0
      : Math.max(0, reaisParaCentavos(registro.valor) - reaisParaCentavos(registro.valor_pago)) / 100;

  const valorNum = parseBRLMasked(valorMask) ?? 0;
  const valorOk = valorNum > 0 && reaisParaCentavos(valorNum) <= reaisParaCentavos(saldo);
  const formaOk = formaNome.trim().length > 0;

  const avançar = () => {
    if (!valorOk || !formaOk) {
      Toast.show({ type: 'error', text1: 'Preencha valor e forma de pagamento corretamente.' });
      return;
    }
    setStep(2);
  };

  const enviar = async () => {
    if (!registro || !dataPag) return;
    setLoading(true);
    try {
      await onConfirm({
        data_pagamento: toISODate(dataPag),
        valor_pago: valorNum,
        forma_pagamento: formaNome.trim(),
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
    <Modal visible={visible && !!registro} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Ionicons name="cash-outline" size={28} color={colors.orange} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Marcar como pago</Text>
              <Text style={styles.sub}>Saldo em aberto: {formatBRL(saldo)}</Text>
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
                placeholder={formatBRL(saldo)}
                placeholderTextColor={colors.gray400}
              />
              <Text style={styles.label}>Forma de pagamento</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                {formas.map((f) => {
                  const on = f.nome === formaNome;
                  return (
                    <Pressable
                      key={f.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setFormaNome(f.nome)}
                    >
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{f.nome}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {formas.length === 0 ? (
                <TextInput
                  style={styles.input}
                  value={formaNome}
                  onChangeText={setFormaNome}
                  placeholder="Ex.: PIX, Dinheiro…"
                  placeholderTextColor={colors.gray400}
                />
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
              <PrimaryButton title="Revisar e confirmar" onPress={avançar} disabled={!valorOk || !formaOk} />
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
                <Text style={styles.revVal}>{dataPag ? toISODate(dataPag).split('-').reverse().join('/') : '—'}</Text>
              </View>
              <View style={styles.revRow}>
                <Text style={styles.revLab}>Forma</Text>
                <Text style={styles.revVal}>{formaNome}</Text>
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
  chips: { flexGrow: 0, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginRight: spacing.sm,
  },
  chipOn: { backgroundColor: colors.petroleum, borderColor: colors.petroleum },
  chipTxt: { fontSize: 13, color: colors.gray800 },
  chipTxtOn: { color: colors.white, fontWeight: '600' },
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
