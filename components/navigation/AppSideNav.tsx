import { BrandLogo } from '@/components/BrandLogo';
import { useEmpresaFiltro } from '@/context/EmpresaFiltroContext';
import { useSidebar } from '@/context/SidebarContext';
import { emitenteLabel } from '@/services/nfseEmitenteService';
import { useTheme } from '@/context/ThemeContext';
import { fonts } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const SIDEBAR_WIDTH_EXPANDED = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 76;

type NavItem = {
  key: string;
  label: string;
  href: string;
  match: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Início',
    href: '/(app)/dashboard',
    match: '/dashboard',
    icon: 'home-outline',
    iconActive: 'home',
  },
  {
    key: 'azoup',
    label: 'Azoup - Web',
    href: '/(app)/azoup',
    match: '/azoup',
    icon: 'planet-outline',
    iconActive: 'planet',
  },
  {
    key: 'clients',
    label: 'Clientes',
    href: '/(app)/clients',
    match: '/clients',
    icon: 'people-outline',
    iconActive: 'people',
  },
  {
    key: 'mensalidades',
    label: 'Mensalidades',
    href: '/(app)/mensalidades',
    match: '/mensalidades',
    icon: 'receipt-outline',
    iconActive: 'receipt',
  },
  {
    key: 'vendas',
    label: 'Vendas',
    href: '/(app)/vendas',
    match: '/vendas',
    icon: 'cart-outline',
    iconActive: 'cart',
  },
  {
    key: 'contas-receber',
    label: 'A receber',
    href: '/(app)/contas-receber',
    match: '/contas-receber',
    icon: 'cash-outline',
    iconActive: 'cash',
  },
  {
    key: 'notas-fiscais',
    label: 'NFS-e',
    href: '/(app)/notas-fiscais',
    match: '/notas-fiscais',
    icon: 'document-text-outline',
    iconActive: 'document-text',
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  {
    key: 'configuracoes',
    label: 'Configurações',
    href: '/(app)/configuracoes',
    match: '/configuracoes',
    icon: 'settings-outline',
    iconActive: 'settings',
  },
  {
    key: 'account',
    label: 'Conta',
    href: '/(app)/account',
    match: '/account',
    icon: 'person-circle-outline',
    iconActive: 'person-circle',
  },
];

function isActive(pathname: string, match: string) {
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function AppSideNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { theme, isDark, toggleTheme } = useTheme();
  const { collapsed, isMobileNav, isOpen, toggle, close } = useSidebar();
  const { empresaId, setEmpresaId, emitentes } = useEmpresaFiltro();

  const targetWidth = isMobileNav
    ? SIDEBAR_WIDTH_EXPANDED
    : collapsed
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED;

  const widthAnim = useRef(new Animated.Value(targetWidth)).current;
  const showLabels = isMobileNav || !collapsed;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: targetWidth,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [targetWidth, widthAnim]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        rail: {
          backgroundColor: theme.sidebarBg,
          borderRightWidth: 1,
          borderRightColor: theme.sidebarSectionDivider,
          overflow: 'hidden',
          zIndex: 40,
        },
        railAbsolute: {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 4, height: 0 },
        },
        railHidden: {
          transform: [{ translateX: -320 }],
        },
        brandRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          marginBottom: 8,
        },
        brandRowCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
        brandMark: {
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        brandMarkTxt: {
          fontFamily: fonts.extrabold,
          fontSize: 18,
          color: theme.textOnPrimary,
        },
        brandName: {
          fontFamily: fonts.extrabold,
          fontSize: 16,
          letterSpacing: -0.3,
          color: theme.sidebarText,
        },
        brandSub: {
          fontFamily: fonts.medium,
          fontSize: 11,
          color: theme.sidebarSubText,
        },
        toggleBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 8,
          marginBottom: 12,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: 'rgba(255,255,255,0.06)',
        },
        toggleBtnCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
        toggleTxt: {
          fontFamily: fonts.semibold,
          fontSize: 12,
          color: theme.sidebarText,
        },
        scroll: { flex: 1 },
        scrollContent: {
          flexGrow: 1,
          paddingHorizontal: 8,
          paddingBottom: 16,
        },
        section: { gap: 4 },
        spacer: { flex: 1, minHeight: 16 },
        item: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 10,
          paddingHorizontal: 10,
          borderRadius: 10,
        },
        itemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
        itemActive: { backgroundColor: theme.sidebarItemActive },
        itemIcon: {
          width: 36,
          height: 36,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
        },
        itemLabel: {
          flex: 1,
          fontFamily: fonts.semibold,
          fontSize: 13,
          color: theme.sidebarText,
          opacity: 0.85,
        },
        itemLabelActive: { opacity: 1, color: theme.sidebarText },
        themeBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: 8,
          paddingVertical: 10,
          paddingHorizontal: 10,
          borderRadius: 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.sidebarSectionDivider,
        },
        themeBtnCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
        themeTxt: {
          fontFamily: fonts.semibold,
          fontSize: 12,
          color: theme.sidebarSubText,
        },
        empresaBox: { marginHorizontal: 12, marginBottom: 12, gap: 4 },
        empresaLab: {
          fontFamily: fonts.semibold,
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: theme.sidebarSubText,
          marginBottom: 2,
        },
        empresaOpt: {
          borderRadius: 8,
          paddingVertical: 7,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: theme.sidebarSectionDivider,
        },
        empresaOptOn: { backgroundColor: theme.sidebarItemActive, borderColor: theme.primary },
        empresaOptTxt: { fontFamily: fonts.medium, fontSize: 12, color: theme.sidebarSubText },
        empresaOptTxtOn: { color: theme.sidebarText, fontFamily: fonts.semibold },
        empresaCollapsed: { alignItems: 'center', marginBottom: 12, paddingVertical: 8 },
      }),
    [theme],
  );

  const go = (href: string) => {
    router.push(href as never);
    if (isMobileNav) close();
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item.match);
    return (
      <Pressable
        key={item.key}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.label}
        onPress={() => go(item.href)}
        style={[styles.item, !showLabels && styles.itemCollapsed, active && styles.itemActive]}
      >
        <View style={styles.itemIcon}>
          <Ionicons
            name={active ? item.iconActive : item.icon}
            size={20}
            color={active ? theme.primary : theme.sidebarIconInactive}
          />
        </View>
        {showLabels ? (
          <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
            {item.label}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  if (isMobileNav && !isOpen) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.rail,
        isMobileNav && styles.railAbsolute,
        {
          width: widthAnim,
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: Math.max(insets.bottom, 14),
        },
      ]}
    >
      <View style={[styles.brandRow, !showLabels && styles.brandRowCollapsed]}>
        <BrandLogo size={40} />
        {showLabels ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.brandName}>Azoup</Text>
            <Text style={styles.brandSub}>Financeiro</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={toggle}
        accessibilityLabel={collapsed || isMobileNav ? 'Retrair ou fechar menu' : 'Retrair menu'}
        style={[styles.toggleBtn, !showLabels && styles.toggleBtnCollapsed]}
      >
        <Ionicons
          name={isMobileNav ? 'close' : collapsed ? 'chevron-forward' : 'chevron-back'}
          size={18}
          color={theme.sidebarText}
        />
        {showLabels ? (
          <Text style={styles.toggleTxt}>{isMobileNav ? 'Fechar' : 'Retrair menu'}</Text>
        ) : null}
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {showLabels ? (
          <View style={styles.empresaBox}>
            <Text style={styles.empresaLab}>Empresa</Text>
            <Pressable
              onPress={() => setEmpresaId('todos')}
              style={[styles.empresaOpt, empresaId === 'todos' && styles.empresaOptOn]}
            >
              <Text style={[styles.empresaOptTxt, empresaId === 'todos' && styles.empresaOptTxtOn]} numberOfLines={1}>
                Todas
              </Text>
            </Pressable>
            {emitentes.map((e) => {
              const on = empresaId === e.id;
              return (
                <Pressable
                  key={e.id}
                  onPress={() => setEmpresaId(e.id)}
                  style={[styles.empresaOpt, on && styles.empresaOptOn]}
                >
                  <Text style={[styles.empresaOptTxt, on && styles.empresaOptTxtOn]} numberOfLines={2}>
                    {e.nome?.trim() || e.razao_social?.trim() || emitenteLabel(e)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Pressable
            onPress={() => {
              const ids = ['todos', ...emitentes.map((e) => e.id)];
              const i = ids.indexOf(empresaId);
              setEmpresaId(ids[(i + 1) % ids.length] ?? 'todos');
            }}
            style={styles.empresaCollapsed}
            accessibilityLabel="Trocar empresa"
          >
            <Ionicons name="business-outline" size={20} color={theme.primary} />
          </Pressable>
        )}
        <View style={styles.section}>{NAV_ITEMS.map(renderItem)}</View>
        <View style={styles.spacer} />
        <View style={styles.section}>
          {BOTTOM_ITEMS.map(renderItem)}
          <Pressable
            onPress={toggleTheme}
            style={[styles.themeBtn, !showLabels && styles.themeBtnCollapsed]}
            accessibilityLabel={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
          >
            <Ionicons
              name={isDark ? 'sunny-outline' : 'moon-outline'}
              size={20}
              color={theme.sidebarIconInactive}
            />
            {showLabels ? (
              <Text style={styles.themeTxt}>{isDark ? 'Modo claro' : 'Modo escuro'}</Text>
            ) : null}
          </Pressable>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

/** Botão hamburger para o header em mobile. */
export function SidebarMenuButton() {
  const { theme } = useTheme();
  const { isMobileNav, toggle } = useSidebar();
  if (!isMobileNav) return null;
  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      style={{ marginLeft: 8, padding: 6 }}
      accessibilityLabel="Abrir menu"
    >
      <Ionicons name="menu" size={22} color={theme.headerText} />
    </Pressable>
  );
}
