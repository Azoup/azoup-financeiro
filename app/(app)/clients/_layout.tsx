import { colors } from '@/theme/colors';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ClientsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        ...headerBackDismissToConsulta(CONSULTA.clients),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Clientes' }} />
      <Stack.Screen name="new" options={{ title: 'Novo cliente' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detalhes' }} />
    </Stack>
  );
}
