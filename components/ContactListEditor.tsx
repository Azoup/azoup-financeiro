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
  compact?: boolean;
  hideTitle?: boolean;
};

const emptyContato = (): ContatoClienteInput => ({
  nome_contato: '',
  tipo_contato: 'whatsapp',
  valor_contato: '',
});

export function ContactListEditor({ contatos, onChange, compact, hideTitle }: Props) {
  const update = (index: number, patch: Partial<ContatoClienteInput>) => {
    const next = contatos.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange(next);
  };

  const add = () => onChange([...contatos, emptyContato()]);
  const remove = (index: number) => {
    onChange(contatos.filter((_, i) => i !== index));
  };

  return (
    <View style={[styles.block, compact && styles.blockCompact]}>
      {!hideTitle ? (
        <>
          <Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>Contatos</Text>
          {!compact ? (
            <Text style={styles.sectionHint}>
              Opcional. Você pode cadastrar o cliente sem contato e incluir depois.
            </Text>
          ) : null}
        </>
      ) : null}
      {contatos.length === 0 ? (
        <Text style={[styles.emptyHint, compact && styles.emptyHintCompact]}>Nenhum contato.</Text>
      ) : null}
      {contatos.map((c, index) => (
        <View key={index} style={[styles.card, compact && styles.cardCompact]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardIndex}>#{index + 1}</Text>
            <Pressable onPress={() => remove(index)} hitSlop={8}>
              <Text style={styles.removeLink}>Remover</Text>
            </Pressable>
          </View>

          <FormTextInput
            compact={compact}
            label="Nome"
            value={c.nome_contato}
            onChangeText={(t) => update(index, { nome_contato: t })}
            placeholder="Ex.: Financeiro"
          />

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
                  style={[styles.segmentItem, compact && styles.segmentItemCompact, active && styles.segmentItemActive]}
                >
                  <Text style={[styles.segmentText, compact && styles.segmentTextCompact, active && styles.segmentTextActive]}>
                    {tipo === 'email' ? 'E-mail' : 'WhatsApp'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {c.tipo_contato === 'whatsapp' ? (
            <MaskInput
              value={c.valor_contato}
              onChangeText={(masked) => update(index, { valor_contato: masked })}
              mask={['(', /\d/, /\d/, ')', ' ', /\d/, /\d/, /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, /\d/]}
              placeholder="(11) 99999-9999"
              keyboardType="phone-pad"
              style={[styles.maskInput, compact && styles.maskInputCompact]}
              placeholderTextColor={colors.gray400}
            />
          ) : (
            <FormTextInput
              compact={compact}
              label="E-mail"
              hideLabel
              value={c.valor_contato}
              onChangeText={(t) => update(index, { valor_contato: t })}
              placeholder="email@empresa.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          )}
        </View>
      ))}

      <PrimaryButton
        title={compact ? '+ Contato' : 'Adicionar contato'}
        variant="secondary"
        onPress={add}
        style={compact ? styles.addBtnCompact : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.sm,
  },
  blockCompact: {
    marginTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  sectionTitleCompact: {
    fontSize: 14,
    marginBottom: spacing.sm,
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
  emptyHintCompact: {
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.gray50,
  },
  cardCompact: {
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.white,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardIndex: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  removeLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger,
  },
  segment: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  segmentItemCompact: {
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  segmentItemActive: {
    borderColor: colors.orange,
    backgroundColor: 'rgba(232, 106, 36, 0.12)',
  },
  segmentText: {
    fontWeight: '600',
    color: colors.gray600,
    fontSize: 14,
  },
  segmentTextCompact: {
    fontSize: 12,
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
  maskInputCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    minHeight: 40,
    marginBottom: 0,
  },
  addBtnCompact: {
    minHeight: 40,
  },
});
