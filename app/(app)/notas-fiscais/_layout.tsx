import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function NotasFiscaisLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.notasFiscais) }}>
      <Stack.Screen name="index" options={{ title: 'Notas fiscais' }} />
    </Stack>
  );
}
