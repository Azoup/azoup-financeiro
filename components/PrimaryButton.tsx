import { colors, radius, shadows, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'default' | 'compact';
  loading?: boolean;
  style?: ViewStyle;
};

export function PrimaryButton({
  title,
  variant = 'primary',
  size = 'default',
  loading,
  disabled,
  style,
  ...rest
}: Props) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const compact = size === 'compact';

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        compact && styles.baseCompact,
        isPrimary && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        isDanger && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary || isDanger ? colors.white : colors.petroleum} />
      ) : (
        <Text
          style={[
            styles.text,
            compact && styles.textCompact,
            isPrimary && styles.textOnPrimary,
            variant === 'secondary' && styles.textSecondary,
            variant === 'ghost' && styles.textGhost,
            isDanger && styles.textOnPrimary,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  baseCompact: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  primary: {
    backgroundColor: colors.orange,
    ...shadows.sm,
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.gray200,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.92,
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: 0.15,
  },
  textCompact: {
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  textOnPrimary: {
    color: colors.white,
  },
  textSecondary: {
    color: colors.petroleum,
  },
  textGhost: {
    color: colors.orange,
  },
});
