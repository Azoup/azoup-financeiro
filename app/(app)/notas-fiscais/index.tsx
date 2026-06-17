import { Card } from '@/components/Card';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { fetchNotasFiscaisLista } from '@/services/notaFiscalService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { corNotaFiscalStatus, labelAmbienteNfe, labelNotaFiscalStatus, podeImprimirDanfe } from '@/utils/nfeStatus';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

  const load = useCallback(async () => {
    if (!user?.id) return;
    const list = await fetchNotasFiscaisLista(user.id);
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
      Toast.show({ type: 'info', text1: 'DANFE ainda não disponível para esta nota.' });
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

  const renderItem = ({ item }: { item: NotaFiscalListRow }) => {
    const st = corNotaFiscalStatus(item.status);
    const cli = item.cliente?.nome_cliente ?? '—';
    const podeDanfe = podeImprimirDanfe(item);

    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nfNum}>
              NF-e {item.serie}/{item.numero}
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
          {labelAmbienteNfe(item.ambiente)}
          {item.status_sefaz ? ` · SEFAZ ${item.status_sefaz}` : ''}
        </Text>
        {item.chave_acesso ? (
          <Text style={styles.chave} numberOfLines={1}>
            Chave: {item.chave_acesso}
          </Text>
        ) : null}
        {item.motivo_rejeicao ? (
          <Text style={styles.rejeicao} numberOfLines={3}>
            {item.motivo_rejeicao}
          </Text>
        ) : null}
        <Text style={styles.date}>{formatDateTimeBRFromISO(item.created_at)}</Text>
        <View style={styles.acoes}>
          <PrimaryButton
            title="Imprimir DANFE"
            variant="secondary"
            onPress={() => void imprimirDanfe(item)}
            disabled={!podeDanfe}
            style={styles.btnDanfe}
          />
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.lead}>
          Notas fiscais emitidas a partir das mensalidades. Configure certificado e parâmetros fiscais antes de
          gerar.
        </Text>
        <Pressable style={styles.configLink} onPress={() => router.push('/(app)/configuracoes/nfe')}>
          <Ionicons name="settings-outline" size={16} color={colors.orange} />
          <Text style={styles.configLinkTxt}>Configurar emissão de NF-e</Text>
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
              Nenhuma nota fiscal ainda. Use &quot;Gerar mensalidade + NF-e&quot; na tela de geração.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  topBar: { padding: spacing.md, paddingBottom: spacing.sm },
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
  rejeicao: { fontSize: 12, color: colors.danger, marginTop: spacing.sm, lineHeight: 17 },
  date: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm },
  acoes: { marginTop: spacing.md },
  btnDanfe: { minHeight: 44 },
  empty: { textAlign: 'center', color: colors.gray400, marginTop: spacing.xl, lineHeight: 20 },
});
