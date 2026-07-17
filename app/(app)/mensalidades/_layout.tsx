import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function MensalidadesStackLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.mensalidades) }}>
      <Stack.Screen name="index" options={{ title: 'Histórico de gerações de mensalidades' }} />
      <Stack.Screen name="gerar" options={{ title: 'Gerar mensalidade' }} />
    </Stack>
  );
}
