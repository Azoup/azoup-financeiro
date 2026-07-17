import { useTheme } from '@/context/ThemeContext';
import { radius, shadows } from '@/theme/colors';
import React, { useMemo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

type Props = ViewProps & {
  padded?: boolean;
};

export function Card({ children, style, padded = true, ...rest }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: theme.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.border,
          ...shadows.sm,
        },
        padded: { padding: 14 },
      }),
    [theme],
  );

  return (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );
}
