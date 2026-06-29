import { Platform, StyleSheet, Text, View } from 'react-native';
import Toast, { type BaseToastProps } from 'react-native-toast-message';
import { colors, radius, spacing } from '@/theme/colors';

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
  info: (props: BaseToastProps) => <WideToast {...props} borderLeftColor={colors.petroleum} />,
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
    width: Platform.OS === 'web' ? 'min(560px, 92vw)' : '92%',
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderLeftWidth: 5,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.gray800,
    lineHeight: 20,
  },
  body: {
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
});
