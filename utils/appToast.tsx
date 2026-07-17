import { colors, radius, shadows, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Toast, { type BaseToastProps } from 'react-native-toast-message';

const VISIBILITY_MS = 14000;

function splitLongMessage(message: string): { title: string; body?: string } {
  const text = message.trim();
  if (text.length <= 72) return { title: text };
  const breakAt = text.lastIndexOf(' ', 72);
  const idx = breakAt > 40 ? breakAt : 72;
  return {
    title: text.slice(0, idx).trim(),
    body: text.slice(idx).trim(),
  };
}

function WideToast({ text1, text2, style, borderLeftColor }: BaseToastProps & { borderLeftColor: string }) {
  return (
    <View style={[toastStyles.card, style, { borderLeftColor }]}>
      {text1 ? <Text style={toastStyles.title}>{text1}</Text> : null}
      {text2 ? <Text style={toastStyles.body}>{text2}</Text> : null}
    </View>
  );
}

export const appToastConfig = {
  success: (props: BaseToastProps) => <WideToast {...props} borderLeftColor={colors.success} />,
  error: (props: BaseToastProps) => <WideToast {...props} borderLeftColor={colors.danger} />,
  info: (props: BaseToastProps) => <WideToast {...props} borderLeftColor={colors.orange} />,
};

export function showAppToast(
  type: 'success' | 'error' | 'info',
  message: string,
  subtitle?: string,
): void {
  const { title, body } = splitLongMessage(message);
  Toast.show({
    type,
    text1: title,
    text2: subtitle ?? body,
    position: 'top',
    topOffset: Platform.OS === 'web' ? 72 : 48,
    visibilityTime: VISIBILITY_MS,
  });
}

export function showAppError(message: string, subtitle?: string): void {
  showAppToast('error', message, subtitle);
}

export function showAppSuccess(message: string, subtitle?: string): void {
  showAppToast('success', message, subtitle);
}

export function showAppInfo(message: string, subtitle?: string): void {
  showAppToast('info', message, subtitle);
}

const toastStyles = StyleSheet.create({
  card: {
    width: Platform.OS === 'web' ? ('min(560px, 92vw)' as unknown as number) : '92%',
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.gray800,
    lineHeight: 20,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
});
