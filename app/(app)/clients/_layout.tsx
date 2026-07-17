import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ClientsStackLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.clients) }}>
      <Stack.Screen name="index" options={{ title: 'Clientes' }} />
      <Stack.Screen name="new" options={{ title: 'Novo cliente' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detalhes' }} />
    </Stack>
  );
}
