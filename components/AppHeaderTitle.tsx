import { BrandLogo } from '@/components/BrandLogo';
import { useTheme } from '@/context/ThemeContext';
import { fonts } from '@/theme/typography';
import { StyleSheet, Text, View } from 'react-native';

export function AppHeaderTitle({ children }: { children?: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <BrandLogo size={28} />
      <Text style={[styles.title, { color: theme.headerText }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 360 },
  title: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2 },
});
