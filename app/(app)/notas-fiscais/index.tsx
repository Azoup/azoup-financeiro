import { Card } from '@/components/Card';
import { CancelarNotaFiscalModal } from '@/components/notas-fiscais/CancelarNotaFiscalModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { cancelarNotaFiscalSefaz, fetchNotasFiscaisLista, reemitirNotaFiscalSefaz } from '@/services/notaFiscalService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import {
  corNotaFiscalStatus,
  labelAmbienteNfe,
  labelTipoDocumentoFiscal,
  labelNotaFiscalStatus,
  podeCancelarNotaFiscal,
  podeImprimirDanfe,
  podeReemitirNotaFiscal,
} from '@/utils/nfeStatus';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

export default function NotasFiscaisIndexScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<NotaFiscalListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [homologacao] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<NotaFiscalListRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reemitBusyId, setReemitBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [list] = await Promise.all([fetchNotasFiscaisLista(user.id)]);
    setRows(list);
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (alive) Toast.show({ type: 'error', text1: (e as Error).message });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void load().catch((e) => Toast.show({ type: 'error', text1: (e as Error).message }));
    }, [load, user?.id]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const imprimirDanfe = async (item: NotaFiscalListRow) => {
    const url = item.danfe_url?.trim();
    if (!url) {
      Toast.show({ type: 'info', text1: 'DANFSe ainda não disponível para esta nota.' });
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Toast.show({ type: 'error', text1: 'Não foi possível abrir o DANFE.' });
  };

  const confirmarCancelamento = async (justificativa: string) => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await cancelarNotaFiscalSefaz(cancelTarget.id, justificativa);
      Toast.show({ type: 'success', text1: 'NFS-e cancelada.' });
      setCancelTarget(null);
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  const reemitir = async (item: NotaFiscalListRow) => {
    setReemitBusyId(item.id);
    try {
      const res = await reemitirNotaFiscalSefaz(item.id);
      if (res.success) {
        Toast.show({ type: 'success', text1: 'NFS-e autorizada.' });
      } else {
        Toast.show({ type: 'error', text1: res.message ?? 'NFS-e rejeitada.' });
      }
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setReemitBusyId(null);
    }
  };

  const renderItem = ({ item }: { item: NotaFiscalListRow }) => {
    const st = corNotaFiscalStatus(item.status);
    const cli = item.cliente?.nome_cliente ?? '—';
    const podeDanfe = podeImprimirDanfe(item);
    const podeCancelar = podeCancelarNotaFiscal(item);
    const podeReemitir = podeReemitirNotaFiscal(item);
    const reemitindo = reemitBusyId === item.id;

    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nfNum}>
              NFS-e {item.serie}/{item.numero}
            </Text>
            <Text style={styles.cli}>{cli}</Text>
            {item.competencia ? <Text style={styles.comp}>Competência: {item.competencia}</Text> : null}
          </View>
          <View style={[styles.badge, { backgroundColor: st.bg }]}>
            <Text style={[styles.badgeTxt, { color: st.fg }]}>{labelNotaFiscalStatus(item.status)}</Text>
          </View>
        </View>
        <Text style={styles.val}>{formatBRL(item.valor_total)}</Text>
        <Text style={styles.meta}>
          {labelTipoDocumentoFiscal(item.tipo_documento)} · {labelAmbienteNfe(item.ambiente)}
          {item.status_sefaz ? ` · ${item.status_sefaz}` : ''}
        </Text>
        {item.codigo_verificacao ? (
          <Text style={styles.chave} numberOfLines={1}>
            Cód. verificação: {item.codigo_verificacao}
          </Text>
        ) : null}
        {item.chave_acesso ? (
          <Text style={styles.chave} numberOfLines={1}>
            Chave: {item.chave_acesso}
          </Text>
        ) : null}
        {item.motivo_cancelamento ? (
          <Text style={styles.cancelMotivo} numberOfLines={3}>
            Cancelamento: {item.motivo_cancelamento}
          </Text>
        ) : null}
        {item.motivo_rejeicao ? (
          <Text style={styles.rejeicao} numberOfLines={3}>
            {item.motivo_rejeicao}
          </Text>
        ) : null}
        <Text style={styles.date}>{formatDateTimeBRFromISO(item.created_at)}</Text>
        <View style={styles.acoes}>
          {podeReemitir ? (
            <PrimaryButton
              title={reemitindo ? 'Reemitindo…' : 'Reemitir NFS-e'}
              onPress={() => void reemitir(item)}
              disabled={reemitindo || cancelBusy}
              style={styles.btnAcao}
            />
          ) : null}
          <PrimaryButton
            title="Imprimir DANFSe"
            variant="secondary"
            onPress={() => void imprimirDanfe(item)}
            disabled={!podeDanfe}
            style={styles.btnAcao}
          />
          {podeCancelar ? (
            <PrimaryButton
              title="Cancelar NFS-e"
              variant="danger"
              onPress={() => setCancelTarget(item)}
              style={styles.btnAcao}
            />
          ) : null}
        </View>
      </Card>
    );
  };

  const emHomologacao = homologacao;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        {emHomologacao ? (
          <View style={styles.homologBanner}>
            <Ionicons name="flask-outline" size={18} color={colors.petroleum} />
            <Text style={styles.homologTxt}>
              Ambiente de <Text style={styles.homologStrong}>homologação</Text> — NFS-e de serviço sem valor fiscal.
              Produção será habilitada futuramente.
            </Text>
          </View>
        ) : null}
        <Text style={styles.lead}>
          Notas de serviço emitidas a partir das mensalidades. Cancelamento só para NFS-e autorizada.
        </Text>
        <Pressable style={styles.configLink} onPress={() => router.push('/(app)/configuracoes/nfe')}>
          <Ionicons name="settings-outline" size={16} color={colors.orange} />
          <Text style={styles.configLinkTxt}>Configurar emissão de NFS-e</Text>
        </Pressable>
      </View>

      {loading && !rows.length ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Nenhuma NFS-e ainda. Gere com &quot;Gerar mensalidade + NFS-e&quot;, use o botão Emitir NFS-e em
              Mensalidades/A receber, ou confira se o cliente está marcado como Com NF e se o certificado A1 está em
              Configurações › NFS-e.
            </Text>
          }
        />
      )}

      <CancelarNotaFiscalModal
        visible={cancelTarget != null}
        nota={cancelTarget}
        loading={cancelBusy}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        onConfirm={(j) => void confirmarCancelamento(j)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  topBar: { padding: spacing.md, paddingBottom: spacing.sm },
  homologBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#ffe082',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  prodBanner: {
    backgroundColor: '#e8f5e9',
    borderColor: '#c8e6c9',
  },
  homologTxt: { flex: 1, fontSize: 12, color: colors.gray800, lineHeight: 17 },
  homologStrong: { fontWeight: '800', color: colors.petroleum },
  lead: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  configLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  configLinkTxt: { color: colors.orange, fontWeight: '700', fontSize: 13 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  card: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  nfNum: { fontSize: 15, fontWeight: '800', color: colors.petroleum },
  cli: { fontSize: 14, fontWeight: '600', color: colors.gray800, marginTop: 2 },
  comp: { fontSize: 12, color: colors.gray600, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  val: { fontSize: 18, fontWeight: '800', color: colors.orange, marginTop: spacing.sm },
  meta: { fontSize: 12, color: colors.gray600, marginTop: 4 },
  chave: { fontSize: 10, color: colors.gray400, marginTop: 4 },
  cancelMotivo: { fontSize: 12, color: colors.gray600, marginTop: spacing.sm, lineHeight: 17 },
  rejeicao: { fontSize: 12, color: colors.danger, marginTop: spacing.sm, lineHeight: 17 },
  date: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm },
  acoes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  btnAcao: { flex: 1, minWidth: 140, minHeight: 44 },
  empty: { textAlign: 'center', color: colors.gray400, marginTop: spacing.xl, lineHeight: 20 },
});
