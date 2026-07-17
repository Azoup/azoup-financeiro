import { useTheme } from '@/context/ThemeContext';
import { fonts } from '@/theme/typography';
import { useMemo } from 'react';

/** Opções de header alinhadas ao tema Azoup (stacks internos). */
export function useThemedStackOptions() {
  const { theme } = useTheme();
  return useMemo(
    () => ({
      contentStyle: { flex: 1, backgroundColor: theme.background },
      headerStyle: {
        backgroundColor: theme.headerBg,
      },
      headerTintColor: theme.headerText,
      headerTitleStyle: {
        fontFamily: fonts.bold,
        fontWeight: '700' as const,
        fontSize: 17,
        color: theme.headerText,
      },
      headerShadowVisible: false,
    }),
    [theme],
  );
}
