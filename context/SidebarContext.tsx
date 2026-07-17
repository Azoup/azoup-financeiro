import AsyncStorage from '@react-native-async-storage/async-storage';
import { BREAKPOINTS } from '@/utils/responsiveLayout';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

const STORAGE_KEY = 'azoup.sidebar.collapsed';

type SidebarContextValue = {
  /** Desktop: rail estreito (só ícones). Mobile: false = drawer aberto. */
  collapsed: boolean;
  /** Mobile/tablet (<1024): sidebar como overlay. */
  isMobileNav: boolean;
  /** Mobile: drawer visível. Desktop: sempre true (rail fixo). */
  isOpen: boolean;
  ready: boolean;
  setCollapsed: (value: boolean) => void;
  toggle: () => void;
  open: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const isMobileNav = width < BREAKPOINTS.mobileNav;
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!alive) return;
        if (raw === '1' || raw === '0') {
          setCollapsedState(raw === '1');
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (isMobileNav) setMobileOpen(false);
  }, [isMobileNav]);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    void AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0').catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    if (isMobileNav) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsedState((prev) => {
      const next = !prev;
      void AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, [isMobileNav]);

  const open = useCallback(() => {
    if (isMobileNav) setMobileOpen(true);
    else setCollapsed(false);
  }, [isMobileNav, setCollapsed]);

  const close = useCallback(() => {
    if (isMobileNav) setMobileOpen(false);
  }, [isMobileNav]);

  const isOpen = isMobileNav ? mobileOpen : true;
  const effectiveCollapsed = isMobileNav ? false : collapsed;

  const value = useMemo(
    () => ({
      collapsed: effectiveCollapsed,
      isMobileNav,
      isOpen,
      ready,
      setCollapsed,
      toggle,
      open,
      close,
    }),
    [effectiveCollapsed, isMobileNav, isOpen, ready, setCollapsed, toggle, open, close],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar deve ser usado dentro de SidebarProvider.');
  return ctx;
}
