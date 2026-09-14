import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { emitenteLabel, ensureEmitentes } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente } from '@/types/notaFiscal';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Props = {
  visible: boolean;
  titulo?: string;
  descricao?: string;
  botaoPrimario?: string;
  botaoSecundario?: string;
  loading?: boolean;
  onClose: () => void;
  /** CNPJ escolhido e texto que vai na discriminação dos serviços. */
  onEmitir: (emitenteId: string, discriminacao: string) => void;
  onDepois: () => void;
  discriminacaoInicial?: string;
  /** Inclui “— competência …” no texto padrão, como na emissão automática. */
  competencia?: string | null;
};

function textoDiscriminacaoPadrao(
  emitente: NfseEmitente | undefined,
  discriminacaoInicial?: string,
  competencia?: string | null,
): string {
  const inicial = discriminacaoInicial?.trim();
  if (inicial) return inicial;
  const padrao = emitente?.descricao_servico_padrao?.trim() || 'Prestação de serviços';
  const comp = competencia?.trim();
  return comp ? `${padrao} — competência ${comp}` : padrao;
}

export function ConfirmarEmitirNfseModal({
  visible,
  titulo = 'Emitir NFS-e agora?',
  descricao = 'O pagamento foi registrado. Deseja gerar e emitir a NFS-e de serviço para este cliente?',
  botaoPrimario = 'Gerar e emitir NFS-e',
  botaoSecundario = 'Depois',
  loading,
  onClose,
  onEmitir,
  onDepois,
  discriminacaoInicial,
  competencia,
}: Props) {
  const { user } = useAuth();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingEmitentes, setLoadingEmitentes] = useState(false);
  const [discriminacao, setDiscriminacao] = useState('');
  const [editouTexto, setEditouTexto] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    let cancelled = false;
    setLoadingEmitentes(true);
    setEditouTexto(false);
    void ensureEmitentes(user.id)
      .then((list) => {
        if (cancelled) return;
        setEmitentes(list);
        const padrao = list.find((e) => e.padrao) ?? list[0];
        setSelectedId(padrao?.id ?? null);
        setDiscriminacao(textoDiscriminacaoPadrao(padrao, discriminacaoInicial, competencia));
      })
      .catch(() => {
        if (!cancelled) {
          setEmitentes([]);
          setSelectedId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEmitentes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, user?.id, discriminacaoInicial, competencia]);

  const escolherEmitente = (e: NfseEmitente) => {
    setSelectedId(e.id);
    if (!editouTexto) {
      setDiscriminacao(textoDiscriminacaoPadrao(e, discriminacaoInicial, competencia));
    }
  };

  const canEmit = Boolean(selectedId) || emitentes.length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons name="receipt-outline" size={28} color={colors.orange} />
          </View>
          <Text style={styles.title}>{titulo}</Text>
          <Text style={styles.hint}>{descricao}</Text>

          {loadingEmitentes ? (
            <ActivityIndicator color={colors.orange} />
          ) : emitentes.length > 1 ? (
            <View style={styles.emitBox}>
              <Text style={styles.emitLabel}>Emitir com o CNPJ</Text>
              {emitentes.map((e) => {
                const selected = e.id === selectedId;
                return (
                  <Pressable
                    key={e.id}
                    style={[styles.emitOpt, selected && styles.emitOptOn]}
                    onPress={() => escolherEmitente(e)}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? colors.orange : colors.gray400}
                    />
                    <Text style={styles.emitOptTxt}>{emitenteLabel(e)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : emitentes.length === 1 ? (
            <Text style={styles.singleEmit}>CNPJ: {emitenteLabel(emitentes[0])}</Text>
          ) : null}

          <View style={styles.discBox}>
            <Text style={styles.emitLabel}>Discriminação dos serviços</Text>
            <TextInput
              style={styles.discInput}
              value={discriminacao}
              onChangeText={(t) => {
                setEditouTexto(true);
                setDiscriminacao(t);
              }}
              multiline
              placeholder="Texto que aparece na DANFE"
              placeholderTextColor={colors.gray400}
            />
          </View>

          <PrimaryButton
            title={loading ? 'Emitindo NFS-e…' : botaoPrimario}
            onPress={() => {
              const texto = discriminacao.trim();
              if (selectedId) onEmitir(selectedId, texto);
              else if (emitentes[0]?.id) onEmitir(emitentes[0].id, texto);
              else onEmitir('', texto);
            }}
            loading={loading}
            disabled={loading || loadingEmitentes || !canEmit}
          />
          <PrimaryButton title={botaoSecundario} variant="ghost" onPress={onDepois} disabled={loading} />
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
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.petroleum, textAlign: 'center' },
  hint: { fontSize: 13, color: colors.gray600, lineHeight: 18, textAlign: 'center' },
  emitBox: { gap: spacing.sm },
  emitLabel: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
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
  singleEmit: { fontSize: 12, color: colors.gray600, textAlign: 'center' },
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
});
