import type { AppTheme } from '@/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  theme: AppTheme;
  widthStyle?: ViewStyle;
  isPhone?: boolean;
};

/** Card de estatística (estilo Azoup / shadcn StatsCard). */
export function HomeStatCard({
  icon,
  title,
  value,
  change,
  changeType = 'neutral',
  theme,
  widthStyle,
  isPhone = false,
}: Props) {
  const changeColor =
    changeType === 'positive'
      ? theme.mode === 'light'
        ? '#059669'
        : '#34d399'
      : changeType === 'negative'
        ? theme.error
        : theme.textMuted;

  return (
    <View style={[styles.outer, widthStyle]}>
      <View
        style={[
          styles.card,
          isPhone && styles.cardPhone,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={[styles.header, isPhone && styles.headerPhone]}>
          <Text
            style={[styles.title, isPhone && styles.titlePhone, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Ionicons name={icon} size={isPhone ? 14 : 15} color={theme.textMuted} />
        </View>
        <View style={[styles.content, isPhone && styles.contentPhone]}>
          <Text
            style={[styles.value, isPhone && styles.valuePhone, { color: theme.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {value}
          </Text>
          <View style={styles.changeSlot}>
            {change ? (
              <View style={styles.changeRow}>
                {changeType === 'positive' ? (
                  <Ionicons name="arrow-up" size={10} color={changeColor} />
                ) : changeType === 'negative' ? (
                  <Ionicons name="arrow-down" size={10} color={changeColor} />
                ) : null}
                <Text style={[styles.change, { color: changeColor }]} numberOfLines={1}>
                  {change}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flexGrow: 0,
    flexShrink: 0,
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  card: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
  cardPhone: { borderRadius: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerPhone: { paddingTop: 7, paddingBottom: 3 },
  title: { flex: 1, fontSize: 11, fontWeight: '600', lineHeight: 14 },
  titlePhone: { fontSize: 10, lineHeight: 13 },
  content: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    paddingTop: 0,
    gap: 2,
  },
  contentPhone: { paddingBottom: 7 },
  value: { fontSize: 17, fontWeight: '800', lineHeight: 20 },
  valuePhone: { fontSize: 16, lineHeight: 19 },
  changeSlot: { minHeight: 14, justifyContent: 'center' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  change: { fontSize: 10, fontWeight: '500', flexShrink: 1 },
});
