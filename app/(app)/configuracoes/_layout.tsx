import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { CONSULTA, headerBackDismissToConsulta } from '@/utils/navigationConsulta';
import { Stack } from 'expo-router';

export default function ConfiguracoesLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={{ ...themed, ...headerBackDismissToConsulta(CONSULTA.configuracoes) }}>
      <Stack.Screen name="index" options={{ title: 'Configurações' }} />
      <Stack.Screen name="perfil-cobranca" options={{ title: 'Dados do beneficiário' }} />
      <Stack.Screen name="nfe" options={{ title: 'Configurar NFS-e' }} />
      <Stack.Screen name="sicoob" options={{ title: 'Boleto Sicoob' }} />
      <Stack.Screen name="segmentos" options={{ title: 'Segmentos' }} />
    </Stack>
  );
}
