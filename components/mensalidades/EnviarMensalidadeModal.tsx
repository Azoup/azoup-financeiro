import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { emitenteLabel, ensureEmitentes } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente } from '@/types/notaFiscal';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  loading?: boolean;
  onClose: () => void;
  /** Mensalidade + boleto bancário (Sicoob ou C6 conforme CNPJ). */
  onMensalidadeComBoleto: (emitenteId: string) => void;
  /** Mensalidade + boleto + NFS-e no mesmo CNPJ. */
  onMensalidadeComBoletoENf: (emitenteId: string) => void;
};

export function EnviarMensalidadeModal({
  visible,
  loading,
  onClose,
  onMensalidadeComBoleto,
  onMensalidadeComBoletoENf,
}: Props) {
  const { user } = useAuth();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingEmit, setLoadingEmit] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    let cancelled = false;
    setLoadingEmit(true);
    void ensureEmitentes(user.id)
      .then((list) => {
        if (cancelled) return;
        setEmitentes(list);
        setSelectedId((list.find((e) => e.padrao) ?? list[0])?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setEmitentes([]);
          setSelectedId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEmit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, user?.id]);

  const selected = emitentes.find((e) => e.id === selectedId) ?? null;
  const bancoLabel = selected?.banco_cobranca === 'c6' ? 'C6 Bank' : 'Sicoob';
  const emitenteId = selectedId || emitentes[0]?.id || '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Como deseja enviar?</Text>
          <Text style={styles.hint}>
            Escolha o CNPJ cobrador (define o banco do boleto) e se deseja emitir também a NFS-e.
          </Text>

          {loadingEmit ? (
            <ActivityIndicator color={colors.orange} />
          ) : emitentes.length > 0 ? (
            <View style={styles.emitBox}>
              <Text style={styles.emitLabel}>CNPJ cobrador / emitente</Text>
              {emitentes.map((e) => {
                const selectedOpt = e.id === selectedId;
                return (
                  <Pressable
                    key={e.id}
                    style={[styles.emitOpt, selectedOpt && styles.emitOptOn]}
                    onPress={() => setSelectedId(e.id)}
                  >
                    <Ionicons
                      name={selectedOpt ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selectedOpt ? colors.orange : colors.gray400}
                    />
                    <Text style={styles.emitOptTxt}>{emitenteLabel(e)}</Text>
                  </Pressable>
                );
              })}
              {selected ? (
                <Text style={styles.bancoHint}>Boleto será registrado no {bancoLabel}.</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>
              Cadastre o emitente em Configurações › NFS-e. Sem CNPJ, o carnê fica informativo.
            </Text>
          )}

          <Pressable
            style={[styles.option, styles.optionPrimary]}
            onPress={() => onMensalidadeComBoletoENf(emitenteId)}
            disabled={loading || loadingEmit}
          >
            <Ionicons name="document-text" size={22} color={colors.white} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitleLight}>Gerar mensalidade + boleto + NFS-e</Text>
              <Text style={styles.optionSubLight}>
                Mensalidade, boleto bancário ({bancoLabel}) em A receber e nota fiscal. Cliente precisa estar
                com &quot;Com NF&quot; e certificado A1 do CNPJ escolhido.
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.option}
            onPress={() => onMensalidadeComBoleto(emitenteId)}
            disabled={loading || loadingEmit}
          >
            <Ionicons name="receipt-outline" size={22} color={colors.petroleum} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>Gerar mensalidade + boleto</Text>
              <Text style={styles.optionSub}>
                Sem nota fiscal — mensalidade e boleto {bancoLabel} para pagamento.
              </Text>
            </View>
          </Pressable>

          <PrimaryButton title="Cancelar" variant="ghost" onPress={onClose} disabled={loading} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.petroleum },
  hint: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  emitBox: { gap: spacing.sm },
  emitLabel: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
  bancoHint: { fontSize: 12, color: colors.orange, fontWeight: '700' },
  emitOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  emitOptOn: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.06)',
  },
  emitOptTxt: { flex: 1, fontSize: 13, color: colors.gray800, fontWeight: '600' },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.gray50,
  },
  optionPrimary: {
    backgroundColor: colors.petroleum,
    borderColor: colors.petroleum,
  },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.petroleum },
  optionTitleLight: { fontSize: 15, fontWeight: '700', color: colors.white },
  optionSub: { fontSize: 12, color: colors.gray600, marginTop: 4, lineHeight: 17 },
  optionSubLight: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 17 },
});
