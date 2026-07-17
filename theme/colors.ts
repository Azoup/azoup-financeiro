/**
 * Tokens estáticos alinhados ao Azoup ERP (modo claro).
 * Telas novas devem preferir `useTheme()` para claro/escuro.
 * Aliases mantêm compatibilidade com código legado (petroleum/orange/gray*).
 */

export const colors = {
  // Brand Azoup
  primary: '#FF8B17',
  secondary: '#0F0F41',
  cadastroAction: '#0F0F41',

  // Legado → Azoup
  petroleum: '#0F0F41',
  petroleumDark: '#0A0A18',
  petroleumLight: '#1A1A3E',
  petroleumMid: '#16163A',
  orange: '#FF8B17',
  orangeDark: '#E07810',
  orangeLight: '#FFA64D',
  orangeSoft: 'rgba(255, 139, 23, 0.10)',
  orangeMuted: 'rgba(255, 139, 23, 0.16)',

  white: '#ffffff',
  gray50: '#F7F7F7',
  gray100: '#EFEFEF',
  gray200: '#E0E0E0',
  gray400: '#999999',
  gray600: '#666666',
  gray800: '#333333',

  danger: '#FF0000',
  dangerSoft: '#FEF2F2',
  success: '#166534',
  successSoft: '#F0FDF4',
  infoSoft: 'rgba(15, 15, 65, 0.06)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

/** Sombras suaves padrão (estilo Azoup / shadcn). */
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
} as const;

/** Altura padrão de controles de formulário (Azoup). */
export const FORM_CONTROL_HEIGHT = 36;
