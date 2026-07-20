import { AddressFormSection } from '@/components/AddressFormSection';
import { Card } from '@/components/Card';
import { ContactListEditor } from '@/components/ContactListEditor';
import { DateMaskedField } from '@/components/DateMaskedField';
import { FormTextInput } from '@/components/FormTextInput';
import { PdfAttachmentSection } from '@/components/PdfAttachmentSection';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SegmentoClientePicker } from '@/components/SegmentoClientePicker';
import { colors, radius, spacing } from '@/theme/colors';
import type { Cliente, ClienteFormValues, ContatoClienteInput } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import {
  PARCELAS_ANUAIS_OPCOES,
  labelTipoFaturamento,
  normalizeTipoFaturamento,
  previewFaturamentoAnual,
  type TipoFaturamento,
} from '@/utils/faturamentoCliente';
import { validateClienteForm } from '@/utils/validation';
import { isCnpjDigitsComplete, isZpfDocumento, CNPJ_INPUT_MASK } from '@/utils/cnpj';
import { fetchCompanyByCnpj } from '@/services/cnpjLookup';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MaskInput, { Masks } from 'react-native-mask-input';
import Toast from 'react-native-toast-message';

export function getEmptyClienteForm(): ClienteFormValues {
  return {
    documento: '',
    cnpj: '',
    inscricao_estadual: '',
    nome_cliente: '',
    nome_empresa: '',
    mes_entrada: '',
    valor_mensalidade_anterior: '',
    valor_mensalidade: '',
    segmento_cliente_codigo: '',
    dia_vencimento: '',
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
    tipo_faturamento: 'mensal',
    parcelas_anuais: '12',
  };
}

export function clienteToFormValues(c: Cliente, contatos: ContatoClienteInput[]): ClienteFormValues {
  return {
    documento: c.documento,
    cnpj: c.cnpj?.trim() ?? '',
    inscricao_estadual: c.inscricao_estadual ?? '',
    nome_cliente: c.nome_cliente,
    nome_empresa: c.nome_empresa ?? '',
    mes_entrada: c.mes_entrada ?? '',
    valor_mensalidade_anterior:
      c.valor_mensalidade_anterior == null ? '' : formatBRL(c.valor_mensalidade_anterior),
    valor_mensalidade: formatBRL(c.valor_mensalidade),
    segmento_cliente_codigo:
      (c.segmento_cliente_codigo ?? c.segmento_cliente?.codigo ?? '').trim() || 'DIVERSOS',
    dia_vencimento: c.dia_vencimento != null ? String(c.dia_vencimento) : '',
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
    tipo_faturamento: normalizeTipoFaturamento(c.tipo_faturamento),
    parcelas_anuais: c.parcelas_anuais != null ? String(c.parcelas_anuais) : '12',
  };
}

type Props = {
  initial?: ClienteFormValues;
  onSubmit: (values: ClienteFormValues) => Promise<void>;
  submitLabel: string;
};

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

function CompactToggle({
  label,
  value,
  onValueChange,
  activeColor,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  activeColor: string;
}) {
  return (
    <View style={styles.toggleItem}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.gray200, true: activeColor }}
        thumbColor={value ? colors.white : colors.gray400}
      />
    </View>
  );
}

export function ClientForm({ initial, onSubmit, submitLabel }: Props) {
  const [values, setValues] = useState<ClienteFormValues>(initial ?? getEmptyClienteForm());
  const [loading, setLoading] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewAnual = useMemo(
    () =>
      values.tipo_faturamento === 'anual'
        ? previewFaturamentoAnual(values.valor_mensalidade, parseInt(values.parcelas_anuais, 10) || 12)
        : null,
    [values.tipo_faturamento, values.valor_mensalidade, values.parcelas_anuais],
  );

  useEffect(() => {
    if (initial) setValues(initial);
  }, [initial]);

  const buscarCnpj = async () => {
    setBuscandoCnpj(true);
    try {
      const r = await fetchCompanyByCnpj(values.cnpj);
      if (!r.ok) {
        Toast.show({ type: 'error', text1: r.message });
        return;
      }
      setValues((v) => ({
        ...v,
        cnpj: values.cnpj,
        nome_empresa: r.razao_social || v.nome_empresa,
        nome_cliente: v.nome_cliente.trim() ? v.nome_cliente : r.nome_fantasia || r.razao_social,
        inscricao_estadual: r.inscricao_estadual || v.inscricao_estadual,
        cep: r.cep || v.cep,
        logradouro: r.logradouro || v.logradouro,
        numero: r.numero || v.numero,
        complemento: r.complemento || v.complemento,
        bairro: r.bairro || v.bairro,
        cidade: r.cidade || v.cidade,
        uf: r.uf || v.uf,
      }));
      setError(null);
      Toast.show({ type: 'success', text1: 'Dados do CNPJ preenchidos.' });
    } finally {
      setBuscandoCnpj(false);
    }
  };

  const submit = async () => {
    const msg = validateClienteForm({
      cnpj: values.cnpj,
      nome_cliente: values.nome_cliente,
      valor_mensalidade: values.valor_mensalidade,
      contatos: values.contatos,
      uf: values.uf,
    });
    if (msg) {
      setError(msg);
      return;
    }
    const diaTxt = values.dia_vencimento.trim().replace(/\D/g, '');
    if (diaTxt) {
      const dia = parseInt(diaTxt, 10);
      if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
        setError('Data de vencimento: informe o dia do mês entre 1 e 31.');
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
    if (values.tipo_faturamento === 'anual') {
      const n = parseInt(values.parcelas_anuais.replace(/\D/g, ''), 10);
      if (!(PARCELAS_ANUAIS_OPCOES as readonly number[]).includes(n)) {
        setError('No faturamento anual, escolha 1, 2, 3, 4, 6 ou 12 parcelas.');
        return;
      }
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

  const documentoZpf = isZpfDocumento(values.documento);
  const documentoReadonly = Boolean(initial) && documentoZpf;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
    >
      <FormSection title="Identificação">
        {documentoReadonly ? (
          <View style={styles.zpfBadge}>
            <Text style={styles.fieldLabel}>Documento</Text>
            <Text style={styles.zpfBadgeText}>{values.documento}</Text>
          </View>
        ) : (
          <FormTextInput
            compact
            label="Documento"
            value={values.documento}
            onChangeText={(t) => setValues((v) => ({ ...v, documento: t }))}
            placeholder="ZPF automático se vazio"
            autoCapitalize="characters"
          />
        )}
        {!initial && !values.documento.trim() ? (
          <Text style={styles.hint}>Documento interno gerado automaticamente (ZPF) ao salvar, se vazio.</Text>
        ) : null}

        <Text style={styles.fieldLabel}>CNPJ</Text>
        <View style={styles.cnpjRow}>
          <MaskInput
            value={values.cnpj}
            onChangeText={(masked) => setValues((v) => ({ ...v, cnpj: masked }))}
            mask={CNPJ_INPUT_MASK}
            keyboardType="number-pad"
            placeholder="00.000.000/0000-00"
            style={[styles.mask, styles.cnpjInput]}
            placeholderTextColor={colors.gray400}
          />
          <PrimaryButton
            title="Buscar"
            variant="secondary"
            onPress={() => void buscarCnpj()}
            loading={buscandoCnpj}
            disabled={!isCnpjDigitsComplete(values.cnpj)}
            style={styles.cnpjBtn}
          />
        </View>
        <Text style={styles.hint}>Opcional. Busca preenche razão social, endereço e IE.</Text>

        <View style={styles.row2}>
          <View style={styles.flex1}>
            <FormTextInput
              compact
              label="Inscrição estadual"
              value={values.inscricao_estadual}
              onChangeText={(t) => setValues((v) => ({ ...v, inscricao_estadual: t }))}
              placeholder="IE ou ISENTO"
              autoCapitalize="characters"
            />
          </View>
        </View>

        <View style={styles.row2}>
          <View style={styles.flex1}>
            <FormTextInput
              compact
              label="Nome do cliente"
              value={values.nome_cliente}
              onChangeText={(t) => setValues((v) => ({ ...v, nome_cliente: t }))}
            />
          </View>
          <View style={styles.flex1}>
            <FormTextInput
              compact
              label="Nome da empresa"
              value={values.nome_empresa}
              onChangeText={(t) => setValues((v) => ({ ...v, nome_empresa: t }))}
            />
          </View>
        </View>

        <View style={styles.toggleRow}>
          <CompactToggle
            label="Cancelado"
            value={values.cancelado}
            onValueChange={(cancelado) =>
              setValues((v) => ({
                ...v,
                cancelado,
                cancelamento_justificativa: cancelado ? v.cancelamento_justificativa : '',
              }))
            }
            activeColor="rgba(232, 106, 36, 0.45)"
          />
          <View style={styles.toggleDivider} />
          <CompactToggle
            label="NF-e"
            value={values.emite_nf}
            onValueChange={(emite_nf) => setValues((v) => ({ ...v, emite_nf }))}
            activeColor="rgba(13, 59, 79, 0.35)"
          />
        </View>

        {values.cancelado ? (
          <FormTextInput
            compact
            label="Justificativa do cancelamento"
            value={values.cancelamento_justificativa}
            onChangeText={(t) => setValues((v) => ({ ...v, cancelamento_justificativa: t }))}
            placeholder="Motivo (obrigatório)"
            multiline
            numberOfLines={3}
            style={styles.textArea}
          />
        ) : null}
      </FormSection>

      <FormSection title="Endereço">
        <AddressFormSection
          compact
          hideTitle
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
      </FormSection>

      <FormSection title="Contatos">
        <ContactListEditor
          compact
          hideTitle
          contatos={values.contatos}
          onChange={(contatos) => setValues((v) => ({ ...v, contatos }))}
        />
      </FormSection>

      <FormSection title="Financeiro">
        <View style={styles.row2}>
          <View style={styles.flex1}>
            <Text style={styles.fieldLabel}>Mês entrada</Text>
            <MaskInput
              value={values.mes_entrada}
              onChangeText={(masked) => setValues((v) => ({ ...v, mes_entrada: masked }))}
              mask={[/\d/, /\d/, '/', /\d/, /\d/, /\d/, /\d/]}
              placeholder="MM/AAAA"
              keyboardType="number-pad"
              style={styles.mask}
              placeholderTextColor={colors.gray400}
            />
          </View>
          <View style={styles.flex1}>
            <Text style={styles.fieldLabel}>Mensalidade</Text>
            <MaskInput
              value={values.valor_mensalidade}
              onChangeText={(masked) => setValues((v) => ({ ...v, valor_mensalidade: masked }))}
              mask={Masks.BRL_CURRENCY}
              keyboardType="numeric"
              style={styles.mask}
              placeholderTextColor={colors.gray400}
            />
          </View>
        </View>

        <View style={styles.readonlyRow}>
          <View style={styles.readonlyItem}>
            <Text style={styles.readonlyLabel}>Mens. anterior</Text>
            <Text style={styles.readonlyValue}>
              {values.valor_mensalidade_anterior?.trim() ? values.valor_mensalidade_anterior : '—'}
            </Text>
          </View>
        </View>

        <SegmentoClientePicker
          compact
          valueCodigo={values.segmento_cliente_codigo}
          onChangeCodigo={(segmento_cliente_codigo) =>
            setValues((v) => ({ ...v, segmento_cliente_codigo }))
          }
        />

        <Text style={styles.fieldLabel}>Anexo PDF</Text>
        <PdfAttachmentSection
          compact
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
      </FormSection>

      <FormSection title="Mensalidade">
        <Text style={styles.fieldLabel}>Tipo de faturamento</Text>
        <View style={styles.fatRow}>
          {(['mensal', 'anual'] as TipoFaturamento[]).map((tipo) => {
            const on = values.tipo_faturamento === tipo;
            return (
              <Pressable
                key={tipo}
                style={[styles.fatChip, on && styles.fatChipOn]}
                onPress={() =>
                  setValues((v) => ({
                    ...v,
                    tipo_faturamento: tipo,
                    parcelas_anuais: tipo === 'anual' ? v.parcelas_anuais || '12' : v.parcelas_anuais,
                  }))
                }
              >
                <Text style={[styles.fatChipTxt, on && styles.fatChipTxtOn]}>
                  {labelTipoFaturamento(tipo)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {values.tipo_faturamento === 'anual' ? (
          <>
            <Text style={styles.fieldLabel}>Quantidade de parcelas</Text>
            <View style={styles.fatRow}>
              {PARCELAS_ANUAIS_OPCOES.map((n) => {
                const on = values.parcelas_anuais === String(n);
                return (
                  <Pressable
                    key={n}
                    style={[styles.parcelaChip, on && styles.fatChipOn]}
                    onPress={() => setValues((v) => ({ ...v, parcelas_anuais: String(n) }))}
                  >
                    <Text style={[styles.fatChipTxt, on && styles.fatChipTxtOn]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
            {previewAnual ? <Text style={styles.previewAnual}>{previewAnual}</Text> : null}
          </>
        ) : null}

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormTextInput
              compact
              label="Data de vencimento"
              value={values.dia_vencimento}
              onChangeText={(t) =>
                setValues((v) => ({
                  ...v,
                  dia_vencimento: t.replace(/\D/g, '').slice(0, 2),
                }))
              }
              keyboardType="number-pad"
              placeholder="Ex.: 10"
              maxLength={2}
            />
            <Text style={styles.hint}>Dia do mês (1–31). As mensalidades vencem nesse dia.</Text>
          </View>
          <DateMaskedField
            compact
            label="Data reajuste"
            value={values.data_reajuste}
            onChange={(d) =>
              setValues((v) => {
                if (d == null) {
                  return { ...v, data_reajuste: null };
                }
                const prev = v.data_reajuste;
                const same = prev != null && toISODate(prev) === toISODate(d);
                if (!same && prev != null) {
                  return { ...v, data_reajuste: d, ultimo_reajuste: prev };
                }
                return { ...v, data_reajuste: d };
              })
            }
          />
        </View>
        <View style={styles.readonlyRow}>
          <View style={styles.readonlyItem}>
            <Text style={styles.readonlyLabel}>Último reajuste</Text>
            <Text style={styles.readonlyValue}>{formatBRDate(values.ultimo_reajuste) || '—'}</Text>
          </View>
        </View>
      </FormSection>

      <FormSection title="Observações">
        <FormTextInput
          compact
          label="Notas"
          hideLabel
          value={values.observacao}
          onChangeText={(t) => setValues((v) => ({ ...v, observacao: t }))}
          placeholder="Observações gerais, internas ou comerciais"
          multiline
          numberOfLines={4}
          style={styles.textArea}
        />
      </FormSection>

      {error ? <Text style={styles.formError}>{error}</Text> : null}

      <PrimaryButton title={submitLabel} onPress={submit} loading={loading} style={styles.submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  sectionCard: {
    padding: spacing.sm + 4,
    marginBottom: 0,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  fatChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  parcelaChip: {
    minWidth: 40,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  fatChipOn: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.1)',
  },
  fatChipTxt: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  fatChipTxtOn: { color: colors.petroleum },
  previewAnual: {
    fontSize: 12,
    color: colors.petroleum,
    fontWeight: '600',
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  hint: {
    fontSize: 11,
    color: colors.gray400,
    marginTop: -2,
    marginBottom: spacing.sm,
    lineHeight: 15,
  },
  cnpjRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cnpjInput: {
    flex: 1,
    marginBottom: 0,
  },
  cnpjBtn: {
    minWidth: 72,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  zpfBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(13, 59, 79, 0.08)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  zpfBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.petroleum,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  flex1: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray100,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray600,
  },
  toggleDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: colors.gray200,
  },
  mask: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.gray800,
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  readonlyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.gray50,
    borderRadius: radius.sm,
  },
  readonlyItem: {
    flex: 1,
  },
  readonlyLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  readonlyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.petroleum,
    marginTop: 2,
  },
  formError: {
    color: colors.danger,
    marginBottom: spacing.sm,
    fontSize: 13,
    paddingHorizontal: spacing.xs,
  },
  submit: {
    marginTop: spacing.xs,
    minHeight: 44,
  },
});
