import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { fetchCertificadoAtivo } from '@/services/nfeConfigService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import {
  ensureSicoobConfig,
  sicoobConfigDefaults,
  upsertSicoobConfig,
} from '@/services/sicoobConfigService';
import { colors, spacing } from '@/theme/colors';
import type { SicoobAmbiente, SicoobConfigInput } from '@/types/sicoob';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function SicoobConfigScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [values, setValues] = useState<SicoobConfigInput>(sicoobConfigDefaults());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [certOk, setCertOk] = useState(false);
  const [perfilOk, setPerfilOk] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [cfg, cert, perfil] = await Promise.all([
        ensureSicoobConfig(user.id),
        fetchCertificadoAtivo(user.id),
        fetchPerfilCobranca(user.id),
      ]);
      setValues({
        ativo: cfg.ativo,
        ambiente: cfg.ambiente,
        client_id: cfg.client_id,
        numero_cliente: cfg.numero_cliente,
        numero_conta_corrente: cfg.numero_conta_corrente,
        codigo_modalidade: cfg.codigo_modalidade,
        codigo_especie_documento: cfg.codigo_especie_documento,
        identificacao_emissao_boleto: cfg.identificacao_emissao_boleto,
        identificacao_distribuicao_boleto: cfg.identificacao_distribuicao_boleto,
        gerar_pix_boleto: cfg.gerar_pix_boleto,
        webhook_token: cfg.webhook_token,
      });
      setCertOk(Boolean(cert));
      setPerfilOk(Boolean(perfil?.razao_social?.trim() && perfil?.documento?.trim()));
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
    if (!user?.id) return;
    if (values.ativo) {
      if (!values.client_id.trim()) {
        Toast.show({ type: 'error', text1: 'Informe o Client ID do portal Developers Sicoob.' });
        return;
      }
      if (!values.numero_cliente) {
        Toast.show({ type: 'error', text1: 'Informe o número do cliente (convênio) Sicoob.' });
        return;
      }
      if (!certOk) {
        Toast.show({ type: 'error', text1: 'Cadastre o certificado A1 em Configurações › NFS-e.' });
        return;
      }
      if (!perfilOk) {
        Toast.show({ type: 'error', text1: 'Preencha o perfil do beneficiário.' });
        return;
      }
    }
    setSaving(true);
    try {
      await upsertSicoobConfig(user.id, values);
      Toast.show({ type: 'success', text1: 'Configuração Sicoob salva.' });
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

  const patch = (p: Partial<SicoobConfigInput>) => setValues((v) => ({ ...v, ...p }));

  const webhookUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/boleto/webhook-sicoob`;
    }
    const base = process.env.EXPO_PUBLIC_NFE_API_URL ?? '';
    return base ? `${base}/api/boleto/webhook-sicoob` : '/api/boleto/webhook-sicoob';
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.lead}>
        Ao ativar, todo carnê gerado em vendas e mensalidades será registrado na API Cobrança Bancária Sicoob V3
        (com ou sem NFS-e). O certificado A1 é o mesmo da NFS-e.
      </Text>

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
          <Text style={[styles.chipTxt, !values.ativo && styles.chipTxtOn]}>Inativo (só carnê)</Text>
        </Pressable>
      </View>

      <View style={styles.checkRow}>
        {(['sandbox', 'producao'] as SicoobAmbiente[]).map((amb) => (
          <Pressable
            key={amb}
            style={[styles.chip, values.ambiente === amb && styles.chipOn]}
            onPress={() => patch({ ambiente: amb })}
          >
            <Text style={[styles.chipTxt, values.ambiente === amb && styles.chipTxtOn]}>
              {amb === 'sandbox' ? 'Homologação' : 'Produção'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.status}>
        {certOk ? '✓ Certificado A1' : '✗ Certificado A1 pendente'} ·{' '}
        {perfilOk ? '✓ Beneficiário' : '✗ Beneficiário pendente'}
      </Text>

      <FormTextInput
        label="Client ID (Portal Developers)"
        value={values.client_id}
        onChangeText={(t) => patch({ client_id: t })}
        autoCapitalize="none"
      />
      <FormTextInput
        label="Número do cliente / convênio"
        value={String(values.numero_cliente || '')}
        onChangeText={(t) => patch({ numero_cliente: Number(t.replace(/\D/g, '')) || 0 })}
        keyboardType="number-pad"
      />
      <FormTextInput
        label="Número da conta corrente"
        value={String(values.numero_conta_corrente || '')}
        onChangeText={(t) => patch({ numero_conta_corrente: Number(t.replace(/\D/g, '')) || 0 })}
        keyboardType="number-pad"
      />
      <FormTextInput
        label="Código modalidade"
        value={String(values.codigo_modalidade)}
        onChangeText={(t) => patch({ codigo_modalidade: Number(t) || 1 })}
        keyboardType="number-pad"
      />
      <FormTextInput
        label="Espécie do documento"
        value={values.codigo_especie_documento}
        onChangeText={(t) => patch({ codigo_especie_documento: t })}
        placeholder="DM"
      />

      <Text style={styles.sectionTitle}>Baixa automática</Text>
      <Text style={styles.lead}>
        O sistema consulta boletos pagos a cada 30 min (cron) e ao abrir A receber. Configure também o webhook no
        portal Sicoob apontando para a URL abaixo.
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
        placeholder="Mesmo valor no header x-sicoob-webhook-token"
        autoCapitalize="none"
      />
      {Platform.OS === 'web' ? null : (
        <Text style={styles.lead}>
          Em app nativo, use a URL pública da Vercel em EXPO_PUBLIC_NFE_API_URL para o webhook.
        </Text>
      )}

      <PrimaryButton title="Salvar configuração Sicoob" onPress={save} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.gray50 },
  lead: { fontSize: 14, color: colors.gray600, lineHeight: 21 },
  checkRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  chipOn: { backgroundColor: colors.petroleum },
  chipTxt: { fontWeight: '700', color: colors.gray700 },
  chipTxtOn: { color: colors.white },
  status: { fontSize: 13, color: colors.gray600, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.petroleum, marginTop: spacing.sm },
  webhookBox: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  webhookLabel: { fontSize: 12, fontWeight: '700', color: colors.gray600, marginBottom: 6 },
  webhookUrl: { fontSize: 13, color: colors.petroleum },
});
