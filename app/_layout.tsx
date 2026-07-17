import 'react-native-reanimated';
import 'react-native-gesture-handler';
import { FontProvider } from '@/components/FontProvider';
import { AuthProvider } from '@/context/AuthContext';
import { colors } from '@/theme/colors';
import { appToastConfig } from '@/utils/appToast';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <FontProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.gray50 },
                animation: 'fade',
              }}
            />
            <Toast config={appToastConfig} />
          </AuthProvider>
        </FontProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
