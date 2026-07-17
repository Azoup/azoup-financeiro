import { useAuth } from '@/context/AuthContext';
import { colors, shadows } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.gray400,
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 11,
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.gray100,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingBottom: Platform.OS === 'ios' ? 22 : 10,
          paddingTop: 8,
          ...shadows.sm,
        },
        headerStyle: {
          backgroundColor: colors.petroleum,
          ...shadows.sm,
        },
        headerShadowVisible: false,
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontFamily: fonts.bold,
          fontSize: 17,
          letterSpacing: -0.2,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Início',
          tabBarLabel: 'Início',
          headerTitle: 'Painel',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="azoup"
        options={{
          title: 'Azoup',
          headerShown: false,
          tabBarLabel: 'Azoup',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'planet' : 'planet-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clientes',
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="mensalidades"
        options={{
          title: 'Mensalidades',
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="vendas"
        options={{
          title: 'Vendas',
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'cart' : 'cart-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="contas-receber"
        options={{
          title: 'A receber',
          headerShown: false,
          tabBarLabel: 'A receber',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'cash' : 'cash-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="notas-fiscais"
        options={{
          title: 'Notas fiscais',
          headerShown: false,
          tabBarLabel: 'NFS-e',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'document-text' : 'document-text-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Conta',
          tabBarLabel: 'Conta',
          headerTitle: 'Minha conta',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="configuracoes"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.gray50,
  },
});
