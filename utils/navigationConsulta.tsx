import { colors } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler, Platform, Pressable, View } from 'react-native';

/** Rotas de consulta (lista / índice) por módulo — destino do “voltar”. */
export const CONSULTA = {
  clients: '/(app)/clients' as Href,
  vendas: '/(app)/vendas' as Href,
  mensalidades: '/(app)/mensalidades' as Href,
  configuracoes: '/(app)/configuracoes' as Href,
  contasReceber: '/(app)/contas-receber' as Href,
} as const;

export function goToConsulta(href: Href): void {
  router.dismissTo(href);
}

/** Opções de Stack: voltar do header sempre para a consulta do módulo. */
export function headerBackDismissToConsulta(href: Href) {
  return {
    headerLeft: (props: { canGoBack?: boolean; tintColor?: string }) => {
      if (!props.canGoBack) {
        return undefined;
      }
      const tint = props.tintColor ?? colors.white;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para consulta"
            onPress={() => router.dismissTo(href)}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            style={{ marginLeft: Platform.OS === 'ios' ? 4 : 0, padding: 4 }}
          >
            <Ionicons name="arrow-back" size={24} color={tint} />
          </Pressable>
        </View>
      );
    },
  };
}

/** Android: botão voltar do sistema leva à consulta (não só um pop). */
export function useHardwareBackToConsulta(href: Href): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.dismissTo(href);
        return true;
      });
      return () => sub.remove();
    }, [href]),
  );
}
