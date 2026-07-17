import { Alert, Platform } from 'react-native';

/**
 * Confirmação destrutiva que funciona na web (window.confirm) e no nativo (Alert).
 * React Native `Alert.alert` não abre diálogo no Expo Web.
 */
export function confirmDestructive(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirmar', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
