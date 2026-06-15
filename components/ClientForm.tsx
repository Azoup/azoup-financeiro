import { AddressFormSection } from '@/components/AddressFormSection';
import { ContactListEditor } from '@/components/ContactListEditor';
import { DateMaskedField } from '@/components/DateMaskedField';
import { FormTextInput } from '@/components/FormTextInput';
import { PdfAttachmentSection } from '@/components/PdfAttachmentSection';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SegmentoClientePicker } from '@/components/SegmentoClientePicker';
import { colors, spacing } from '@/theme/colors';
import type { Cliente, ClienteFormValues, ContatoClienteInput } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import { validateClienteForm } from '@/utils/validation';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MaskInput, { Masks } from 'react-native-mask-input';

const emptyContato = (): ContatoClienteInput => ({
  nome_contato: '',
  tipo_contato: 'whatsapp',
  valor_contato: '',
});

export function getEmptyClienteForm(): ClienteFormValues {
  return {
    documento: '',
    nome_cliente: '',
    nome_empresa: '',
    mes_entrada: '',
    valor_mensalidade_anterior: '',
    valor_mensalidade: '',
    segmento_cliente_codigo: '',
    data_inicio: null,
    data_reajuste: null,
    ultimo_reajuste: null,
    observacao: '',
    contatos: [],
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    pdfPath: null,
    pdfLocalUri: null,
    pdfFileName: null,
    cancelado: false,
    cancelamento_justificativa: '',
    emite_nf: false,
  };
}

export function clienteToFormValues(c: Cliente, contatos: ContatoClienteInput[]): ClienteFormValues {
  return {
    documento: c.documento,
    nome_cliente: c.nome_cliente,
    nome_empresa: c.nome_empresa ?? '',
    mes_entrada: c.mes_entrada ?? '',
    valor_mensalidade_anterior:
      c.valor_mensalidade_anterior == null ? '' : formatBRL(c.valor_mensalidade_anterior),
    valor_mensalidade: formatBRL(c.valor_mensalidade),
    segmento_cliente_codigo:
      (c.segmento_cliente_codigo ?? c.segmento_cliente?.codigo ?? '').trim() || 'DIVERSOS',
    data_inicio: parseISODate(c.data_inicio),
    data_reajuste: parseISODate(c.data_reajuste),
    ultimo_reajuste: parseISODate(c.ultimo_reajuste),
    observacao: c.observacao ?? '',
    contatos: contatos.length ? contatos : [],
    cep: c.cep ?? '',
    logradouro: c.logradouro ?? '',
    numero: c.numero ?? '',
    complemento: c.complemento ?? '',
    bairro: c.bairro ?? '',
    cidade: c.cidade ?? '',
    uf: c.uf ?? '',
    pdfPath: c.pdf_path ?? null,
    pdfLocalUri: null,
    pdfFileName: null,
    cancelado: Boolean(c.cancelado),
    cancelamento_justificativa: c.ultima_justificativa_cancelamento?.trim() ?? '',
    emite_nf: Boolean(c.emite_nf),
  };
}

type Props = {
  initial?: ClienteFormValues;
  onSubmit: (values: ClienteFormValues) => Promise<void>;
  submitLabel: string;
};

export function ClientForm({ initial, onSubmit, submitLabel }: Props) {
  const [values, setValues] = useState<ClienteFormValues>(initial ?? getEmptyClienteForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) setValues(initial);
  }, [initial]);

  const submit = async () => {
    const msg = validateClienteForm({
      documento: values.documento,
      nome_cliente: values.nome_cliente,
      valor_mensalidade: values.valor_mensalidade,
      contatos: values.contatos,
      uf: values.uf,
    });
    if (msg) {
      setError(msg);
      return;
    }
    if (values.data_inicio && values.data_reajuste) {
      if (toISODate(values.data_reajuste) < toISODate(values.data_inicio)) {
        setError('Data do reajuste não pode ser anterior ao primeiro vencimento.');
        return;
      }
    }
    if (!values.segmento_cliente_codigo.trim()) {
      setError('Selecione o segmento do cliente.');
      return;
    }
    if (values.cancelado && !values.cancelamento_justificativa.trim()) {
      setError('Informe a justificativa do cancelamento.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onSubmit(values);
    } finally {
      setLoading(false);
    }
  };

  const addressPatch = (patch: Partial<ClienteFormValues>) =>
    setValues((v) => ({ ...v, ...patch }));

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.section}>Dados principais</Text>
      <FormTextInput
        label="Número do documento"
        value={values.documento}
        onChangeText={(t) => setValues((v) => ({ ...v, documento: t }))}
        placeholder="Deixe vazio para gerar ZPF - 1, ZPF - 2… automaticamente"
        autoCapitalize="characters"
      />
      <Text style={styles.hint}>
        Documento único por conta. Vazio no cadastro gera sequência no formato ZPF - número.
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchLabels}>
          <Text style={styles.switchTitle}>Cliente cancelado</Text>
          <Text style={styles.switchHint}>
            Cancelados permanecem no cadastro, mas não entram na contagem e na soma do painel.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Cliente cancelado"
          value={values.cancelado}
          onValueChange={(cancelado) =>
            setValues((v) => ({
              ...v,
              cancelado,
              cancelamento_justificativa: cancelado ? v.cancelamento_justificativa : '',
            }))
          }
          trackColor={{ false: colors.gray200, true: 'rgba(232, 106, 36, 0.45)' }}
          thumbColor={values.cancelado ? colors.orange : colors.gray400}
        />
      </View>
      {values.cancelado ? (
        <FormTextInput
          label="Justificativa do cancelamento"
          value={values.cancelamento_justificativa}
          onChangeText={(t) => setValues((v) => ({ ...v, cancelamento_justificativa: t }))}
          placeholder="Descreva o motivo (obrigatório para cliente cancelado)."
          multiline
          numberOfLines={4}
          style={styles.textArea}
        />
      ) : null}
      <View style={styles.switchRow}>
        <View style={styles.switchLabels}>
          <Text style={styles.switchTitle}>Nota fiscal (NF)</Text>
          <Text style={styles.switchHint}>
            {values.emite_nf
              ? 'Com NF: cliente tratado como que emite ou exige nota fiscal.'
              : 'Sem NF: cliente sem emissão de NF neste cadastro.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Cliente com nota fiscal"
          value={values.emite_nf}
          onValueChange={(emite_nf) => setValues((v) => ({ ...v, emite_nf }))}
          trackColor={{ false: colors.gray200, true: 'rgba(13, 59, 79, 0.35)' }}
          thumbColor={values.emite_nf ? colors.petroleum : colors.gray400}
        />
      </View>
      <FormTextInput
        label="Nome do cliente"
        value={values.nome_cliente}
        onChangeText={(t) => setValues((v) => ({ ...v, nome_cliente: t }))}
      />
      <FormTextInput
        label="Nome da empresa"
        value={values.nome_empresa}
        onChangeText={(t) => setValues((v) => ({ ...v, nome_empresa: t }))}
      />

      <AddressFormSection
        value={{
          cep: values.cep,
          logradouro: values.logradouro,
          numero: values.numero,
          complemento: values.complemento,
          bairro: values.bairro,
          cidade: values.cidade,
          uf: values.uf,
        }}
        onChange={addressPatch}
      />

      <ContactListEditor
        contatos={values.contatos}
        onChange={(contatos) => setValues((v) => ({ ...v, contatos }))}
      />

      <Text style={styles.section}>Financeiro e comercial</Text>
      <Text style={styles.label}>Mês de entrada</Text>
      <MaskInput
        value={values.mes_entrada}
        onChangeText={(masked) => setValues((v) => ({ ...v, mes_entrada: masked }))}
        mask={[/\d/, /\d/, '/', /\d/, /\d/, /\d/, /\d/]}
        placeholder="MM/AAAA"
        keyboardType="number-pad"
        style={styles.mask}
        placeholderTextColor={colors.gray400}
      />

      <View style={styles.readonlyBox}>
        <Text style={styles.label}>Mensalidade antes do último reajuste</Text>
        <Text style={styles.readonlyValue}>
          {values.valor_mensalidade_anterior?.trim()
            ? values.valor_mensalidade_anterior
            : '—'}
        </Text>
        <Text style={styles.readonlyHint}>
          Atualizado ao aplicar reajuste em lote (Gerar mensalidade) ou ao alterar o valor da mensalidade neste cadastro.
        </Text>
      </View>

      <Text style={styles.label}>Mensalidade atual</Text>
      <MaskInput
        value={values.valor_mensalidade}
        onChangeText={(masked) => setValues((v) => ({ ...v, valor_mensalidade: masked }))}
        mask={Masks.BRL_CURRENCY}
        keyboardType="numeric"
        style={styles.mask}
        placeholderTextColor={colors.gray400}
      />

      <SegmentoClientePicker
        valueCodigo={values.segmento_cliente_codigo}
        onChangeCodigo={(segmento_cliente_codigo) =>
          setValues((v) => ({ ...v, segmento_cliente_codigo }))
        }
      />

      <PdfAttachmentSection
        pdfPath={values.pdfPath}
        pdfLocalUri={values.pdfLocalUri}
        pdfFileName={values.pdfFileName}
        onPick={(uri, fileName) =>
          setValues((v) => ({ ...v, pdfLocalUri: uri, pdfFileName: fileName }))
        }
        onRemove={() =>
          setValues((v) => ({
            ...v,
            pdfLocalUri: null,
            pdfFileName: null,
            pdfPath: null,
          }))
        }
      />

      <Text style={styles.section}>Datas para mensalidade</Text>
      <DateMaskedField
        label="Primeiro vencimento"
        value={values.data_inicio}
        onChange={(d) => setValues((v) => ({ ...v, data_inicio: d }))}
      />
      <DateMaskedField
        label="Data do reajuste"
        value={values.data_reajuste}
        onChange={(d) =>
          setValues((v) => {
            if (d == null) {
              return { ...v, data_reajuste: null };
            }
            const prev = v.data_reajuste;
            const same =
              prev != null &&
              toISODate(prev) === toISODate(d);
            if (!same && prev != null) {
              return { ...v, data_reajuste: d, ultimo_reajuste: prev };
            }
            return { ...v, data_reajuste: d };
          })
        }
      />
      <View style={styles.readonlyBox}>
        <Text style={styles.label}>Último reajuste</Text>
        <Text style={styles.readonlyValue}>
          {formatBRDate(values.ultimo_reajuste) || '—'}
        </Text>
        <Text style={styles.readonlyHint}>
          Ao alterar a data de reajuste e salvar, a data anterior passa a aparecer aqui.
        </Text>
      </View>

      <Text style={styles.section}>Observações</Text>
      <FormTextInput
        label="Observações gerais / internas / comerciais"
        value={values.observacao}
        onChangeText={(t) => setValues((v) => ({ ...v, observacao: t }))}
        multiline
        numberOfLines={6}
        style={styles.textArea}
      />

      {error ? <Text style={styles.formError}>{error}</Text> : null}

      <PrimaryButton title={submitLabel} onPress={submit} loading={loading} style={styles.submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xl * 2,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 12,
    color: colors.gray600,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 17,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.gray50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  switchLabels: {
    flex: 1,
  },
  switchTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
  },
  switchHint: {
    fontSize: 11,
    color: colors.gray600,
    marginTop: 4,
    lineHeight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  mask: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.gray800,
    backgroundColor: colors.white,
    marginBottom: spacing.md,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  formError: {
    color: colors.danger,
    marginBottom: spacing.md,
    fontSize: 14,
  },
  submit: {
    marginTop: spacing.md,
  },
  readonlyBox: {
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.gray50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  readonlyValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.petroleum,
    marginTop: 4,
  },
  readonlyHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
  },
});
