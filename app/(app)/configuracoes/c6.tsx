import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  ensureC6Config,
  fetchC6ConfigsByUser,
  pickC6CertPair,
  pickEmitenteC6,
  salvarCertPathsC6,
  uploadC6CertPair,
  upsertC6Config,
} from '@/services/c6ConfigService';
import { C6_ACTIVE_DEFAULTS, onlyDigitsCnpj } from '@/services/c6SandboxDefaults';
import { emitenteLabel, ensureEmitentes, updateEmitenteBancoCobranca } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { C6Ambiente, C6Config, C6ConfigInput } from '@/types/c6';
import type { NfseEmitente } from '@/types/notaFiscal';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

function formatCnpj(digits: string) {
  const d = onlyDigitsCnpj(digits);
  if (d.length !== 14) return digits || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function statusConfig(cfg: C6Config | undefined): 'ok' | 'parcial' | 'vazio' {
  if (!cfg) return 'vazio';
  const id = Boolean(cfg.client_id?.trim());
  const secret = Boolean(cfg.client_secret?.trim());
  const cert = Boolean(cfg.cert_crt_storage_path && cfg.cert_key_storage_path);
  if (id && secret && cert && cfg.ativo) return 'ok';
  if (id || secret || cert) return 'parcial';
  return 'vazio';
}

function statusLabel(s: 'ok' | 'parcial' | 'vazio') {
  if (s === 'ok') return 'Pronto';
  if (s === 'parcial') return 'Incompleto';
  return 'Não configurado';
}

export default function C6ConfigScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [configsByEmitente, setConfigsByEmitente] = useState<Map<string, C6Config>>(new Map());
  const [emitenteId, setEmitenteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [temCertUpload, setTemCertUpload] = useState(false);
  const [secretAlterado, setSecretAlterado] = useState(false);
  const [temSecretSalvo, setTemSecretSalvo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState<C6ConfigInput>({
    emitente_id: '',
    ativo: true,
    ambiente: C6_ACTIVE_DEFAULTS.ambiente,
    client_id: '',
    client_secret: '',
    billing_scheme: C6_ACTIVE_DEFAULTS.billing_scheme,
    webhook_token: null,
  });

  const emitente = useMemo(
    () => emitentes.find((e) => e.id === emitenteId) ?? null,
    [emitentes, emitenteId],
  );

  const webhookUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/boleto/webhook-sicoob?banco=c6`;
    }
    const base = process.env.EXPO_PUBLIC_NFE_API_URL ?? '';
    return base ? `${base}/api/boleto/webhook-sicoob?banco=c6` : '/api/boleto/webhook-sicoob?banco=c6';
  }, []);

  const refreshStatuses = useCallback(async () => {
    if (!user?.id) return;
    const list = await fetchC6ConfigsByUser(user.id);
    setConfigsByEmitente(new Map(list.map((c) => [c.emitente_id, c])));
  }, [user?.id]);

  const applyConfigToForm = useCallback((id: string, cfg: C6Config) => {
    setValues({
      emitente_id: id,
      ativo: cfg.ativo !== false,
      ambiente: cfg.ambiente === 'sandbox' ? 'sandbox' : 'producao',
      client_id: cfg.client_id || '',
      client_secret: '',
      billing_scheme: cfg.billing_scheme || (cfg.ambiente === 'sandbox' ? '21' : '15'),
      webhook_token: cfg.webhook_token,
      cert_crt_storage_path: cfg.cert_crt_storage_path,
      cert_key_storage_path: cfg.cert_key_storage_path,
    });
    setTemSecretSalvo(Boolean(cfg.client_secret?.trim()));
    setSecretAlterado(false);
    setTemCertUpload(Boolean(cfg.cert_crt_storage_path && cfg.cert_key_storage_path));
    setDirty(false);
  }, []);

  const loadConfigForEmitente = useCallback(
    async (id: string) => {
      if (!user?.id) return;
      const cfg = await ensureC6Config(user.id, id);
      applyConfigToForm(id, cfg);
      setConfigsByEmitente((prev) => {
        const next = new Map(prev);
        next.set(id, cfg);
        return next;
      });
    },
    [user?.id, applyConfigToForm],
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      await refreshStatuses();
      if (!list.length) {
        setEmitenteId(null);
        return;
      }
      const preferred = pickEmitenteC6(list) ?? list[0];
      setEmitenteId(preferred.id);
      await loadConfigForEmitente(preferred.id);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id, loadConfigForEmitente, refreshStatuses]);

  useEffect(() => {
    void load();
  }, [load]);

  const trocarEmitente = async (id: string) => {
    if (!user?.id || id === emitenteId) return;

    const go = async () => {
      setEmitenteId(id);
      setLoading(true);
      try {
        await loadConfigForEmitente(id);
      } catch (e) {
        Toast.show({ type: 'error', text1: (e as Error).message });
      } finally {
        setLoading(false);
      }
    };

    if (dirty) {
      const msg =
        'Há alterações não salvas neste CNPJ. Trocar agora descarta as mudanças. Continuar?';
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.confirm(msg)) await go();
      } else {
        Alert.alert('Alterações não salvas', msg, [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Descartar', style: 'destructive', onPress: () => void go() },
        ]);
      }
      return;
    }
    await go();
  };

  const patch = (p: Partial<C6ConfigInput>) => {
    setDirty(true);
    setValues((v) => ({ ...v, ...p }));
  };

  const save = async () => {
    if (!user?.id || !emitenteId) return;
    if (values.ativo) {
      if (!values.client_id.trim()) {
        Toast.show({ type: 'error', text1: 'Informe o Client ID deste CNPJ no portal C6.' });
        return;
      }
      if (!secretAlterado && !temSecretSalvo) {
        Toast.show({ type: 'error', text1: 'Informe o Client Secret deste CNPJ.' });
        return;
      }
    }
    setSaving(true);
    try {
      const ambiente = values.ambiente;
      await upsertC6Config(user.id, {
        emitente_id: emitenteId,
        ativo: values.ativo,
        ambiente,
        client_id: values.client_id.trim(),
        client_secret: secretAlterado ? values.client_secret.trim() : '',
        billing_scheme:
          values.billing_scheme.trim() || (ambiente === 'producao' ? '15' : '21'),
        webhook_token: values.webhook_token,
        cert_crt_storage_path: values.cert_crt_storage_path,
        cert_key_storage_path: values.cert_key_storage_path,
      });
      // Este CNPJ passa a cobrar via C6 com as credenciais salvas acima.
      await updateEmitenteBancoCobranca(user.id, emitenteId, 'c6');
      setEmitentes((prev) =>
        prev.map((e) => (e.id === emitenteId ? { ...e, banco_cobranca: 'c6' } : e)),
      );
      await refreshStatuses();
      setDirty(false);
      setTemSecretSalvo(temSecretSalvo || secretAlterado);
      setSecretAlterado(false);
      setValues((v) => ({ ...v, client_secret: '' }));
      if (!temCertUpload) {
        Toast.show({
          type: 'info',
          text1: 'Credenciais salvas — falta o certificado',
          text2:
            'Clique em “Enviar certificados”, escolha o .crt e depois o .key deste CNPJ no portal C6.',
          visibilityTime: 10000,
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'Configuração salva para este CNPJ',
          text2: emitente ? emitenteLabel(emitente) : undefined,
        });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const uploadCerts = async () => {
    if (!user?.id || !emitenteId) return;
    try {
      Toast.show({
        type: 'info',
        text1: 'Selecione os 2 arquivos juntos',
        text2: 'No seletor, marque o .crt e o .key ao mesmo tempo (Ctrl/Cmd + clique).',
        visibilityTime: 6000,
      });
      const pair = await pickC6CertPair();
      if (!pair) {
        Toast.show({
          type: 'error',
          text1: 'Selecione os dois arquivos',
          text2: 'É preciso marcar .crt e .key juntos no mesmo envio.',
          visibilityTime: 8000,
        });
        return;
      }
      setUploadingCert(true);
      const paths = await uploadC6CertPair(user.id, emitenteId, pair.crt, pair.key);
      const refreshed = await salvarCertPathsC6(user.id, emitenteId, paths);
      applyConfigToForm(emitenteId, refreshed);
      setTemCertUpload(true);
      await refreshStatuses();
      Toast.show({
        type: 'success',
        text1: 'Certificados salvos neste CNPJ',
        text2: `${pair.crt.name} + ${pair.key.name}`,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message, visibilityTime: 10000 });
    } finally {
      setUploadingCert(false);
    }
  };

  if (loading && !emitente) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (!emitentes.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.lead}>
          Cadastre os dois CNPJs como emitentes em Configurações › NFS-e. Depois configure Client ID,
          Secret e certificado de cada um aqui.
        </Text>
        <PrimaryButton title="Voltar" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.lead}>
        Cada CNPJ tem Client ID, Client Secret e certificado mTLS próprios. Ao gerar boleto, o sistema
        usa a configuração do CNPJ cobrador daquele cliente (ou o escolhido na geração).
      </Text>

      <Text style={styles.sectionTitle}>1. Escolha o CNPJ</Text>
      <View style={styles.emitList}>
        {emitentes.map((e) => {
          const on = e.id === emitenteId;
          const st = statusConfig(configsByEmitente.get(e.id));
          return (
            <Pressable
              key={e.id}
              style={[styles.emitOpt, on && styles.emitOptOn]}
              onPress={() => void trocarEmitente(e.id)}
            >
              <View style={styles.emitOptTop}>
                <Text style={[styles.emitOptTxt, on && styles.emitOptTxtOn]} numberOfLines={2}>
                  {emitenteLabel(e)}
                </Text>
                <View
                  style={[
                    styles.badge,
                    st === 'ok' && styles.badgeOk,
                    st === 'parcial' && styles.badgeParcial,
                  ]}
                >
                  <Text style={styles.badgeTxt}>{statusLabel(st)}</Text>
                </View>
              </View>
              <Text style={styles.emitOptSub}>
                CNPJ {formatCnpj(e.documento)} ·{' '}
                {e.banco_cobranca === 'c6' ? 'Cobra no C6' : 'Ainda não marcado como C6'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {emitente ? (
        <Text style={styles.editingHint}>
          Editando agora: {emitenteLabel(emitente)}
          {dirty ? ' · alterações não salvas' : ''}
        </Text>
      ) : null}

      <Text style={styles.sectionTitle}>2. Credenciais deste CNPJ</Text>

      <View style={styles.checkRow}>
        <Pressable
          style={[styles.chip, values.ativo && styles.chipOn]}
          onPress={() => patch({ ativo: true })}
        >
          <Text style={[styles.chipTxt, values.ativo && styles.chipTxtOn]}>Ativo</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, !values.ativo && styles.chipOn]}
          onPress={() => patch({ ativo: false })}
        >
          <Text style={[styles.chipTxt, !values.ativo && styles.chipTxtOn]}>Inativo</Text>
        </Pressable>
      </View>

      <View style={styles.checkRow}>
        {(['producao', 'sandbox'] as C6Ambiente[]).map((amb) => (
          <Pressable
            key={amb}
            style={[styles.chip, values.ambiente === amb && styles.chipOn]}
            onPress={() =>
              patch({
                ambiente: amb,
                billing_scheme: amb === 'producao' ? '15' : '21',
              })
            }
          >
            <Text style={[styles.chipTxt, values.ambiente === amb && styles.chipTxtOn]}>
              {amb === 'producao' ? 'Produção' : 'Homologação'}
            </Text>
          </Pressable>
        ))}
      </View>

      <FormTextInput
        label="Client ID (deste CNPJ)"
        value={values.client_id}
        onChangeText={(t) => patch({ client_id: t })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="UUID do aplicativo C6 deste CNPJ"
      />
      <FormTextInput
        label="Client Secret (deste CNPJ)"
        value={values.client_secret}
        onChangeText={(t) => {
          setSecretAlterado(true);
          patch({ client_secret: t });
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder={
          temSecretSalvo && !secretAlterado
            ? '•••••••• (salvo — digite para trocar)'
            : 'Secret do aplicativo C6 deste CNPJ'
        }
      />
      <FormTextInput
        label="Billing scheme (carteira)"
        value={values.billing_scheme}
        onChangeText={(t) => patch({ billing_scheme: t.replace(/\D/g, '').slice(0, 4) })}
        keyboardType="number-pad"
        placeholder={values.ambiente === 'producao' ? '15' : '21'}
      />

      <Text style={styles.sectionTitle}>3. Certificado mTLS deste CNPJ</Text>
      <Text style={styles.hint}>
        No portal C6, baixe o .crt e o .key deste CNPJ. No botão abaixo, selecione os dois arquivos no
        mesmo envio (Ctrl ou Cmd + clique). Não use o certificado A1 da NFS-e — é outro arquivo.
      </Text>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Status</Text>
        <Text style={[styles.boxValue, !temCertUpload && styles.boxWarn]}>
          {temCertUpload ? 'Certificados deste CNPJ salvos ✓' : 'Pendente — envie .crt e .key juntos'}
        </Text>
      </View>
      <PrimaryButton
        title={
          temCertUpload
            ? 'Trocar certificados deste CNPJ (.crt + .key)'
            : 'Enviar .crt e .key deste CNPJ'
        }
        variant="secondary"
        onPress={() => void uploadCerts()}
        loading={uploadingCert}
        disabled={saving || !emitenteId}
      />
      {!temCertUpload ? (
        <Text style={styles.warn}>
          Sem o certificado, Client ID/Secret podem ser salvos, mas o boleto deste CNPJ não registra no
          C6 até enviar o par .crt + .key.
        </Text>
      ) : null}

      <Text style={styles.sectionTitle}>Webhook (baixa automática)</Text>
      <View style={styles.box}>
        <Text selectable style={styles.boxValue}>
          {webhookUrl}
        </Text>
      </View>
      <FormTextInput
        label="Token do webhook (opcional, deste CNPJ)"
        value={values.webhook_token ?? ''}
        onChangeText={(t) => patch({ webhook_token: t || null })}
        autoCapitalize="none"
        placeholder="Se o C6 exigir autenticação no webhook"
      />

      <PrimaryButton
        title={
          emitente
            ? `Salvar configuração — ${formatCnpj(emitente.documento)}`
            : 'Salvar configuração C6'
        }
        onPress={() => void save()}
        loading={saving}
      />
      <PrimaryButton
        title="Voltar"
        variant="ghost"
        onPress={() => router.back()}
        disabled={saving}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.gray50,
  },
  lead: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.gray600, lineHeight: 17, marginTop: -4 },
  editingHint: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.orange,
    lineHeight: 17,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.petroleum, marginTop: spacing.sm },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.petroleum, borderColor: colors.petroleum },
  chipTxt: { fontSize: 13, fontWeight: '600', color: colors.gray700 },
  chipTxtOn: { color: colors.white },
  emitList: { gap: spacing.sm },
  emitOpt: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.white,
    gap: 6,
  },
  emitOptOn: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.06)',
  },
  emitOptTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  emitOptTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.petroleum },
  emitOptTxtOn: { color: colors.petroleum },
  emitOptSub: { fontSize: 11, color: colors.gray600 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.gray200,
  },
  badgeOk: { backgroundColor: '#D1FAE5' },
  badgeParcial: { backgroundColor: '#FEF3C7' },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: colors.petroleum },
  box: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    padding: spacing.md,
    gap: 6,
  },
  boxLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray600,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  boxValue: { fontSize: 13, color: colors.petroleum, fontWeight: '600' },
  boxWarn: { color: colors.orange },
  warn: { fontSize: 12, color: colors.orange, fontWeight: '600', lineHeight: 17 },
});
