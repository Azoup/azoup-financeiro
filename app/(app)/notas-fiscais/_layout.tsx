import { Stack } from 'expo-router';

export default function NotasFiscaisLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0D3B4F' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Notas fiscais' }} />
    </Stack>
  );
}
