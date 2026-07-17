import { HomeStatCard } from '@/components/ui/HomeStatCard';
import type { AppTheme } from '@/context/ThemeContext';
import { getHomeDashboardLayoutStyles } from '@/styles/homeDashboardLayoutStyles';
import React, { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';

export type HomeStatCardItem = {
  id?: string;
  icon: React.ComponentProps<typeof HomeStatCard>['icon'];
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
};

type Props = {
  cards: HomeStatCardItem[];
  theme: AppTheme;
  isMobile?: boolean;
  isPhone?: boolean;
  style?: ViewStyle;
};

export function HomeStatCardsGrid({
  cards = [],
  theme,
  isMobile = false,
  isPhone = false,
  style,
}: Props) {
  const layout = useMemo(() => getHomeDashboardLayoutStyles(), []);

  const cardWidth = isPhone
    ? layout.homeStatCardWidthPhone
    : isMobile
      ? layout.homeStatCardWidthMobile
      : layout.homeStatCardWidthDesktop;

  return (
    <View
      style={[layout.homeMetricsGrid, isMobile && layout.homeMetricsGridMobile, style]}
    >
      {cards.map((card) => (
        <HomeStatCard
          key={card.id || card.title}
          icon={card.icon}
          title={card.title}
          value={card.value}
          change={card.change}
          changeType={card.changeType || 'neutral'}
          theme={theme}
          widthStyle={cardWidth}
          isPhone={isPhone}
        />
      ))}
    </View>
  );
}
