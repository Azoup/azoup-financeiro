import { Card } from '@/components/Card';
import { ConfirmarEmitirNfseModal } from '@/components/mensalidades/ConfirmarEmitirNfseModal';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchAzoupDashboard } from '@/services/azoupAdminService';
import { emitirNfseClienteAzoup } from '@/services/azoupNfseService';
import { colors, radius, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import type { AzoupClienteResumo, AzoupDashboardData, AzoupStatusGrupo } from '@/types/azoupAdmin';
import { formatBRL } from '@/utils/currency';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const CLIENTES_POR_PAGINA = 10;

type StatusFiltro = 'todos' | AzoupStatusGrupo;

const STATUS_OPTS: { id: StatusFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativa', label: 'Ativos' },
  { id: 'trial', label: 'Trial' },
  { id: 'inadimplente', label: 'Inadimpl.' },
  { id: 'cancelada', label: 'Cancelados' },
  { id: 'outro', label: 'Outros' },
];

function centavosParaReais(c: number) {
  return (Number(c) || 0) / 100;
}

function statusTone(grupo: AzoupStatusGrupo): { bg: string; fg: string } {
  switch (grupo) {
    case 'ativa':
      return { bg: colors.successSoft, fg: colors.success };
    case 'trial':
      return { bg: 'rgba(37, 99, 235, 0.10)', fg: '#1d4ed8' };
    case 'inadimplente':
      return { bg: colors.orangeSoft, fg: colors.orangeDark };
    case 'cancelada':
      return { bg: colors.gray100, fg: colors.gray600 };
    default:
      return { bg: colors.infoSoft, fg: colors.petroleum };
  }
}

function MetricPill({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'orange' | 'green' | 'blue' | 'red' | 'muted';
}) {
  const palette = {
    orange: { bg: colors.orangeSoft, icon: colors.orangeDark },
    green: { bg: colors.successSoft, icon: colors.success },
    blue: { bg: 'rgba(37, 99, 235, 0.10)', icon: '#1d4ed8' },
    red: { bg: colors.dangerSoft, icon: colors.danger },
    muted: { bg: colors.infoSoft, icon: colors.petroleum },
  }[tone];

  return (
    <View style={styles.metricPill}>
      <View style={[styles.metricIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={16} color={palette.icon} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export default function AzoupDashboardScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<AzoupDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 280);
  const [statusFilter, setStatusFilter] = useState<StatusFiltro>('todos');
  const [pagina, setPagina] = useState(1);
  const [nfCliente, setNfCliente] = useState<AzoupClienteResumo | null>(null);
  const [nfLoading, setNfLoading] = useState(false);
  const [nfMsg, setNfMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetchAzoupDashboard();
    setData(d);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (alive) {
          setData(null);
          setError((e as Error).message);
        }
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
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const filteredClientes = useMemo(() => {
    const list = data?.clientes ?? [];
    const term = debouncedSearch.trim().toLowerCase();
    return list.filter((c) => {
      if (statusFilter !== 'todos' && c.status_grupo !== statusFilter) return false;
      if (!term) return true;
      const hay = [
        c.nome,
        c.email ?? '',
        c.telefone ?? '',
        c.plano_nome ?? '',
        c.status_label,
        c.empresa_matriz_cnpj ?? '',
        c.empresa_matriz_nome ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [data?.clientes, debouncedSearch, statusFilter]);

  const totalPaginas = Math.max(1, Math.ceil(filteredClientes.length / CLIENTES_POR_PAGINA));
  const clientesPagina = useMemo(() => {
    const inicio = (pagina - 1) * CLIENTES_POR_PAGINA;
    return filteredClientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);
  }, [filteredClientes, pagina]);

  useEffect(() => {
    setPagina(1);
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas));
  }, [totalPaginas]);

  const maxPlano = Math.max(1, ...(data?.planos_clientes.map((p) => p.total) ?? [1]));

  const onEmitirNf = useCallback(
    async (emitenteId: string) => {
      if (!user?.id || !nfCliente) return;
      setNfLoading(true);
      setNfMsg(null);
      try {
        const res = await emitirNfseClienteAzoup(user.id, nfCliente.id, {
          emitenteId: emitenteId || null,
          usarValorBruto: false,
        });
        if (res.success) {
          setNfMsg(`NFS-e autorizada (${nfCliente.nome}).`);
          setNfCliente(null);
        } else {
          setNfMsg(res.message ?? 'Falha ao emitir NFS-e.');
        }
      } catch (e) {
        setNfMsg((e as Error).message);
      } finally {
        setNfLoading(false);
      }
    },
    [user?.id, nfCliente],
  );

  const pedirEmitirNf = useCallback((item: AzoupClienteResumo) => {
    if (!item.pode_emitir_nf) {
      const msg =
        'Este cliente Azoup não tem CNPJ da empresa matriz. Cadastre a matriz no Azoup para emitir NFS-e.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(msg);
      } else {
        Alert.alert('Sem CNPJ', msg);
      }
      return;
    }
    setNfMsg(null);
    setNfCliente(item);
  }, []);

  const renderCliente = ({ item }: { item: AzoupClienteResumo }) => {
    const tone = statusTone(item.status_grupo);
    const liquido = centavosParaReais(item.valor_centavos);
    const bruto = centavosParaReais(item.valor_bruto_centavos);
    const temDesconto = item.desconto_centavos > 0 || bruto > liquido + 0.001;
    return (
      <Card style={styles.clienteCard} padded={false}>
        <View style={styles.clienteTop}>
          <Text style={styles.clienteNome} numberOfLines={2}>
            {item.nome}
          </Text>
          <View style={[styles.statusTag, { backgroundColor: tone.bg }]}>
            <Text style={[styles.statusTagTxt, { color: tone.fg }]} numberOfLines={1}>
              {item.status_label}
            </Text>
          </View>
        </View>
        {item.plano_nome ? (
          <Text style={styles.clientePlano} numberOfLines={1}>
            {item.plano_nome}
          </Text>
        ) : (
          <Text style={styles.clientePlanoMuted}>Sem plano</Text>
        )}
        <Text style={styles.clienteValor}>{formatBRL(liquido)}</Text>
        {temDesconto ? (
          <Text style={styles.clienteValorBruto}>Cheio {formatBRL(bruto)}</Text>
        ) : null}
        {item.empresa_matriz_cnpj ? (
          <Text style={styles.clienteMeta} numberOfLines={1}>
            CNPJ {item.empresa_matriz_cnpj}
          </Text>
        ) : null}
        {item.email ? (
          <Text style={styles.clienteMeta} numberOfLines={1}>
            {item.email}
          </Text>
        ) : null}
        {item.telefone ? (
          <Text style={styles.clienteMeta} numberOfLines={1}>
            {item.telefone}
          </Text>
        ) : null}
        <Pressable
          style={[styles.nfBtn, !item.pode_emitir_nf && styles.nfBtnDisabled]}
          onPress={() => pedirEmitirNf(item)}
          disabled={!item.pode_emitir_nf}
        >
          <Ionicons
            name="receipt-outline"
            size={14}
            color={item.pode_emitir_nf ? colors.orange : colors.gray400}
          />
          <Text style={[styles.nfBtnTxt, !item.pode_emitir_nf && styles.nfBtnTxtDisabled]}>
            Emitir NFS-e
          </Text>
        </Pressable>
      </Card>
    );
  };

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>AZOUP - WEB</Text>
        <Text style={styles.heroTitle}>Painel SaaS</Text>
        <Text style={styles.heroLead}>
          Clientes, planos e MRR (líquido e valor cheio). Emita NFS-e dos assinantes com CNPJ.
        </Text>
        {data ? (
          <Text style={styles.heroUpdated}>
            Atualizado {formatDateTimeBRFromISO(data.gerado_em) || 'agora'} · fonte{' '}
            {data.mrr_fonte === 'stripe' ? 'Stripe (cupons)' : 'local'}
          </Text>
        ) : null}
      </View>

      {error ? (
        <Card style={styles.errorCard}>
          <Ionicons name="warning-outline" size={18} color={colors.danger} />
          <Text style={styles.errorTxt}>{error}</Text>
        </Card>
      ) : null}

      {loading && !data ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.orange} />
          <Text style={styles.loadingTxt}>Carregando assinantes…</Text>
        </View>
      ) : null}

      {data ? (
        <>
          <Card style={styles.mrrCard} padded={false}>
            <View style={styles.mrrInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mrrLabel}>MRR líquido (após cupom)</Text>
                <Text style={styles.mrrValue}>{formatBRL(centavosParaReais(data.mrr_centavos))}</Text>
                <Text style={styles.mrrSub}>
                  Valor cheio: {formatBRL(centavosParaReais(data.mrr_bruto_centavos))}
                  {data.desconto_centavos > 0
                    ? ` · Descontos: ${formatBRL(centavosParaReais(data.desconto_centavos))}`
                    : ''}
                </Text>
                <Text style={styles.mrrSub}>
                  {data.clientes_assinatura_ativa} ativas
                  {data.assinaturas_com_desconto > 0
                    ? ` · ${data.assinaturas_com_desconto} com cupom`
                    : data.mrr_fonte === 'stripe'
                      ? ' · nenhum cupom no próximo ciclo'
                      : ' · configure AZOUP_STRIPE_SECRET_KEY p/ cupons'}
                </Text>
              </View>
              <View style={styles.mrrBadge}>
                <Ionicons name="trending-up" size={26} color={colors.orange} />
              </View>
            </View>
          </Card>

          {nfMsg ? (
            <Card style={styles.nfMsgCard}>
              <Text style={styles.nfMsgTxt}>{nfMsg}</Text>
            </Card>
          ) : null}

          <View style={styles.metricsGrid}>
            <MetricPill
              label="Clientes"
              value={String(data.total_clientes)}
              icon="people-outline"
              tone="orange"
            />
            <MetricPill
              label="Ativos"
              value={String(data.clientes_assinatura_ativa)}
              icon="checkmark-circle-outline"
              tone="green"
            />
            <MetricPill
              label="Trial"
              value={String(data.clientes_trial)}
              icon="time-outline"
              tone="blue"
            />
            <MetricPill
              label="Inadimpl."
              value={String(data.clientes_inadimplentes)}
              icon="alert-circle-outline"
              tone="red"
            />
            <MetricPill
              label="Cancelados"
              value={String(data.clientes_cancelados)}
              icon="close-circle-outline"
              tone="muted"
            />
          </View>

          {data.planos_clientes.length > 0 ? (
            <Card style={styles.planosCard}>
              <Text style={styles.sectionTitle}>Clientes por plano</Text>
              <Text style={styles.sectionHint}>Ativos + trial vs. inativos</Text>
              {data.planos_clientes.map((p) => {
                const pct = Math.round((p.total / maxPlano) * 100);
                return (
                  <View key={p.plano_id} style={styles.planoRow}>
                    <View style={styles.planoHead}>
                      <Text style={styles.planoNome} numberOfLines={1}>
                        {p.nome}
                      </Text>
                      <Text style={styles.planoTotal}>{p.total}</Text>
                    </View>
                    <View style={styles.planoBarBg}>
                      <View style={[styles.planoBarFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.planoMeta}>
                      {p.ativos} ativos · {p.inativos} inativos
                    </Text>
                  </View>
                );
              })}
            </Card>
          ) : null}

          <Text style={styles.sectionTitle}>Clientes</Text>
          <Text style={styles.sectionHint}>
            {filteredClientes.length} de {data.clientes.length} na lista
          </Text>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.gray400} />
            <TextInput
              style={styles.searchIn}
              placeholder="Buscar nome, e-mail, telefone ou plano"
              placeholderTextColor={colors.gray400}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.gray400} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.chipsRow}>
            {STATUS_OPTS.map((o) => {
              const active = statusFilter === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => setStatusFilter(o.id)}
                  style={[styles.chip, active && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );

  const listFooter =
    !loading && filteredClientes.length > 0 ? (
      <View style={styles.paginacao}>
        <Pressable
          style={[styles.paginaBtn, pagina === 1 && styles.paginaBtnDisabled]}
          onPress={() => setPagina((p) => Math.max(1, p - 1))}
          disabled={pagina === 1}
        >
          <Ionicons
            name="chevron-back"
            size={14}
            color={pagina === 1 ? colors.gray400 : colors.petroleum}
          />
          <Text style={[styles.paginaBtnTxt, pagina === 1 && styles.paginaBtnTxtDisabled]}>
            Anterior
          </Text>
        </Pressable>
        <Text style={styles.paginaInfo}>
          Página {pagina} de {totalPaginas}
        </Text>
        <Pressable
          style={[styles.paginaBtn, pagina === totalPaginas && styles.paginaBtnDisabled]}
          onPress={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
          disabled={pagina === totalPaginas}
        >
          <Text
            style={[styles.paginaBtnTxt, pagina === totalPaginas && styles.paginaBtnTxtDisabled]}
          >
            Próxima
          </Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={pagina === totalPaginas ? colors.gray400 : colors.petroleum}
          />
        </Pressable>
      </View>
    ) : null;

  return (
    <View style={styles.root}>
      <FlatList
        data={clientesPagina}
        keyExtractor={(c) => c.id}
        renderItem={renderCliente}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />
        }
        ListEmptyComponent={
          !loading && data ? (
            <Text style={styles.empty}>Nenhum cliente com os filtros atuais.</Text>
          ) : null
        }
      />
      <ConfirmarEmitirNfseModal
        visible={Boolean(nfCliente)}
        titulo="Emitir NFS-e Azoup?"
        descricao={
          nfCliente
            ? `Gera NFS-e de ${formatBRL(centavosParaReais(nfCliente.valor_centavos))} para ${nfCliente.nome}${
                nfCliente.empresa_matriz_cnpj ? ` (CNPJ ${nfCliente.empresa_matriz_cnpj})` : ''
              }. O cadastro local será criado/atualizado automaticamente.`
            : ''
        }
        botaoPrimario="Gerar e emitir NFS-e"
        botaoSecundario="Cancelar"
        loading={nfLoading}
        onClose={() => {
          if (!nfLoading) setNfCliente(null);
        }}
        onEmitir={(emitenteId) => void onEmitirNf(emitenteId)}
        onDepois={() => {
          if (!nfLoading) setNfCliente(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray50 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  headerBlock: { marginBottom: spacing.sm },
  hero: { marginBottom: spacing.md, paddingTop: spacing.sm },
  heroEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.orange,
    marginBottom: 6,
  },
  heroTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    letterSpacing: -0.5,
    color: colors.petroleum,
  },
  heroLead: {
    marginTop: 6,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.gray600,
  },
  heroUpdated: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.gray400,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderColor: 'rgba(198,40,40,0.2)',
  },
  errorTxt: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  loadingTxt: {
    fontFamily: fonts.regular,
    color: colors.gray600,
    fontSize: 13,
  },
  mrrCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.petroleum,
    borderWidth: 0,
    overflow: 'hidden',
  },
  mrrInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  mrrLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  mrrValue: {
    marginTop: 4,
    fontFamily: fonts.extrabold,
    fontSize: 30,
    letterSpacing: -0.6,
    color: colors.white,
  },
  mrrSub: {
    marginTop: 6,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 16,
  },
  mrrBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricPill: {
    width: '31%',
    flexGrow: 1,
    minWidth: 100,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    padding: spacing.sm,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  metricLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.gray600,
  },
  metricValue: {
    marginTop: 2,
    fontFamily: fonts.extrabold,
    fontSize: 18,
    letterSpacing: -0.3,
    color: colors.petroleum,
  },
  planosCard: { marginBottom: spacing.lg },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.petroleum,
  },
  sectionHint: {
    marginTop: 2,
    marginBottom: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.gray600,
  },
  planoRow: { marginBottom: spacing.md },
  planoHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: spacing.sm,
  },
  planoNome: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.gray800,
  },
  planoTotal: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.petroleum,
  },
  planoBarBg: {
    height: 6,
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  planoBarFill: {
    height: '100%',
    backgroundColor: colors.orange,
    borderRadius: radius.full,
  },
  planoMeta: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.gray600,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray100,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  searchIn: {
    flex: 1,
    paddingVertical: 8,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.petroleum,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  chipOn: {
    backgroundColor: colors.petroleum,
    borderColor: colors.petroleum,
  },
  chipTxt: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.gray600,
  },
  chipTxtOn: { color: colors.white },
  columnWrapper: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  clienteCard: {
    flex: 1,
    minWidth: 0,
    padding: spacing.sm,
  },
  clienteTop: {
    flexDirection: 'column',
    gap: 6,
    marginBottom: 4,
  },
  clienteNome: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.petroleum,
  },
  statusTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusTagTxt: {
    fontFamily: fonts.bold,
    fontSize: 10,
    textTransform: 'capitalize',
  },
  clientePlano: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.gray800,
    marginTop: 2,
  },
  clientePlanoMuted: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.gray400,
    marginTop: 2,
  },
  clienteValor: {
    marginTop: 6,
    fontFamily: fonts.extrabold,
    fontSize: 15,
    color: colors.orange,
  },
  clienteValorBruto: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.gray600,
  },
  clienteMeta: {
    marginTop: 2,
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.gray600,
  },
  nfBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(234, 88, 12, 0.35)',
    backgroundColor: colors.orangeSoft,
  },
  nfBtnDisabled: {
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
  },
  nfBtnTxt: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.orangeDark,
  },
  nfBtnTxtDisabled: {
    color: colors.gray400,
  },
  nfMsgCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(46, 125, 50, 0.2)',
  },
  nfMsgTxt: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.petroleum,
    lineHeight: 18,
  },
  empty: {
    textAlign: 'center',
    color: colors.gray400,
    marginTop: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  paginacao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  paginaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  paginaBtnDisabled: {
    backgroundColor: colors.gray50,
    borderColor: colors.gray100,
  },
  paginaBtnTxt: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.petroleum,
  },
  paginaBtnTxtDisabled: { color: colors.gray400 },
  paginaInfo: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.gray600,
  },
});
