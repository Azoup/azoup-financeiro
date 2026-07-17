import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/** Breakpoints documentados no SYSTEM_DESIGN Azoup. */
export const BREAKPOINTS = {
  phone: 480,
  mobile: 768,
  mobileNav: 1024,
} as const;

export type ResponsiveLayout = {
  width: number;
  height: number;
  isPhone: boolean;
  isMobile: boolean;
  isMobileNav: boolean;
  isDesktop: boolean;
};

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return useMemo(
    () => ({
      width,
      height,
      isPhone: width < BREAKPOINTS.phone,
      isMobile: width < BREAKPOINTS.mobile,
      isMobileNav: width < BREAKPOINTS.mobileNav,
      isDesktop: width >= BREAKPOINTS.mobileNav,
    }),
    [width, height],
  );
}
