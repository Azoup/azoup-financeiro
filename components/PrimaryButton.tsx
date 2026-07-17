import { useTheme } from '@/context/ThemeContext';
import { radius, shadows, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import React, { useMemo } from 'react';
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
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
  const { theme } = useTheme();
  const compact = size === 'compact';
  const isFilled = variant === 'primary' || variant === 'brand' || variant === 'danger';

  const styles = useMemo(() => {
    const actionBg = variant === 'brand' ? theme.brandPrimary : theme.cadastroAction;
    return StyleSheet.create({
      base: {
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
      },
      baseCompact: {
        minHeight: 36,
        paddingVertical: 8,
        paddingHorizontal: spacing.md,
      },
      primary: {
        backgroundColor: actionBg,
        ...shadows.sm,
      },
      secondary: {
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.borderStrong,
      },
      ghost: { backgroundColor: 'transparent' },
      danger: { backgroundColor: theme.error },
      disabled: { opacity: 0.5 },
      pressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
      text: {
        fontFamily: fonts.semibold,
        fontSize: 15,
        letterSpacing: 0.1,
      },
      textCompact: { fontSize: 13 },
      textOnPrimary: { color: theme.textOnPrimary },
      textSecondary: { color: theme.text },
      textGhost: { color: theme.cadastroAction },
    });
  }, [theme, variant]);

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        compact && styles.baseCompact,
        (variant === 'primary' || variant === 'brand') && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isFilled ? theme.textOnPrimary : theme.text} />
      ) : (
        <Text
          style={[
            styles.text,
            compact && styles.textCompact,
            isFilled && styles.textOnPrimary,
            variant === 'secondary' && styles.textSecondary,
            variant === 'ghost' && styles.textGhost,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
