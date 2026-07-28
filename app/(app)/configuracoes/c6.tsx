import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  ensureC6Config,
  pickC6CertFile,
  uploadC6CertPair,
  upsertC6Config,
  type C6CertFilePick,
} from '@/services/c6ConfigService';
import { emitenteLabel, ensureEmitentes, updateEmitenteBancoCobranca } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { C6Ambiente, C6ConfigInput } from '@/types/c6';
import type { NfseEmitente } from '@/types/notaFiscal';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function C6ConfigScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [emitenteId, setEmitenteId] = useState<string | null>(null);
  const [values, setValues] = useState<C6ConfigInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [crtFile, setCrtFile] = useState<C6CertFilePick | null>(null);
  const [keyFile, setKeyFile] = useState<C6CertFilePick | null>(null);
  const [hasCerts, setHasCerts] = useState(false);

  const selected = useMemo(
    () => emitentes.find((e) => e.id === emitenteId) ?? null,
    [emitentes, emitenteId],
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      const preferred =
        list.find((e) => e.banco_cobranca === 'c6') ??
        list.find((e) => !e.padrao) ??
        list[0] ??
        null;
      if (!preferred) {
        setEmitenteId(null);
        setValues(null);
        return;
      }
      setEmitenteId(preferred.id);
      const cfg = await ensureC6Config(user.id, preferred.id);
      setValues({
        emitente_id: preferred.id,
        ativo: cfg.ativo,
        ambiente: cfg.ambiente,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        billing_scheme: cfg.billing_scheme || (cfg.ambiente === 'producao' ? '15' : '21'),
        webhook_token: cfg.webhook_token,
      });
      setHasCerts(Boolean(cfg.cert_crt_storage_path && cfg.cert_key_storage_path));
      setCrtFile(null);
      setKeyFile(null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectEmitente = async (id: string) => {
    if (!user?.id) return;
    setEmitenteId(id);
    try {
      const cfg = await ensureC6Config(user.id, id);
      setValues({
        emitente_id: id,
        ativo: cfg.ativo,
        ambiente: cfg.ambiente,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        billing_scheme: cfg.billing_scheme || (cfg.ambiente === 'producao' ? '15' : '21'),
        webhook_token: cfg.webhook_token,
      });
      setHasCerts(Boolean(cfg.cert_crt_storage_path && cfg.cert_key_storage_path));
      setCrtFile(null);
      setKeyFile(null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  const patch = (p: Partial<C6ConfigInput>) => setValues((v) => (v ? { ...v, ...p } : v));

  const webhookUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/boleto/webhook-c6`;
    }
    const base = process.env.EXPO_PUBLIC_NFE_API_URL ?? '';
    return base ? `${base}/api/boleto/webhook-c6` : '/api/boleto/webhook-c6';
  }, []);

  const save = async () => {
    if (!user?.id || !values || !emitenteId) return;
    if (values.ativo) {
      if (!values.client_id.trim()) {
        Toast.show({ type: 'error', text1: 'Informe o Client ID do C6 Developers.' });
        return;
      }
      if (!values.client_secret.trim() && !hasCerts) {
        // secret can be empty only if already saved; check below
      }
      if (!values.client_secret.trim()) {
        const existing = await ensureC6Config(user.id, emitenteId);
        if (!existing.client_secret?.trim()) {
          Toast.show({ type: 'error', text1: 'Informe o Client Secret.' });
          return;
        }
      }
      if (!hasCerts && (!crtFile || !keyFile)) {
        Toast.show({ type: 'error', text1: 'Envie o certificado .crt e a chave .key do C6.' });
        return;
      }
    }

    setSaving(true);
    try {
      let crtPath: string | undefined;
      let keyPath: string | undefined;
      if (crtFile && keyFile) {
        const up = await uploadC6CertPair(user.id, emitenteId, crtFile, keyFile);
        crtPath = up.cert_crt_storage_path;
        keyPath = up.cert_key_storage_path;
      }

      await upsertC6Config(user.id, {
        ...values,
        emitente_id: emitenteId,
        billing_scheme:
          values.billing_scheme?.trim() ||
          (values.ambiente === 'producao' ? '15' : '21'),
        cert_crt_storage_path: crtPath,
        cert_key_storage_path: keyPath,
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

  if (loading || !values) {
    return (
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.orange} />
        ) : (
          <Text style={styles.lead}>
            Cadastre o 2º CNPJ (emitente) em Configurações › NFS-e antes de configurar o C6.
          </Text>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.lead}>
        Vincule o boleto C6 ao CNPJ novo (emitente). O CNPJ antigo continua no Sicoob. Credenciais vêm do Web
        Banking / portal C6 Developers (sandbox primeiro; produção após homologação).
      </Text>

      {emitentes.length > 0 ? (
        <View style={styles.emitBox}>
          <Text style={styles.sectionTitle}>CNPJ emitente (C6)</Text>
          {emitentes.map((e) => {
            const on = e.id === emitenteId;
            return (
              <Pressable
                key={e.id}
                style={[styles.emitOpt, on && styles.emitOptOn]}
                onPress={() => void selectEmitente(e.id)}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={on ? colors.orange : colors.gray400}
                />
                <Text style={styles.emitOptTxt}>{emitenteLabel(e)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.checkRow}>
        <Pressable style={[styles.chip, values.ativo && styles.chipOn]} onPress={() => patch({ ativo: true })}>
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
        {(['sandbox', 'producao'] as C6Ambiente[]).map((amb) => (
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
              {amb === 'sandbox' ? 'Sandbox' : 'Produção'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.status}>
        {hasCerts || (crtFile && keyFile) ? '✓ Certificados mTLS' : '✗ Certificados .crt/.key pendentes'}
        {selected ? ` · ${selected.banco_cobranca === 'c6' ? 'Banco: C6' : 'Marcará banco C6 ao salvar'}` : ''}
      </Text>

      <FormTextInput
        label="Client ID"
        value={values.client_id}
        onChangeText={(t) => patch({ client_id: t })}
        autoCapitalize="none"
      />
      <FormTextInput
        label="Client Secret"
        value={values.client_secret}
        onChangeText={(t) => patch({ client_secret: t })}
        autoCapitalize="none"
        secureTextEntry
        placeholder={hasCerts ? 'Deixe em branco para manter o atual' : undefined}
      />
      <FormTextInput
        label="Billing scheme (21 sandbox / 15 produção)"
        value={values.billing_scheme}
        onChangeText={(t) => patch({ billing_scheme: t })}
        keyboardType="number-pad"
      />

      <Text style={styles.sectionTitle}>Certificado mTLS do C6</Text>
      <Text style={styles.lead}>
        Arquivos gerados em Integrações via API no Web Banking (cert.crt + cert.key).
      </Text>
      <PrimaryButton
        title={crtFile ? `CRT: ${crtFile.name}` : 'Selecionar .crt'}
        variant="ghost"
        onPress={async () => {
          const f = await pickC6CertFile('crt');
          if (f) setCrtFile(f);
        }}
      />
      <PrimaryButton
        title={keyFile ? `KEY: ${keyFile.name}` : 'Selecionar .key'}
        variant="ghost"
        onPress={async () => {
          const f = await pickC6CertFile('key');
          if (f) setKeyFile(f);
        }}
      />

      <Text style={styles.sectionTitle}>Baixa automática</Text>
      <Text style={styles.lead}>
        Cadastre no portal C6 o webhook BANK_SLIP apontando para a URL abaixo. O sistema também consulta boletos
        pendentes no cron e ao abrir A receber.
      </Text>
      <View style={styles.webhookBox}>
        <Text style={styles.webhookLabel}>URL do webhook</Text>
        <Text selectable style={styles.webhookUrl}>
          {webhookUrl}
        </Text>
      </View>
      <FormTextInput
        label="Token do webhook (opcional)"
        value={values.webhook_token ?? ''}
        onChangeText={(t) => patch({ webhook_token: t || null })}
        placeholder="Header x-c6-webhook-token"
        autoCapitalize="none"
      />

      <PrimaryButton title={saving ? 'Salvando…' : 'Salvar'} onPress={() => void save()} disabled={saving} />
      <PrimaryButton title="Cancelar" variant="ghost" onPress={() => router.back()} disabled={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  lead: { fontSize: 13, color: colors.gray600, lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.petroleum, marginTop: spacing.sm },
  status: { fontSize: 13, color: colors.gray600, fontWeight: '600' },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: 'rgba(232, 106, 36, 0.08)' },
  chipTxt: { fontSize: 13, fontWeight: '700', color: colors.gray600 },
  chipTxtOn: { color: colors.orange },
  emitBox: { gap: spacing.sm },
  emitOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  emitOptOn: { borderColor: colors.orange, backgroundColor: 'rgba(232, 106, 36, 0.06)' },
  emitOptTxt: { flex: 1, fontSize: 13, color: colors.gray800, fontWeight: '600' },
  webhookBox: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    padding: spacing.md,
    gap: 4,
  },
  webhookLabel: { fontSize: 12, fontWeight: '700', color: colors.gray600 },
  webhookUrl: { fontSize: 12, color: colors.petroleum, fontFamily: 'monospace' },
});
