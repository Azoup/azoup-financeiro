import { colors } from '@/theme/colors';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="login" options={{ title: 'Entrar' }} />
      <Stack.Screen name="register" options={{ title: 'Criar conta' }} />
    </Stack>
  );
}
