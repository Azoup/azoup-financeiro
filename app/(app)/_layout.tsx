import { AppSideNav, SidebarMenuButton } from '@/components/navigation/AppSideNav';
import { useAuth } from '@/context/AuthContext';
import { SidebarProvider, useSidebar } from '@/context/SidebarContext';
import { useTheme } from '@/context/ThemeContext';
import { fonts } from '@/theme/typography';
import { Redirect, Tabs } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

function AppShell() {
  const { theme } = useTheme();
  const { isMobileNav, isOpen, close } = useSidebar();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        shell: {
          flex: 1,
          flexDirection: 'row',
          backgroundColor: theme.background,
        },
        main: { flex: 1, minWidth: 0 },
        backdrop: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0,0,0,0.45)',
          zIndex: 30,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.shell}>
      <AppSideNav />
      {isMobileNav && isOpen ? <Pressable style={styles.backdrop} onPress={close} /> : null}
      <View style={styles.main}>
        <Tabs
          screenOptions={{
            tabBarStyle: { display: 'none' },
            tabBarShowLabel: false,
            headerStyle: {
              backgroundColor: theme.headerBg,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.headerBorder,
            },
            headerShadowVisible: false,
            headerTintColor: theme.headerText,
            headerTitleStyle: {
              fontFamily: fonts.bold,
              fontSize: 17,
              letterSpacing: -0.2,
              color: theme.headerText,
            },
            headerLeft: () => <SidebarMenuButton />,
          }}
        >
          <Tabs.Screen name="dashboard" options={{ title: 'Início', headerTitle: 'Painel' }} />
          <Tabs.Screen name="azoup" options={{ title: 'Azoup - Web', headerShown: false }} />
          <Tabs.Screen name="clients" options={{ title: 'Clientes', headerShown: false }} />
          <Tabs.Screen
            name="mensalidades"
            options={{ title: 'Mensalidades', headerShown: false }}
          />
          <Tabs.Screen name="vendas" options={{ title: 'Vendas', headerShown: false }} />
          <Tabs.Screen
            name="contas-receber"
            options={{ title: 'A receber', headerShown: false }}
          />
          <Tabs.Screen
            name="notas-fiscais"
            options={{ title: 'Notas fiscais', headerShown: false }}
          />
          <Tabs.Screen name="account" options={{ title: 'Conta', headerTitle: 'Minha conta' }} />
          <Tabs.Screen name="configuracoes" options={{ href: null, headerShown: false }} />
        </Tabs>
      </View>
    </View>
  );
}

export default function AppLayout() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <SidebarProvider>
      <AppShell />
    </SidebarProvider>
  );
}
