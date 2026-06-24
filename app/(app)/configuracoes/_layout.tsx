import { colors } from '@/theme/colors';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ConfiguracoesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        ...headerBackDismissToConsulta(CONSULTA.configuracoes),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Configurações' }} />
      <Stack.Screen name="perfil-cobranca" options={{ title: 'Dados do beneficiário' }} />
      <Stack.Screen name="nfe" options={{ title: 'Configurar NFS-e' }} />
      <Stack.Screen name="sicoob" options={{ title: 'Boleto Sicoob' }} />
      <Stack.Screen name="segmentos" options={{ title: 'Segmentos' }} />
    </Stack>
  );
}
