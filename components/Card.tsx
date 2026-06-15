import { colors, radius, spacing } from '@/theme/colors';
import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

type Props = ViewProps & {
  padded?: boolean;
};

export function Card({ children, style, padded = true, ...rest }: Props) {
  return (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: colors.petroleumDark,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  padded: {
    padding: spacing.md,
  },
});
