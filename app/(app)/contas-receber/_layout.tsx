import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ContasReceberLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.contasReceber) }}>
      <Stack.Screen name="index" options={{ title: 'Contas a receber' }} />
    </Stack>
  );
}
