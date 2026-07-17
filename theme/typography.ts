/**
 * Tipografia Outfit (geométrica moderna).
 * Use fonts.* em StyleSheet; o FontProvider carrega as faces.
 */
export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  extrabold: 'Outfit_800ExtraBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.extrabold, fontSize: 28, letterSpacing: -0.4, lineHeight: 34 },
  title: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.2, lineHeight: 26 },
  section: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.1, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: 0.1 },
} as const;
