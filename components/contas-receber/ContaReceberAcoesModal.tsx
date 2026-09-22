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
  onCancelar?: () => void;
  onReativar?: () => void;
  onEmitirNf: () => void;
  onVerNota: () => void;
  onPdf: () => void;
  onRegistrarC6?: () => void;
  onRegistrarSicoob?: () => void;
  onWhatsApp: () => void;
  onEmail: () => void;
  onEmailNota?: () => void;
  onVerOrigem: () => void;
  temNota: boolean;
  nfBusy?: boolean;
  pdfBusy?: boolean;
  c6Busy?: boolean;
  sicoobBusy?: boolean;
  emailBusy?: boolean;
  emailNotaBusy?: boolean;
  whatsBusy?: boolean;
  cancelBusy?: boolean;
  reativarBusy?: boolean;
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
  onCancelar,
  onReativar,
  onEmitirNf,
  onVerNota,
  onPdf,
  onRegistrarC6,
  onRegistrarSicoob,
  onWhatsApp,
  onEmail,
  onEmailNota,
  onVerOrigem,
  temNota,
  nfBusy,
  pdfBusy,
  c6Busy,
  sicoobBusy,
  emailBusy,
  emailNotaBusy,
  whatsBusy,
  cancelBusy,
  reativarBusy,
}: Props) {
  if (!item) return null;

  const aberto = item.situacao_cobranca === 'aberto';
  const cancelado = item.situacao_cobranca === 'cancelado';
  const temWhats = Boolean(item.whatsapp?.trim());
  const temEmail = Boolean(item.email?.trim());
  const venc = formatBRDate(parseISODate(item.data_vencimento)) || item.data_vencimento;
  const precisaRegistro =
    item.status_registro === 'erro' ||
    item.status_registro === 'informativo' ||
    item.status_registro === 'pendente' ||
    (item.tipo_emissao === 'c6' && !item.pdf_url && !item.linha_digitavel);
  const registrarNoC6 =
    precisaRegistro &&
    Boolean(onRegistrarC6) &&
    (item.tipo_emissao === 'c6' || item.tipo_emissao === 'informativo');
  const registrarNoSicoob =
    precisaRegistro &&
    Boolean(onRegistrarSicoob) &&
    (item.tipo_emissao === 'sicoob' || item.tipo_emissao === 'informativo');
  const podeCancelar = aberto && Boolean(onCancelar);
  const podeReativar = cancelado && Boolean(onReativar);

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

            {podeCancelar ? (
              <AcaoRow
                icon="close-circle-outline"
                label={cancelBusy ? 'Cancelando…' : 'Cancelar boleto'}
                sub="Cancela no sistema e baixar/cancela no banco (Sicoob/C6) se estiver registrado"
                onPress={onCancelar!}
                disabled={cancelBusy}
                busy={cancelBusy}
              />
            ) : null}

            {podeReativar ? (
              <AcaoRow
                icon="refresh-outline"
                label={reativarBusy ? 'Reativando…' : 'Reativar cobrança'}
                sub="Volta para em aberto no sistema (use se cancelou só no app e o banco ainda está ativo)"
                onPress={onReativar!}
                disabled={reativarBusy}
                busy={reativarBusy}
                accent={colors.petroleum}
              />
            ) : null}

            {temNota ? (
              <AcaoRow icon="receipt-outline" label="Ver NFS-e" onPress={onVerNota} />
            ) : !cancelado ? (
              <AcaoRow
                icon="receipt-outline"
                label={nfBusy ? 'Emitindo NFS-e…' : 'Gerar e emitir NFS-e'}
                onPress={onEmitirNf}
                disabled={nfBusy}
                busy={nfBusy}
              />
            ) : null}

            {temNota && onEmailNota ? (
              <AcaoRow
                icon="mail-open-outline"
                label={emailNotaBusy ? 'Abrindo e-mail…' : 'Compartilhar NFS-e por e-mail'}
                sub={temEmail ? item.email! : 'Sem e-mail no cadastro — preencha no envio'}
                onPress={onEmailNota}
                disabled={emailNotaBusy}
                busy={emailNotaBusy}
                accent={temEmail ? colors.orange : undefined}
              />
            ) : null}

            {registrarNoC6 ? (
              <AcaoRow
                icon="cloud-upload-outline"
                label={c6Busy ? 'Registrando no C6…' : 'Registrar boleto real no C6'}
                sub="Gera PDF e linha digitável via API do banco"
                onPress={onRegistrarC6!}
                disabled={c6Busy}
                busy={c6Busy}
                accent="#1a1a2e"
              />
            ) : null}

            {registrarNoSicoob ? (
              <AcaoRow
                icon="cloud-upload-outline"
                label={sicoobBusy ? 'Registrando no Sicoob…' : 'Registrar boleto no Sicoob'}
                sub="Gera PDF e linha digitável via API do Sicoob"
                onPress={onRegistrarSicoob!}
                disabled={sicoobBusy}
                busy={sicoobBusy}
                accent={colors.petroleum}
              />
            ) : null}

            <AcaoRow
              icon="document-outline"
              label={
                pdfBusy
                  ? 'Abrindo…'
                  : item.tipo_emissao === 'c6' || item.tipo_emissao === 'sicoob'
                    ? 'Abrir PDF do boleto'
                    : 'Abrir PDF do carnê'
              }
              onPress={onPdf}
              disabled={pdfBusy}
              busy={pdfBusy}
            />

            <AcaoRow
              icon="logo-whatsapp"
              label={whatsBusy ? 'Preparando PDF…' : 'Enviar cobrança por WhatsApp'}
              sub={temWhats ? formatWhatsAppDisplay(item.whatsapp!) : 'Sem WhatsApp no cadastro'}
              onPress={onWhatsApp}
              disabled={!temWhats || whatsBusy}
              busy={whatsBusy}
              accent={temWhats ? '#25D366' : undefined}
            />

            <AcaoRow
              icon="mail-outline"
              label={emailBusy ? 'Enviando…' : 'Enviar boleto por e-mail'}
              sub={temEmail ? item.email! : 'Sem e-mail no cadastro'}
              onPress={onEmail}
              disabled={emailBusy || !temEmail}
              busy={emailBusy}
              accent={temEmail ? colors.orange : undefined}
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
