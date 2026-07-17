import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

export const THEME_KEY = '@azoup_theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

export type AppTheme = {
  mode: 'light' | 'dark';
  primary: string;
  brandPrimary: string;
  secondary: string;
  cadastroAction: string;
  accentProduction: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  surfaceElevated: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarSubText: string;
  sidebarItemActive: string;
  sidebarSectionDivider: string;
  sidebarIconInactive: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textLight: string;
  textOnPrimary: string;
  border: string;
  borderStrong: string;
  borderInput: string;
  inputBg: string;
  inputText: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  error: string;
  errorSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  shadowColor: string;
  shadowOpacity: number;
};

export const lightTheme: AppTheme = {
  mode: 'light',
  primary: '#FF8B17',
  brandPrimary: '#FF8B17',
  secondary: '#0F0F41',
  cadastroAction: '#0F0F41',
  accentProduction: '#0F0F41',
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceVariant: '#F0F0F0',
  surfaceElevated: '#FFFFFF',
  sidebarBg: '#0F0F41',
  sidebarText: '#FFFFFF',
  sidebarSubText: 'rgba(255,255,255,0.5)',
  sidebarItemActive: 'rgba(255, 139, 23, 0.1)',
  sidebarSectionDivider: 'rgba(255,255,255,0.1)',
  sidebarIconInactive: '#AAA',
  text: '#0F0F41',
  textSecondary: '#666666',
  textMuted: '#999999',
  textLight: '#FFFFFF',
  textOnPrimary: '#FFFFFF',
  border: '#EFEFEF',
  borderStrong: '#E0E0E0',
  borderInput: '#E0E0E0',
  inputBg: '#F9F9F9',
  inputText: '#333333',
  headerBg: '#FFFFFF',
  headerBorder: '#EEEEEE',
  headerText: '#0F0F41',
  error: '#FF0000',
  errorSurface: '#FEF2F2',
  success: '#166534',
  successSurface: '#F0FDF4',
  warning: '#B45309',
  warningSurface: '#FFFBEB',
  shadowColor: '#000',
  shadowOpacity: 0.1,
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  primary: '#FF8B17',
  brandPrimary: '#FF8B17',
  secondary: '#E8E8FF',
  cadastroAction: '#FF8B17',
  accentProduction: '#FF8B17',
  background: '#0D0D1A',
  surface: '#161628',
  surfaceVariant: '#1E1E35',
  surfaceElevated: '#22223C',
  sidebarBg: '#0A0A18',
  sidebarText: '#F0F0FF',
  sidebarSubText: 'rgba(255,255,255,0.35)',
  sidebarItemActive: 'rgba(255, 139, 23, 0.15)',
  sidebarSectionDivider: 'rgba(255,255,255,0.07)',
  sidebarIconInactive: '#6B6B8A',
  text: '#E8E8FF',
  textSecondary: '#9898BB',
  textMuted: '#66667A',
  textLight: '#FFFFFF',
  textOnPrimary: '#FFFFFF',
  border: '#2A2A45',
  borderStrong: '#35355A',
  borderInput: '#35355A',
  inputBg: '#1E1E35',
  inputText: '#E8E8FF',
  headerBg: '#161628',
  headerBorder: '#2A2A45',
  headerText: '#E8E8FF',
  error: '#FF6B6B',
  errorSurface: '#2D1515',
  success: '#4ADE80',
  successSurface: '#14291F',
  warning: '#FBBF24',
  warningSurface: '#2D2010',
  shadowColor: '#000',
  shadowOpacity: 0.4,
};

function readInitialIsDark() {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem(THEME_KEY);
      if (val === THEME_DARK) return true;
      if (val === THEME_LIGHT) return false;
      localStorage.setItem(THEME_KEY, THEME_LIGHT);
      return false;
    } catch {
      return false;
    }
  }
  return false;
}

function applyStoredTheme(val: string | null) {
  if (val === THEME_DARK) return true;
  if (val === THEME_LIGHT) return false;
  void AsyncStorage.setItem(THEME_KEY, THEME_LIGHT).catch(() => undefined);
  return false;
}

type ThemeContextValue = {
  theme: AppTheme;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: lightTheme,
  isDark: false,
  toggleTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(readInitialIsDark);

  useEffect(() => {
    void AsyncStorage.getItem(THEME_KEY)
      .then((val) => setIsDark(applyStoredTheme(val)))
      .catch(() => undefined);
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      const key = next ? THEME_DARK : THEME_LIGHT;
      void AsyncStorage.setItem(THEME_KEY, key).catch(() => undefined);
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(THEME_KEY, key);
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const theme = isDark ? darkTheme : lightTheme;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'azoup-theme-web-form-controls';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    const t = isDark ? darkTheme : lightTheme;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    const chevronStroke = isDark ? '#9898BB' : '#666666';
    const chevronSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${chevronStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
    const chevronDataUrl = `data:image/svg+xml,${encodeURIComponent(chevronSvg)}`;
    const primary = t.primary;
    const ph = primary.replace('#', '');
    const pr = ph.length === 6 ? parseInt(ph.slice(0, 2), 16) : 255;
    const pg = ph.length === 6 ? parseInt(ph.slice(2, 4), 16) : 139;
    const pb = ph.length === 6 ? parseInt(ph.slice(4, 6), 16) : 23;
    const focusRing = `0 0 0 3px rgba(${pr}, ${pg}, ${pb}, 0.22)`;
    el.textContent = `
      html { color-scheme: ${isDark ? 'dark' : 'light'}; }
      select {
        -webkit-appearance: none !important;
        appearance: none !important;
        border: none !important;
        color: ${t.inputText} !important;
        background-color: transparent !important;
        background-image: url("${chevronDataUrl}");
        background-repeat: no-repeat;
        background-position: right 10px center;
        background-size: 18px 18px;
        padding: 0 32px 0 12px !important;
      }
      select option, select optgroup {
        color: ${t.inputText} !important;
        background-color: ${t.surface} !important;
      }
      input:not([type="checkbox"]):not([type="radio"]),
      textarea {
        box-sizing: border-box;
        min-height: 36px;
        border-radius: 8px !important;
        border: 1px solid ${t.borderInput} !important;
        padding: 8px 12px !important;
        font-size: 14px !important;
        color: ${t.text} !important;
        background-color: ${t.surface} !important;
      }
      input:not([type="checkbox"]):not([type="radio"]):focus,
      textarea:focus {
        outline: none !important;
        border-color: ${primary} !important;
        box-shadow: ${focusRing} !important;
      }
    `;
  }, [isDark]);

  const value = useMemo(() => ({ theme, isDark, toggleTheme }), [theme, isDark, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
