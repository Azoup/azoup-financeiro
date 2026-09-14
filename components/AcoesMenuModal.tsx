import { colors, radius, spacing } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type AcaoMenuItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  busy?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: AcaoMenuItem[];
  onClose: () => void;
};

export function AcoesMenuModal({ visible, title, subtitle, items, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.gray600} />
            </Pressable>
          </View>
          <View style={styles.list}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                style={[styles.row, item.disabled && styles.rowOff]}
                disabled={item.disabled || item.busy}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                {item.busy ? (
                  <ActivityIndicator size="small" color={colors.orange} />
                ) : (
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={item.danger ? colors.danger : colors.petroleum}
                  />
                )}
                <Text style={[styles.label, item.danger && styles.labelDanger]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { fontSize: 16, fontWeight: '800', color: colors.petroleum },
  sub: { fontSize: 13, color: colors.gray600, marginTop: 2 },
  list: { gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowOff: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: '600', color: colors.petroleum },
  labelDanger: { color: colors.danger },
});
