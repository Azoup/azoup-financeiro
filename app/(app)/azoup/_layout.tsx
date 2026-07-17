import { useThemedStackOptions } from '@/hooks/useThemedStackOptions';
import { Stack } from 'expo-router';

export default function AzoupLayout() {
  const themed = useThemedStackOptions();
  return (
    <Stack screenOptions={themed}>
      <Stack.Screen name="index" options={{ title: 'Azoup - Web' }} />
    </Stack>
  );
}
