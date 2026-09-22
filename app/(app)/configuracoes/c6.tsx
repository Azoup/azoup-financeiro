import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  ensureC6Config,
  pickC6CertFile,
  pickEmitenteC6,
  uploadC6CertPair,
  upsertC6Config,
} from '@/services/c6ConfigService';
import { C6_ACTIVE_DEFAULTS } from '@/services/c6SandboxDefaults';
import { emitenteLabel, ensureEmitentes, updateEmitenteBancoCobranca } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { C6Ambiente, C6ConfigInput } from '@/types/c6';
import type { NfseEmitente } from '@/types/notaFiscal';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function C6ConfigScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [emitenteId, setEmitenteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [temCertUpload, setTemCertUpload] = useState(false);
  const [secretAlterado, setSecretAlterado] = useState(false);
  const [temSecretSalvo, setTemSecretSalvo] = useState(false);
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

  const loadConfigForEmitente = useCallback(
    async (list: NfseEmitente[], id: string) => {
      if (!user?.id) return;
      const cfg = await ensureC6Config(user.id, id);
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
      const em = list.find((e) => e.id === id);
      if (em && em.banco_cobranca !== 'c6') {
        await updateEmitenteBancoCobranca(user.id, id, 'c6').catch(() => undefined);
      }
    },
    [user?.id],
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      if (!list.length) {
        setEmitenteId(null);
        return;
      }
      const preferred = pickEmitenteC6(list) ?? list.find((e) => e.banco_cobranca === 'c6') ?? list[0];
      setEmitenteId(preferred.id);
      await loadConfigForEmitente(list, preferred.id);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id, loadConfigForEmitente]);

  useEffect(() => {
    void load();
  }, [load]);

  const escolherEmitente = async (id: string) => {
    if (!user?.id || id === emitenteId) return;
    setEmitenteId(id);
    setLoading(true);
    try {
      await loadConfigForEmitente(emitentes, id);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const patch = (p: Partial<C6ConfigInput>) => setValues((v) => ({ ...v, ...p }));

  const save = async () => {
    if (!user?.id || !emitenteId) return;
    if (values.ativo) {
      if (!values.client_id.trim()) {
        Toast.show({ type: 'error', text1: 'Informe o Client ID do portal C6 Developers.' });
        return;
      }
      if (!secretAlterado && !temSecretSalvo) {
        Toast.show({ type: 'error', text1: 'Informe o Client Secret do aplicativo C6.' });
        return;
      }
      if (!temCertUpload) {
        Toast.show({
          type: 'error',
          text1: 'Envie o certificado mTLS (.crt + .key)',
          text2: 'Baixe no portal C6 Developers do CNPJ AZFS e envie abaixo.',
        });
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
      await updateEmitenteBancoCobranca(user.id, emitenteId, 'c6');
      Toast.show({ type: 'success', text1: 'Configuração C6 salva.' });
      router.back();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const uploadCerts = async () => {
    if (!user?.id || !emitenteId) return;
    try {
      const crt = await pickC6CertFile('crt');
      if (!crt) return;
      const key = await pickC6CertFile('key');
      if (!key) {
        Toast.show({ type: 'info', text1: 'Selecione também o arquivo da chave (.key).' });
        return;
      }
      setUploadingCert(true);
      const paths = await uploadC6CertPair(user.id, emitenteId, crt, key);
      patch({
        cert_crt_storage_path: paths.cert_crt_storage_path,
        cert_key_storage_path: paths.cert_key_storage_path,
      });
      await upsertC6Config(user.id, {
        emitente_id: emitenteId,
        ativo: values.ativo,
        ambiente: values.ambiente,
        client_id: values.client_id.trim() || C6_ACTIVE_DEFAULTS.client_id,
        client_secret: secretAlterado ? values.client_secret.trim() : '',
        billing_scheme: values.billing_scheme || C6_ACTIVE_DEFAULTS.billing_scheme,
        webhook_token: values.webhook_token,
        cert_crt_storage_path: paths.cert_crt_storage_path,
        cert_key_storage_path: paths.cert_key_storage_path,
      });
      setTemCertUpload(true);
      Toast.show({
        type: 'success',
        text1: 'Certificados mTLS enviados',
        text2: 'Use o par .crt + .key do CNPJ AZFS no portal C6.',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
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
          Cadastre o CNPJ AZFS (ou outro cobrador C6) como emitente em Configurações › NFS-e antes de
          configurar o boleto C6.
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
        Credenciais do aplicativo C6 Bank (produção ou homologação): Client ID, Client Secret e
        certificado mTLS do CNPJ cobrador (AZFS). Esses dados são usados ao emitir boleto pelo C6.
      </Text>

      <Text style={styles.sectionTitle}>CNPJ cobrador</Text>
      <View style={styles.emitList}>
        {emitentes.map((e) => {
          const on = e.id === emitenteId;
          return (
            <Pressable
              key={e.id}
              style={[styles.emitOpt, on && styles.emitOptOn]}
              onPress={() => void escolherEmitente(e.id)}
            >
              <Text style={[styles.emitOptTxt, on && styles.emitOptTxtOn]}>{emitenteLabel(e)}</Text>
              <Text style={styles.emitOptSub}>
                {e.banco_cobranca === 'c6' ? 'Banco: C6' : 'Marcar como C6 ao salvar'}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
        label="Client ID"
        value={values.client_id}
        onChangeText={(t) => patch({ client_id: t })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="UUID do aplicativo no portal C6 Developers"
      />
      <FormTextInput
        label="Client Secret"
        value={values.client_secret}
        onChangeText={(t) => {
          setSecretAlterado(true);
          patch({ client_secret: t });
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder={temSecretSalvo && !secretAlterado ? '•••••••• (salvo — digite para trocar)' : 'Secret do aplicativo C6'}
      />
      <FormTextInput
        label="Billing scheme (carteira)"
        value={values.billing_scheme}
        onChangeText={(t) => patch({ billing_scheme: t.replace(/\D/g, '').slice(0, 4) })}
        keyboardType="number-pad"
        placeholder={values.ambiente === 'producao' ? '15' : '21'}
      />

      <Text style={styles.sectionTitle}>Certificado mTLS (AZFS)</Text>
      <Text style={styles.hint}>
        No portal C6 Developers, baixe o par .crt + .key do aplicativo vinculado ao CNPJ AZFS e envie
        aqui. Sem isso a emissão em produção falha.
      </Text>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Status</Text>
        <Text style={styles.boxValue}>
          {temCertUpload ? 'Certificados enviados ✓' : 'Pendente — envie .crt e .key'}
        </Text>
        {emitente ? (
          <>
            <Text style={styles.boxLabel}>Emitente</Text>
            <Text style={styles.boxValue}>{emitenteLabel(emitente)}</Text>
          </>
        ) : null}
      </View>
      <PrimaryButton
        title={temCertUpload ? 'Trocar certificados (.crt + .key)' : 'Enviar certificados (.crt + .key)'}
        variant="secondary"
        onPress={() => void uploadCerts()}
        loading={uploadingCert}
        disabled={saving || !emitenteId}
      />

      <Text style={styles.sectionTitle}>Webhook (baixa automática)</Text>
      <View style={styles.box}>
        <Text selectable style={styles.boxValue}>
          {webhookUrl}
        </Text>
      </View>
      <FormTextInput
        label="Token do webhook (opcional)"
        value={values.webhook_token ?? ''}
        onChangeText={(t) => patch({ webhook_token: t || null })}
        autoCapitalize="none"
        placeholder="Se o C6 exigir autenticação no webhook"
      />

      <PrimaryButton title="Salvar configuração C6" onPress={() => void save()} loading={saving} />
      <PrimaryButton title="Voltar" variant="ghost" onPress={() => router.back()} disabled={saving} />
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
    gap: 4,
  },
  emitOptOn: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.06)',
  },
  emitOptTxt: { fontSize: 13, fontWeight: '700', color: colors.petroleum },
  emitOptTxtOn: { color: colors.petroleum },
  emitOptSub: { fontSize: 11, color: colors.gray600 },
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
});
