import { colors, radius, spacing } from '@/theme/colors';
import { formatBRDate, parseBRDateDMY, toISODate } from '@/utils/date';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaskInput from 'react-native-mask-input';

const maskDdmYyyy = [/\d/, /\d/, '/', /\d/, /\d/, '/', /\d/, /\d/, /\d/, /\d/];

type Props = {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  compact?: boolean;
};

/** Data digitável com máscara DD/MM/AAAA (mesmo padrão visual dos outros campos com máscara). */
export function DateMaskedField({ label, value, onChange, compact }: Props) {
  const [text, setText] = useState(() => (value ? formatBRDate(value) : ''));

  useEffect(() => {
    if (value != null) {
      setText(formatBRDate(value));
    }
  }, [value == null ? '' : toISODate(value)]);

  const onChangeText = (masked: string) => {
    setText(masked);
    const digits = masked.replace(/\D/g, '');
    if (digits.length === 0) {
      onChange(null);
      return;
    }
    if (digits.length === 8 && masked.length >= 10) {
      onChange(parseBRDateDMY(masked));
      return;
    }
    onChange(null);
  };

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
      <MaskInput
        value={text}
        onChangeText={onChangeText}
        mask={maskDdmYyyy}
        placeholder="DD/MM/AAAA"
        keyboardType="number-pad"
        style={[styles.mask, compact && styles.maskCompact]}
        placeholderTextColor={colors.gray400}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    flex: 1,
  },
  wrapCompact: {
    marginBottom: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  labelCompact: {
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  mask: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.gray800,
    backgroundColor: colors.white,
  },
  maskCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    minHeight: 40,
  },
});
