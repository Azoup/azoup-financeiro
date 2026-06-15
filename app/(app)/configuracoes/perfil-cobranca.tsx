import { ExportReportButtons } from '@/components/ExportReportButtons';
import { FormTextInput } from '@/components/FormTextInput';
import { buildPerfilCobrancaExport } from '@/utils/exportReportBuilders';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { fetchPerfilCobranca, upsertPerfilCobranca } from '@/services/perfilCobrancaService';
import { colors, spacing } from '@/theme/colors';
import type { PerfilCobrancaInput } from '@/types/contasReceber';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

function emptyForm(): PerfilCobrancaInput {
  return {
    razao_social: '',
    documento: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    cep: '',
    cooperativa_nome: null,
    codigo_beneficiario_agencia: null,
    telefone_suporte: null,
    instrucoes_cobranca:
      'Após o vencimento, aplicar encargos conforme contrato. Em caso de dúvidas, contate o beneficiário.',
    local_pagamento: 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
    mensagem_padrao_pagador: null,
  };
}

function fromRow(row: NonNullable<Awaited<ReturnType<typeof fetchPerfilCobranca>>>): PerfilCobrancaInput {
  return {
    razao_social: row.razao_social,
    documento: row.documento,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    cidade: row.cidade,
    uf: row.uf,
    cep: row.cep,
    cooperativa_nome: row.cooperativa_nome,
    codigo_beneficiario_agencia: row.codigo_beneficiario_agencia,
    telefone_suporte: row.telefone_suporte,
    instrucoes_cobranca: row.instrucoes_cobranca,
    local_pagamento: row.local_pagamento,
    mensagem_padrao_pagador: row.mensagem_padrao_pagador,
  };
}

export default function PerfilCobrancaScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [values, setValues] = useState<PerfilCobrancaInput>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const row = await fetchPerfilCobranca(user.id);
      setValues(row ? fromRow(row) : emptyForm());
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
    if (!values.razao_social.trim() || !values.documento.trim()) {
      Toast.show({ type: 'error', text1: 'Preencha ao menos razão social e CNPJ/CPF do beneficiário.' });
      return;
    }
    setSaving(true);
    try {
      await upsertPerfilCobranca(user.id, {
        ...values,
        cooperativa_nome: values.cooperativa_nome?.trim() || null,
        codigo_beneficiario_agencia: values.codigo_beneficiario_agencia?.trim() || null,
        telefone_suporte: values.telefone_suporte?.trim() || null,
        mensagem_padrao_pagador: values.mensagem_padrao_pagador?.trim() || null,
      });
      Toast.show({ type: 'success', text1: 'Dados salvos.' });
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

  const patch = (p: Partial<PerfilCobrancaInput>) => setValues((v) => ({ ...v, ...p }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ExportReportButtons getReport={() => buildPerfilCobrancaExport(values)} />
      <Text style={styles.lead}>
        Estes dados aparecem como beneficiário/cedente nos PDFs gerados em Contas a receber (um por parcela de
        venda). O pagador vem do cadastro do cliente.
      </Text>

      <FormTextInput label="Razão social" value={values.razao_social} onChangeText={(t) => patch({ razao_social: t })} />
      <FormTextInput
        label="CNPJ ou CPF"
        value={values.documento}
        onChangeText={(t) => patch({ documento: t })}
        placeholder="Somente números ou formatado"
      />
      <FormTextInput label="Logradouro" value={values.logradouro} onChangeText={(t) => patch({ logradouro: t })} />
      <FormTextInput label="Número" value={values.numero} onChangeText={(t) => patch({ numero: t })} />
      <FormTextInput
        label="Complemento"
        value={values.complemento}
        onChangeText={(t) => patch({ complemento: t })}
      />
      <FormTextInput label="Bairro" value={values.bairro} onChangeText={(t) => patch({ bairro: t })} />
      <FormTextInput label="Cidade" value={values.cidade} onChangeText={(t) => patch({ cidade: t })} />
      <FormTextInput label="UF" value={values.uf} onChangeText={(t) => patch({ uf: t })} maxLength={2} autoCapitalize="characters" />
      <FormTextInput label="CEP" value={values.cep} onChangeText={(t) => patch({ cep: t })} />

      <FormTextInput
        label="Cooperativa / rodapé (opcional)"
        value={values.cooperativa_nome ?? ''}
        onChangeText={(t) => patch({ cooperativa_nome: t || null })}
        placeholder="Ex.: texto institucional no rodapé do carnê"
      />
      <FormTextInput
        label="Código beneficiário / agência (exibição, opcional)"
        value={values.codigo_beneficiario_agencia ?? ''}
        onChangeText={(t) => patch({ codigo_beneficiario_agencia: t || null })}
        placeholder="Ex.: 5004/1347780"
      />
      <FormTextInput
        label="Telefone suporte (opcional)"
        value={values.telefone_suporte ?? ''}
        onChangeText={(t) => patch({ telefone_suporte: t || null })}
        keyboardType="phone-pad"
      />
      <FormTextInput
        label="Local de pagamento (texto do carnê)"
        value={values.local_pagamento}
        onChangeText={(t) => patch({ local_pagamento: t })}
      />
      <FormTextInput
        label="Instruções de cobrança"
        value={values.instrucoes_cobranca}
        onChangeText={(t) => patch({ instrucoes_cobranca: t })}
        multiline
        numberOfLines={5}
        style={styles.area}
      />
      <FormTextInput
        label="Mensagem ao pagador (opcional)"
        value={values.mensagem_padrao_pagador ?? ''}
        onChangeText={(t) => patch({ mensagem_padrao_pagador: t || null })}
        multiline
        numberOfLines={3}
        style={styles.area}
      />

      <PrimaryButton title="Salvar" onPress={save} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.gray50,
  },
  lead: {
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  area: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
