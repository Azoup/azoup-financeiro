import { colors } from '@/theme/colors';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function VendasStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        ...headerBackDismissToConsulta(CONSULTA.vendas),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Vendas' }} />
      <Stack.Screen name="new" options={{ title: 'Nova venda' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detalhes da venda' }} />
    </Stack>
  );
}
