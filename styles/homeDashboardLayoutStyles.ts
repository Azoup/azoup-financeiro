import { StyleSheet } from 'react-native';

/** Estilos de layout de dashboard (Azoup ERP). */
export function getHomeDashboardLayoutStyles() {
  return StyleSheet.create({
    mainAreaHome: {
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    mainAreaHomeMobile: {
      paddingTop: 10,
      paddingHorizontal: 10,
      paddingBottom: 12,
    },
    mainAreaHomePhone: {
      paddingTop: 8,
      paddingHorizontal: 8,
      paddingBottom: 10,
    },
    homeScrollContent: {
      paddingBottom: 24,
      flexGrow: 1,
    },
    homeSectionTitle: {
      fontSize: 15,
      fontWeight: '700',
    },
    homePageSubtitle: {
      fontSize: 12,
      marginTop: 2,
    },
    homeMetricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      gap: 8,
      marginTop: 2,
      justifyContent: 'flex-start',
      width: '100%',
    },
    homeMetricsGridMobile: {
      gap: 6,
    },
    homeStatCardWidthDesktop: {
      width: '23.5%',
      minWidth: 128,
      flexGrow: 0,
      flexShrink: 0,
    },
    homeStatCardWidthMobile: {
      width: '48%',
      maxWidth: '48%',
      flexBasis: '48%',
      flexGrow: 0,
      flexShrink: 0,
      minWidth: 0,
    },
    homeStatCardWidthPhone: {
      width: '100%',
      maxWidth: '100%',
      flexBasis: '100%',
      flexGrow: 0,
      flexShrink: 0,
      minWidth: 0,
    },
    homeListCard: {
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      marginTop: 12,
    },
    homeColumnsRow: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
      marginTop: 4,
    },
    homeColumnHalf: {
      flex: 1,
      minWidth: 280,
    },
    homeBottomRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      marginTop: 8,
      width: '100%',
    },
    homeBottomRowMobile: {
      flexDirection: 'column',
    },
    homeSurfacePanel: {
      flex: 1,
      minHeight: 180,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      width: '100%',
      maxWidth: '100%',
      alignSelf: 'stretch',
    },
    homeSurfacePanelMobile: {
      minWidth: 0,
      padding: 10,
      borderRadius: 10,
    },
    shortcutsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
  });
}
