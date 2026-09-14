import { Image, type ImageStyle, type StyleProp } from 'react-native';

const source = require('@/assets/azoup-logo.png');

export function BrandLogo({ size = 36, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={source}
      accessibilityLabel="Azoup"
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
}
