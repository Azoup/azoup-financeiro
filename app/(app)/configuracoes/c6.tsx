import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { ensureC6Config, pickEmitenteC6, upsertC6Config } from '@/services/c6ConfigService';
import { C6_CNPJ_COBRADOR, C6_SANDBOX_DEFAULTS } from '@/services/c6SandboxDefaults';
import { emitenteLabel, ensureEmitentes, updateEmitenteBancoCobranca } from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente } from '@/types/notaFiscal';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

function formatCnpj(digits: string) {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export default function C6ConfigScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [emitente, setEmitente] = useState<NfseEmitente | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ativo, setAtivo] = useState(true);

  const webhookUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/boleto/webhook-sicoob?banco=c6`;
    }
    const base = process.env.EXPO_PUBLIC_NFE_API_URL ?? '';
    return base ? `${base}/api/boleto/webhook-sicoob?banco=c6` : '/api/boleto/webhook-sicoob?banco=c6';
  }, []);

  const cnpjFmt = formatCnpj(C6_CNPJ_COBRADOR);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      const preferred = pickEmitenteC6(list);
      if (!preferred) {
        setEmitente(null);
        return;
      }
      setEmitente(preferred);
      const cfg = await ensureC6Config(user.id, preferred.id);
      setAtivo(cfg.ativo !== false);
      if (preferred.banco_cobranca !== 'c6') {
        await updateEmitenteBancoCobranca(user.id, preferred.id, 'c6').catch(() => undefined);
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user?.id || !emitente) return;
    setSaving(true);
    try {
      await upsertC6Config(user.id, {
        emitente_id: emitente.id,
        ativo,
        ambiente: C6_SANDBOX_DEFAULTS.ambiente,
        client_id: C6_SANDBOX_DEFAULTS.client_id,
        client_secret: C6_SANDBOX_DEFAULTS.client_secret,
        billing_scheme: C6_SANDBOX_DEFAULTS.billing_scheme,
        webhook_token: null,
      });
      await updateEmitenteBancoCobranca(user.id, emitente.id, 'c6');
      Toast.show({ type: 'success', text1: `C6 ativo no CNPJ ${cnpjFmt} (sandbox).` });
      router.back();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (!emitente) {
    return (
      <View style={styles.center}>
        <Text style={styles.lead}>
          Cadastre o CNPJ {cnpjFmt} como emitente em Configurações › NFS-e. Esse é o CNPJ liberado no C6.
        </Text>
        <PrimaryButton title="Voltar" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Integração C6 (sandbox): boleto registrado, Pix e consulta de transações/recebíveis. CNPJ cobrador
        liberado no portal: {cnpjFmt}. Credenciais e certificados mTLS já estão embutidos.
      </Text>

      <Text style={styles.sectionTitle}>CNPJ cobrador C6</Text>
      <View style={styles.box}>
        <Text style={styles.boxValue}>{emitenteLabel(emitente)}</Text>
        <Text style={styles.boxLabel}>Esperado no portal C6</Text>
        <Text style={styles.boxValue}>{cnpjFmt}</Text>
      </View>

      <Text style={styles.sectionTitle}>Credenciais sandbox (fixas)</Text>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Client ID</Text>
        <Text selectable style={styles.boxValue}>
          {C6_SANDBOX_DEFAULTS.client_id}
        </Text>
        <Text style={styles.boxLabel}>Client Secret</Text>
        <Text selectable style={styles.boxValue}>
          {C6_SANDBOX_DEFAULTS.client_secret}
        </Text>
        <Text style={styles.boxLabel}>Chave PIX</Text>
        <Text selectable style={styles.boxValue}>
          {C6_SANDBOX_DEFAULTS.pix_chave}
        </Text>
        <Text style={styles.boxLabel}>Ambiente</Text>
        <Text style={styles.boxValue}>Sandbox · billing scheme 21</Text>
        <Text style={styles.boxLabel}>Certificados</Text>
        <Text style={styles.boxValue}>sandbox.crt + sandbox.key (API)</Text>
      </View>

      <Text style={styles.sectionTitle}>Webhook (baixa automática)</Text>
      <View style={styles.box}>
        <Text selectable style={styles.boxValue}>
          {webhookUrl}
        </Text>
      </View>

      <PrimaryButton
        title={ativo ? 'Manter ativo e salvar' : 'Ativar C6 neste CNPJ'}
        onPress={() => {
          setAtivo(true);
          void save();
        }}
        loading={saving}
      />
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
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.petroleum, marginTop: spacing.sm },
  box: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    padding: spacing.md,
    gap: 6,
  },
  boxLabel: { fontSize: 11, fontWeight: '700', color: colors.gray600, marginTop: 6, textTransform: 'uppercase' },
  boxValue: { fontSize: 13, color: colors.petroleum, fontWeight: '600' },
  warn: { fontSize: 12, color: colors.orange, marginTop: 6, fontWeight: '600' },
});
