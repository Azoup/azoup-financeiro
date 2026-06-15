import { colors } from '@/theme/colors';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function MensalidadesStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        ...headerBackDismissToConsulta(CONSULTA.mensalidades),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Histórico de gerações de mensalidades' }} />
      <Stack.Screen name="gerar" options={{ title: 'Gerar mensalidade' }} />
    </Stack>
  );
}
