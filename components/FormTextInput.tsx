import { colors, radius, spacing } from '@/theme/colors';
import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  hideLabel?: boolean;
};

export function FormTextInput({ label, error, hideLabel, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      {!hideLabel ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.gray400}
        style={[styles.input, error ? styles.inputError : null, style]}
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
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
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
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.danger,
  },
});
