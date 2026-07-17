import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function VendasStackLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.vendas) }}>
      <Stack.Screen name="index" options={{ title: 'Vendas' }} />
      <Stack.Screen name="new" options={{ title: 'Nova venda' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detalhes da venda' }} />
    </Stack>
  );
}
