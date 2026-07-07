import { colors, radius, spacing } from '@/theme/colors';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Option = { value: number; label: string };

type Props = {
  label: string;
  hint?: string;
  value: number;
  options: Option[];
  onChange: (value: number) => void;
};

export function NfseEnumField({ label, hint, value, options, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.row, active && styles.rowActive]}
          >
            <View style={[styles.dot, active && styles.dotActive]} />
            <Text style={[styles.rowTxt, active && styles.rowTxtActive]}>
              {opt.value} — {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '700', color: colors.gray800, marginBottom: spacing.xs },
  hint: { fontSize: 11, color: colors.gray600, lineHeight: 16, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    marginBottom: spacing.xs,
    backgroundColor: colors.white,
  },
  rowActive: { borderColor: colors.orange, backgroundColor: '#fff8f0' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.gray400,
  },
  dotActive: { borderColor: colors.orange, backgroundColor: colors.orange },
  rowTxt: { flex: 1, fontSize: 12, color: colors.gray700, lineHeight: 16 },
  rowTxtActive: { color: colors.petroleum, fontWeight: '600' },
});
