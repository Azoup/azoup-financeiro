import 'react-native-reanimated';
import 'react-native-gesture-handler';
import { FontProvider } from '@/components/FontProvider';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { appToastConfig } from '@/utils/appToast';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function ThemedStack() {
  const { theme, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: 'fade',
        }}
      />
      <Toast config={appToastConfig} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <FontProvider>
          <ThemeProvider>
            <AuthProvider>
              <ThemedStack />
            </AuthProvider>
          </ThemeProvider>
        </FontProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
