import { colors } from '@/theme/colors';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ContasReceberLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        ...headerBackDismissToConsulta(CONSULTA.contasReceber),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Contas a receber' }} />
    </Stack>
  );
}
