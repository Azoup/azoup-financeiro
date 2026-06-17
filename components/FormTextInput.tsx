import { colors, radius, spacing } from '@/theme/colors';
import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  hideLabel?: boolean;
  compact?: boolean;
};

export function FormTextInput({ label, error, hideLabel, compact, style, ...rest }: Props) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!hideLabel ? <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.gray400}
        style={[styles.input, compact && styles.inputCompact, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  wrapCompact: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  labelCompact: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    color: colors.gray800,
    backgroundColor: colors.white,
  },
  inputCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    minHeight: 40,
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.danger,
  },
});
