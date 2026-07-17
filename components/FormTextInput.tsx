import { useTheme } from '@/context/ThemeContext';
import { FORM_CONTROL_HEIGHT, radius, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  hideLabel?: boolean;
  compact?: boolean;
};

export function FormTextInput({
  label,
  error,
  hideLabel,
  compact,
  style,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { marginBottom: spacing.md },
        wrapCompact: { marginBottom: spacing.sm },
        label: {
          fontFamily: fonts.semibold,
          fontSize: 13,
          color: theme.textSecondary,
          marginBottom: 8,
        },
        labelCompact: {
          fontSize: 11,
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        },
        input: {
          borderWidth: 1,
          borderColor: theme.borderInput,
          borderRadius: radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 8,
          minHeight: FORM_CONTROL_HEIGHT,
          fontSize: 14,
          fontFamily: fonts.regular,
          color: theme.text,
          backgroundColor: theme.surface,
        },
        inputCompact: {
          minHeight: FORM_CONTROL_HEIGHT,
          fontSize: 14,
        },
        inputFocused: {
          borderColor: theme.primary,
        },
        inputError: {
          borderColor: theme.error,
        },
        error: {
          marginTop: 4,
          fontFamily: fonts.regular,
          fontSize: 12,
          color: theme.error,
        },
      }),
    [theme],
  );

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!hideLabel && label ? (
        <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          compact && styles.inputCompact,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          style,
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}
