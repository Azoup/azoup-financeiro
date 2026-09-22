import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { pickEmitenteC6 } from '@/services/c6ConfigService';
import { emitenteLabel, ensureEmitentes } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente } from '@/types/notaFiscal';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type BancoCobrancaEscolha = 'sicoob' | 'c6';

export type EnviarMensalidadeOpts = {
  emitenteId: string;
  banco: BancoCobrancaEscolha;
  /** true = cada boleto usa o CNPJ do cadastro do cliente; false = usa o CNPJ escolhido abaixo para todos. */
  usarEmitenteDoCliente: boolean;
  discriminacao?: string;
};

type Props = {
  visible: boolean;
  loading?: boolean;
  onClose: () => void;
  onMensalidadeComBoleto: (opts: EnviarMensalidadeOpts) => void;
  onMensalidadeComBoletoENf: (opts: EnviarMensalidadeOpts) => void;
  /** Preferência inicial (ex.: empresa do filtro ou do cliente selecionado). */
  emitenteIdInicial?: string | null;
};

function pickEmitenteParaBanco(list: NfseEmitente[], banco: BancoCobrancaEscolha, preferId?: string | null) {
  if (preferId) {
    const preferred = list.find((e) => e.id === preferId);
    if (preferred) return preferred;
  }
  const doBanco = list.filter((e) =>
    banco === 'c6' ? e.banco_cobranca === 'c6' : e.banco_cobranca !== 'c6',
  );
  if (banco === 'c6') {
    return pickEmitenteC6(doBanco.length ? doBanco : list) ?? doBanco[0] ?? list[0];
  }
  return doBanco.find((e) => e.padrao) ?? doBanco[0] ?? list.find((e) => e.padrao) ?? list[0];
}

export function EnviarMensalidadeModal({
  visible,
  loading,
  onClose,
  onMensalidadeComBoleto,
  onMensalidadeComBoletoENf,
  emitenteIdInicial,
}: Props) {
  const { user } = useAuth();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [usarDoCliente, setUsarDoCliente] = useState(true);
  const [banco, setBanco] = useState<BancoCobrancaEscolha>('sicoob');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingEmit, setLoadingEmit] = useState(false);
  const [discriminacao, setDiscriminacao] = useState('Serviço de mensalidade — competência {competencia}');
  const [editouTexto, setEditouTexto] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    let cancelled = false;
    setLoadingEmit(true);
    setEditouTexto(false);
    setUsarDoCliente(true);
    void ensureEmitentes(user.id)
      .then((list) => {
        if (cancelled) return;
        setEmitentes(list);
        const inicial = emitenteIdInicial ? list.find((e) => e.id === emitenteIdInicial) : undefined;
        const bancoInicial: BancoCobrancaEscolha =
          inicial?.banco_cobranca === 'c6' ? 'c6' : 'sicoob';
        setBanco(bancoInicial);
        const preferred = pickEmitenteParaBanco(list, bancoInicial, emitenteIdInicial);
        setSelectedId(preferred?.id ?? null);
        if (!editouTexto) {
          const padraoTxt = preferred?.descricao_servico_padrao?.trim() || 'Serviço de mensalidade';
          setDiscriminacao(`${padraoTxt} — competência {competencia}`);
        }
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
  }, [visible, user?.id, emitenteIdInicial]);

  const emitentesDoBanco = useMemo(() => {
    const filtrados = emitentes.filter((e) =>
      banco === 'c6' ? e.banco_cobranca === 'c6' : e.banco_cobranca !== 'c6',
    );
    return filtrados.length ? filtrados : emitentes;
  }, [emitentes, banco]);

  useEffect(() => {
    if (!emitentes.length) return;
    if (selectedId && emitentesDoBanco.some((e) => e.id === selectedId)) return;
    const next = pickEmitenteParaBanco(emitentes, banco, emitenteIdInicial);
    setSelectedId(next?.id ?? null);
  }, [banco, emitentes, emitentesDoBanco, selectedId, emitenteIdInicial]);

  const selected = emitentes.find((e) => e.id === selectedId) ?? null;
  const emitenteId = selectedId || emitentesDoBanco[0]?.id || emitentes[0]?.id || '';
  const bancoLabel = banco === 'c6' ? 'C6 Bank' : 'Sicoob';

  const escolherBanco = (next: BancoCobrancaEscolha) => {
    setBanco(next);
    const preferred = pickEmitenteParaBanco(emitentes, next, emitenteIdInicial);
    setSelectedId(preferred?.id ?? null);
    if (!editouTexto && preferred) {
      const padraoTxt = preferred.descricao_servico_padrao?.trim() || 'Serviço de mensalidade';
      setDiscriminacao(`${padraoTxt} — competência {competencia}`);
    }
  };

  const optsBase = (): EnviarMensalidadeOpts => ({
    emitenteId,
    banco,
    usarEmitenteDoCliente: usarDoCliente,
    discriminacao: discriminacao.trim(),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Como deseja enviar?</Text>
          <Text style={styles.hint}>
            Por padrão o boleto usa o CNPJ da empresa do cadastro de cada cliente. Você pode trocar e forçar um
            CNPJ/banco para todos desta geração.
          </Text>

          <View style={styles.emitBox}>
            <Text style={styles.emitLabel}>CNPJ cobrador do boleto</Text>
            <Pressable
              style={[styles.emitOpt, usarDoCliente && styles.emitOptOn]}
              onPress={() => setUsarDoCliente(true)}
            >
              <Ionicons
                name={usarDoCliente ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={usarDoCliente ? colors.orange : colors.gray400}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.emitOptTxt}>Usar empresa do cadastro do cliente</Text>
                <Text style={styles.optSub}>Recomendado — Sicoob/C6 conforme o CNPJ de cada cliente</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.emitOpt, !usarDoCliente && styles.emitOptOn]}
              onPress={() => setUsarDoCliente(false)}
            >
              <Ionicons
                name={!usarDoCliente ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={!usarDoCliente ? colors.orange : colors.gray400}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.emitOptTxt}>Trocar — usar outro CNPJ para todos</Text>
                <Text style={styles.optSub}>Escolha banco e empresa abaixo</Text>
              </View>
            </Pressable>
          </View>

          {!usarDoCliente ? (
            <>
              <View style={styles.emitBox}>
                <Text style={styles.emitLabel}>Banco do boleto</Text>
                <View style={styles.bancoRow}>
                  {([
                    { id: 'sicoob' as const, label: 'Sicoob' },
                    { id: 'c6' as const, label: 'C6 Bank' },
                  ]).map((opt) => {
                    const on = banco === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        style={[styles.bancoOpt, on && styles.bancoOptOn]}
                        onPress={() => escolherBanco(opt.id)}
                      >
                        <Ionicons
                          name={on ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={on ? colors.orange : colors.gray400}
                        />
                        <Text style={[styles.bancoOptTxt, on && styles.bancoOptTxtOn]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.bancoHint}>Boleto será registrado no {bancoLabel}.</Text>
              </View>

              {loadingEmit ? (
                <ActivityIndicator color={colors.orange} />
              ) : emitentes.length > 0 ? (
                <View style={styles.emitBox}>
                  <Text style={styles.emitLabel}>CNPJ cobrador / emitente</Text>
                  {emitentesDoBanco.map((e) => {
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
                </View>
              ) : (
                <Text style={styles.hint}>
                  Cadastre o emitente em Configurações › NFS-e. Sem CNPJ, o carnê fica informativo.
                </Text>
              )}
            </>
          ) : loadingEmit ? (
            <ActivityIndicator color={colors.orange} />
          ) : selected ? (
            <Text style={styles.bancoHint}>
              Fallback se algum cliente estiver sem empresa: {emitenteLabel(selected)}.
            </Text>
          ) : null}

          <View style={styles.discBox}>
            <Text style={styles.emitLabel}>Discriminação dos serviços (NFS-e)</Text>
            <TextInput
              style={styles.discInput}
              value={discriminacao}
              onChangeText={(t) => {
                setEditouTexto(true);
                setDiscriminacao(t);
              }}
              multiline
              placeholder="Texto da DANFE. Use {competencia} para variar por cliente."
              placeholderTextColor={colors.gray400}
            />
            <Text style={styles.hint}>
              {'{competencia}'} vira o mês de cada mensalidade. Esse texto só entra na nota.
            </Text>
          </View>

          <Pressable
            style={[styles.option, styles.optionPrimary]}
            onPress={() => onMensalidadeComBoletoENf(optsBase())}
            disabled={loading || loadingEmit || (!usarDoCliente && !emitenteId)}
          >
            <Ionicons name="document-text" size={22} color={colors.white} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitleLight}>Gerar mensalidade + boleto + NFS-e</Text>
              <Text style={styles.optionSubLight}>
                {usarDoCliente
                  ? 'Boleto e nota pelo CNPJ do cadastro de cada cliente (pode trocar acima).'
                  : `Boleto e nota com ${bancoLabel} / CNPJ escolhido para todos.`}
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.option}
            onPress={() => onMensalidadeComBoleto(optsBase())}
            disabled={loading || loadingEmit || (!usarDoCliente && !emitenteId)}
          >
            <Ionicons name="receipt-outline" size={22} color={colors.petroleum} />
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>Gerar mensalidade + boleto</Text>
              <Text style={styles.optionSub}>
                {usarDoCliente
                  ? 'Sem nota — boleto pelo CNPJ do cadastro do cliente.'
                  : `Sem nota — boleto ${bancoLabel} com o CNPJ escolhido.`}
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
  bancoRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  bancoOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
  },
  bancoOptOn: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.08)',
  },
  bancoOptTxt: { fontSize: 14, fontWeight: '700', color: colors.gray700 },
  bancoOptTxtOn: { color: colors.petroleum },
  bancoHint: { fontSize: 12, color: colors.orange, fontWeight: '700' },
  optSub: { fontSize: 11, color: colors.gray600, marginTop: 2, lineHeight: 15 },
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
  discBox: { gap: 6 },
  discInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.petroleum,
    textAlignVertical: 'top',
  },
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
