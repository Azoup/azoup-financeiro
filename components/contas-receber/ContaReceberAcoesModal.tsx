import { colors, radius, spacing } from '@/theme/colors';
import type { ContaReceberListRow } from '@/types/contasReceber';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { formatWhatsAppDisplay } from '@/utils/whatsappCobranca';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  item: ContaReceberListRow | null;
  onClose: () => void;
  onPagar: () => void;
  onEmitirNf: () => void;
  onVerNota: () => void;
  onPdf: () => void;
  onWhatsApp: () => void;
  onVerOrigem: () => void;
  temNota: boolean;
  nfBusy?: boolean;
  pdfBusy?: boolean;
};

function origemLabel(origem: ContaReceberListRow['origem']): string {
  return origem === 'mensalidade' ? 'Mensalidade' : 'Venda';
}

function situacaoLabel(item: ContaReceberListRow): string {
  if (item.situacao_cobranca === 'pago') return 'Pago';
  if (item.situacao_cobranca === 'cancelado') return 'Cancelado';
  if (item.parcela_status === 'atrasado') return 'Em aberto · Atrasado';
  return 'Em aberto';
}

function AcaoRow({
  icon,
  label,
  sub,
  onPress,
  disabled,
  busy,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accent?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.acaoRow,
        pressed && !disabled && styles.acaoRowPressed,
        disabled && styles.acaoRowDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
    >
      <View style={[styles.acaoIcon, accent ? { backgroundColor: accent } : null]}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.petroleum} />
        ) : (
          <Ionicons name={icon} size={22} color={accent ? colors.white : colors.petroleum} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.acaoLabel, disabled && styles.acaoLabelDisabled]}>{label}</Text>
        {sub ? <Text style={styles.acaoSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
    </Pressable>
  );
}

export function ContaReceberAcoesModal({
  visible,
  item,
  onClose,
  onPagar,
  onEmitirNf,
  onVerNota,
  onPdf,
  onWhatsApp,
  onVerOrigem,
  temNota,
  nfBusy,
  pdfBusy,
}: Props) {
  if (!item) return null;

  const aberto = item.situacao_cobranca === 'aberto';
  const cancelado = item.situacao_cobranca === 'cancelado';
  const temWhats = Boolean(item.whatsapp?.trim());
  const venc = formatBRDate(parseISODate(item.data_vencimento)) || item.data_vencimento;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {item.nome_cliente}
              </Text>
              <Text style={styles.sub}>
                {origemLabel(item.origem)} · {item.referencia_label}
              </Text>
              <Text style={styles.sub}>
                {formatBRL(item.valor_documento)} · Venc. {venc}
              </Text>
              <Text style={[styles.status, aberto && item.parcela_status === 'atrasado' && styles.statusAtraso]}>
                {situacaoLabel(item)}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.gray600} />
            </Pressable>
          </View>

          <View style={styles.actions}>
            {aberto ? (
              <AcaoRow icon="cash-outline" label="Marcar como pago" onPress={onPagar} accent={colors.orange} />
            ) : null}

            {temNota ? (
              <AcaoRow icon="receipt-outline" label="Ver NFS-e" onPress={onVerNota} />
            ) : !cancelado ? (
              <AcaoRow
                icon="receipt-outline"
                label={nfBusy ? 'Emitindo NFS-e…' : 'Emitir NFS-e'}
                onPress={onEmitirNf}
                disabled={nfBusy}
                busy={nfBusy}
              />
            ) : null}

            <AcaoRow
              icon="document-outline"
              label={pdfBusy ? 'Abrindo PDF…' : 'Abrir PDF do carnê'}
              onPress={onPdf}
              disabled={pdfBusy}
              busy={pdfBusy}
            />

            <AcaoRow
              icon="logo-whatsapp"
              label="Enviar cobrança por WhatsApp"
              sub={temWhats ? formatWhatsAppDisplay(item.whatsapp!) : 'Sem WhatsApp no cadastro'}
              onPress={onWhatsApp}
              disabled={!temWhats}
              accent={temWhats ? '#25D366' : undefined}
            />

            <AcaoRow
              icon="open-outline"
              label={item.origem === 'venda' ? 'Abrir venda' : 'Ver mensalidades do cliente'}
              onPress={onVerOrigem}
            />
          </View>
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
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.petroleum },
  sub: { fontSize: 13, color: colors.gray600, marginTop: 4 },
  status: { fontSize: 12, fontWeight: '700', color: colors.gray800, marginTop: 6 },
  statusAtraso: { color: colors.danger },
  actions: { gap: spacing.xs },
  acaoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  acaoRowPressed: { backgroundColor: colors.gray50 },
  acaoRowDisabled: { opacity: 0.55 },
  acaoIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acaoLabel: { fontSize: 15, fontWeight: '700', color: colors.petroleum },
  acaoLabelDisabled: { color: colors.gray600 },
  acaoSub: { fontSize: 12, color: colors.gray600, marginTop: 2 },
});
