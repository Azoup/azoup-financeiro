import { Stack } from 'expo-router';
import { colors } from '@/theme/colors';
import { fonts } from '@/theme/typography';

export default function AzoupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.petroleum },
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontFamily: fonts.bold,
          fontSize: 17,
          letterSpacing: -0.2,
        },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Azoup - Web' }} />
    </Stack>
  );
}
