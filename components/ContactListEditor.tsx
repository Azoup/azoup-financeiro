import { colors, radius, spacing } from '@/theme/colors';
import type { ContatoClienteInput, TipoContato } from '@/types/models';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaskInput from 'react-native-mask-input';
import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';

type Props = {
  contatos: ContatoClienteInput[];
  onChange: (next: ContatoClienteInput[]) => void;
};

const emptyContato = (): ContatoClienteInput => ({
  nome_contato: '',
  tipo_contato: 'whatsapp',
  valor_contato: '',
});

export function ContactListEditor({ contatos, onChange }: Props) {
  const update = (index: number, patch: Partial<ContatoClienteInput>) => {
    const next = contatos.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange(next);
  };

  const add = () => onChange([...contatos, emptyContato()]);
  const remove = (index: number) => {
    onChange(contatos.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.block}>
      <Text style={styles.sectionTitle}>Contatos</Text>
      <Text style={styles.sectionHint}>Opcional. Você pode cadastrar o cliente sem contato e incluir depois.</Text>
      {contatos.length === 0 ? (
        <Text style={styles.emptyHint}>Nenhum contato adicionado.</Text>
      ) : null}
      {contatos.map((c, index) => (
        <View key={index} style={styles.card}>
          <FormTextInput
            label={`Nome do contato ${index + 1}`}
            value={c.nome_contato}
            onChangeText={(t) => update(index, { nome_contato: t })}
            placeholder="Ex.: Financeiro"
          />

          <Text style={styles.label}>Tipo</Text>
          <View style={styles.segment}>
            {(['whatsapp', 'email'] as const).map((tipo) => {
              const active = c.tipo_contato === tipo;
              return (
                <Pressable
                  key={tipo}
                  onPress={() =>
                    update(index, {
                      tipo_contato: tipo as TipoContato,
                      valor_contato: '',
                    })
                  }
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {tipo === 'email' ? 'E-mail' : 'WhatsApp'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>
            {c.tipo_contato === 'email' ? 'E-mail' : 'WhatsApp'}
          </Text>
          {c.tipo_contato === 'whatsapp' ? (
            <MaskInput
              value={c.valor_contato}
              onChangeText={(masked) => update(index, { valor_contato: masked })}
              mask={['(', /\d/, /\d/, ')', ' ', /\d/, /\d/, /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, /\d/]}
              placeholder="(11) 99999-9999"
              keyboardType="phone-pad"
              style={styles.maskInput}
              placeholderTextColor={colors.gray400}
            />
          ) : (
            <FormTextInput
              label="E-mail"
              hideLabel
              value={c.valor_contato}
              onChangeText={(t) => update(index, { valor_contato: t })}
              placeholder="email@empresa.com"
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ marginBottom: 0 }}
            />
          )}

          <PrimaryButton
            title="Remover contato"
            variant="ghost"
            onPress={() => remove(index)}
            style={styles.removeBtn}
          />
        </View>
      ))}

      <PrimaryButton title="Adicionar contato" variant="secondary" onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: 12,
    color: colors.gray600,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  emptyHint: {
    fontSize: 14,
    color: colors.gray400,
    marginBottom: spacing.md,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.gray50,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  segmentItemActive: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
  },
  segmentText: {
    fontWeight: '600',
    color: colors.gray600,
  },
  segmentTextActive: {
    color: colors.petroleum,
  },
  maskInput: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    color: colors.gray800,
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
  },
  removeBtn: {
    marginTop: spacing.sm,
    minHeight: 44,
  },
});
