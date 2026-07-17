import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/outfit';
import { colors } from '@/theme/colors';
import { type ReactNode, useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

type Props = { children: ReactNode };

/**
 * Carrega Outfit e, na web, aplica como fonte padrão do documento.
 */
export function FontProvider({ children }: Props) {
  const [loaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  useEffect(() => {
    if (!loaded || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'sj-outfit-global';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      html, body, #root, input, textarea, button, select {
        font-family: Outfit_400Regular, Outfit, system-ui, -apple-system, sans-serif !important;
      }
    `;
    document.head.appendChild(style);
  }, [loaded]);

  if (!loaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray50,
  },
});
