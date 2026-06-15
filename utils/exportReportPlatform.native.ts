import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function shareOrDownloadFile(
  filename: string,
  base64: string,
  mime: string,
): Promise<void> {
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: mime, dialogTitle: filename });
  } else if (Platform.OS === 'web') {
    window.open(path, '_blank');
  }
}
