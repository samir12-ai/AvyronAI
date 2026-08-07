import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, ScrollView, Modal, Animated } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppShellController, AppShellController, ShellMonitoringState } from '@/hooks/useAppShellController';
import { AccountSwitcherModal } from '@/components/AccountSwitcherModal';

const NAV_ITEMS = [
  { name: 'index', label: 'Dashboard', icon: 'grid' },
  { name: 'what-to-do-today', label: 'What To Do Today', icon: 'check-square' },
  { name: 'strategy-plan', label: 'Strategy Plan', icon: 'map' },
  { name: 'market-intelligence', label: 'Market Intelligence', icon: 'globe' },
  { name: 'audience-positioning', label: 'Audience & Positioning', icon: 'users' },
  { name: 'create', label: 'Content & Creative', icon: 'pen-tool' },
  { name: 'performance', label: 'Performance', icon: 'trending-up' },
  { name: 'watchtower', label: 'Watchtower', icon: 'eye' },
  { name: 'reasoning-evidence', label: 'Reasoning & Evidence', icon: 'cpu' },
  { name: 'reports', label: 'Reports', icon: 'file-text' },
  { name: 'integrations', label: 'Integrations', icon: 'link' },
  { name: 'settings', label: 'Settings', icon: 'settings' },
];

function PremiumRadar({ monitoring }: { monitoring: ShellMonitoringState }) {
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    rotationAnim.stopAnimation();
    pulseAnim.stopAnimation();

    if (monitoring.status === 'OFFLINE' || monitoring.status === 'NO_SOURCES') {
      rotationAnim.setValue(0);
      pulseAnim.setValue(0);
      return;
    }

    if (monitoring.isScanning && monitoring.status === 'LIVE') {
      // Live scanning animation
      Animated.loop(
        Animated.timing(rotationAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
          isInteraction: false,
        })
      ).start();

      Animated.loop(
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
          isInteraction: false,
        })
      ).start();
    } else {
      // Idle / Degraded breathing animation
      pulseAnim.setValue(0);
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: monitoring.status === 'DEGRADED' ? 4000 : 2500,
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: monitoring.status === 'DEGRADED' ? 4000 : 2500,
            useNativeDriver: true,
            isInteraction: false,
          }),
        ])
      ).start();
    }
  }, [monitoring.status, monitoring.isScanning, rotationAnim, pulseAnim]);

  const rotateInterpolation = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  const isDegraded = monitoring.status === 'DEGRADED';
  const color = isDegraded ? '#F59E0B' : '#8B5CF6'; // Amber if degraded, Purple if live/active
  const hasSignals = monitoring.isScanning && monitoring.status === 'LIVE';

  return (
    <View style={styles.radarWrapper}>
      {/* Expanding Pulse */}
      <Animated.View style={[
        styles.radarCircle, styles.radarOuter,
        {
          borderColor: color,
          opacity: pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.4, 0]
          }),
          transform: [{
            scale: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.4]
            })
          }]
        }
      ]} />
      
      {/* Static Radar Rings */}
      <View style={[styles.radarCircle, styles.radarOuter, { borderColor: `${color}30` }]} />
      <View style={[styles.radarCircle, styles.radarMiddle, { borderColor: `${color}50` }]} />
      <View style={[styles.radarCircle, styles.radarInner, { borderColor: `${color}70` }]} />

      {/* Rotating Beam */}
      {hasSignals && (
        <Animated.View style={[
          styles.radarBeamWrapper,
          { transform: [{ rotate: rotateInterpolation }] }
        ]}>
          <View style={[styles.radarBeam, { backgroundColor: `${color}50` }]} />
        </Animated.View>
      )}

      {/* Moving Signal Dots */}
      {hasSignals && (
        <>
          <Animated.View style={[
            styles.radarSignalDot, { top: '25%', left: '30%', backgroundColor: color },
            { opacity: pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }) }
          ]} />
          <Animated.View style={[
            styles.radarSignalDot, { bottom: '35%', right: '25%', backgroundColor: color },
            { opacity: pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 1] }) }
          ]} />
        </>
      )}

      {/* Glowing Center */}
      <Animated.View style={[
        styles.radarCenter,
        { 
          backgroundColor: color,
          transform: [{
            scale: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.25]
            })
          }]
        }
      ]} />
    </View>
  );
}

function SidebarContent({ controller, isCollapsed, onNavigate }: { controller: AppShellController, isCollapsed: boolean, onNavigate: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const currentRouteName = pathname === '/' || pathname === '' ? 'index' : pathname.replace(/^\//, '');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const handlePress = (name: string) => {
    const target = name === 'index' ? '/' : `/(tabs)/${name}`;
    router.navigate(target as any);
    onNavigate();
  };

  const renderMarketWidget = () => {
    if (isCollapsed) return null;
    const { monitoring } = controller;

    let badgeText = 'Offline';
    let statusColor = ShellTheme.colors.textDeepMuted;
    
    if (monitoring.status === 'LIVE') {
      badgeText = 'Live';
      statusColor = '#10B981'; // Green
    } else if (monitoring.status === 'MONITORING') {
      badgeText = 'Active';
      statusColor = '#10B981'; // Green for active too, but amber if degraded
    } else if (monitoring.status === 'DEGRADED') {
      badgeText = 'Degraded';
      statusColor = '#F59E0B'; // Amber
    }

    const hasSources = monitoring.status !== 'NO_SOURCES' && monitoring.status !== 'OFFLINE';

    return (
      <View style={styles.marketWidget}>
        <View style={styles.marketWidgetHeader}>
          <Text style={styles.marketWidgetTitle}>Market is {badgeText}</Text>
          {hasSources && (
            <View style={[styles.marketWidgetBadge, { backgroundColor: statusColor + '20' }]}>
              <Text style={[styles.marketWidgetBadgeText, { color: statusColor }]}>{badgeText}</Text>
            </View>
          )}
        </View>
        <Text style={styles.marketWidgetText}>
          {monitoring.competitorsCount 
            ? `Monitoring ${monitoring.competitorsCount} competitors` 
            : 'No active competitors configured'}
        </Text>
        <PremiumRadar monitoring={monitoring} />
      </View>
    );
  };

  return (
    <>
      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        {NAV_ITEMS.map((item) => {
          const isSelected = currentRouteName === item.name || currentRouteName.startsWith(item.name);
          let badgeValue: number | null = null;
          if (item.name === 'what-to-do-today') badgeValue = controller.badges.whatToDoToday;
          if (item.name === 'watchtower') badgeValue = controller.badges.watchtower;

          return (
            <Pressable
              key={item.name}
              onPress={() => handlePress(item.name)}
              style={[
                styles.navItem,
                isSelected && styles.navItemSelected,
                isCollapsed && styles.navItemCollapsed
              ]}
            >
              <Feather 
                name={item.icon as any} 
                size={18} 
                color={isSelected ? '#FFFFFF' : '#9CA3AF'} 
              />
              {!isCollapsed && (
                <Text style={[
                  styles.navLabel,
                  isSelected && styles.navLabelSelected
                ]}>
                  {item.label}
                </Text>
              )}
              
              {!isCollapsed && badgeValue !== null && (
                <View style={[styles.navBadge, isSelected && styles.navBadgeSelected]}>
                  <Text style={[styles.navBadgeText, isSelected && styles.navBadgeTextSelected]}>{badgeValue}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
        {renderMarketWidget()}
      </ScrollView>

      {/* Footer Area: User Profile & Workspace Switcher */}
      <View style={styles.footerContainer}>
        {/* Clickable User Profile (opens Account Switcher) */}
        <Pressable 
          style={[styles.userContainer, isCollapsed && { justifyContent: 'center' }]}
          onPress={controller.openAccountSwitcher}
        >
          <View style={styles.userAvatar}>
            <Text style={styles.userInitials}>{controller.userProfile?.initials || '?'}</Text>
          </View>
          {!isCollapsed && (
            <View style={styles.userInfo}>
              <Text style={styles.userName} numberOfLines={1}>{controller.userProfile?.displayName || 'Account User'}</Text>
              <Text style={styles.userEmail} numberOfLines={1}>{controller.userProfile?.email || ''}</Text>
              <Text style={styles.userRole} numberOfLines={1}>{controller.userProfile?.role || 'Workspace Member'}</Text>
            </View>
          )}
          {!isCollapsed && (
            <Feather name="more-horizontal" size={16} color="#6B7280" />
          )}
        </Pressable>

        {/* Separated Workspace Switcher removed - moved to page headers per mockup */}
      </View>
    </>
  );
}

export default function AppShellLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width > 1024;
  const isTablet = width > 768 && width <= 1024;
  const isMobile = width <= 768;

  const controller = useAppShellController();
  const [menuOpen, setMenuOpen] = useState(false);

  // Mobile Top Header & Drawer
  if (isMobile) {
    return (
      <View style={{ flex: 1, backgroundColor: ShellTheme.colors.appBackground }}>
        <View style={[styles.mobileHeader, { paddingTop: Math.max(insets.top, 16) }]}>
          <Text style={styles.brandText}>AVYRON <Text style={styles.brandAccent}>AI</Text></Text>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.hamburger}>
            <Feather name="menu" size={24} color={ShellTheme.colors.textPrimary} />
          </Pressable>
        </View>

        <Modal visible={menuOpen} animationType="slide" transparent>
          <View style={styles.mobileMenuContainer}>
            <View style={[styles.mobileMenuHeader, { paddingTop: Math.max(insets.top, 16) }]}>
              <Text style={styles.brandText}>MENU</Text>
              <Pressable onPress={() => setMenuOpen(false)} style={styles.hamburger}>
                <Feather name="x" size={24} color={ShellTheme.colors.textPrimary} />
              </Pressable>
            </View>
            <SidebarContent controller={controller} isCollapsed={false} onNavigate={() => setMenuOpen(false)} />
          </View>
        </Modal>

        <Tabs 
          tabBar={() => null} 
          screenOptions={{ 
            headerShown: false, 
            tabBarStyle: { display: 'none' },
            sceneStyle: { backgroundColor: ShellTheme.colors.appBackground } 
          }}
        >
          {NAV_ITEMS.map(item => <Tabs.Screen key={item.name} name={item.name} />)}
          <Tabs.Screen name="studio" options={{ href: null }} />
          <Tabs.Screen name="calendar" options={{ href: null }} />
          <Tabs.Screen name="ai-management" options={{ href: null }} />
        </Tabs>
      </View>
    );
  }

  // Desktop / Tablet Flex Row Layout
  const sidebarWidth = isDesktop ? 260 : 80;

  return (
    <View style={styles.desktopLayout}>
      <View style={[styles.sidebar, { width: sidebarWidth, paddingTop: Math.max(insets.top, 24) }]}>
        <View style={styles.brandContainer}>
          {isDesktop ? (
            <View style={styles.brandRow}>
              <View style={styles.brandIconBlock}><Text style={styles.brandIconText}>A</Text></View>
              <Text style={styles.brandText}>AVYRON <Text style={styles.brandAccent}>AI</Text></Text>
            </View>
          ) : (
            <Text style={styles.brandTextIcon}>A</Text>
          )}
        </View>
        <SidebarContent controller={controller} isCollapsed={!isDesktop} onNavigate={() => {}} />
      </View>
      
      <View style={styles.mainContent}>
        <Tabs 
          tabBar={() => null} 
          screenOptions={{ 
            headerShown: false, 
            tabBarStyle: { display: 'none' },
            sceneStyle: { backgroundColor: ShellTheme.colors.appBackground } 
          }}
        >
          {NAV_ITEMS.map(item => <Tabs.Screen key={item.name} name={item.name} />)}
          <Tabs.Screen name="studio" options={{ href: null }} />
          <Tabs.Screen name="calendar" options={{ href: null }} />
          <Tabs.Screen name="ai-management" options={{ href: null }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopLayout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: ShellTheme.colors.appBackground,
  },
  sidebar: {
    backgroundColor: '#080C10',
    borderRightWidth: 1,
    borderRightColor: ShellTheme.colors.border,
    justifyContent: 'space-between', // Ensures footer is at bottom
  },
  mainContent: {
    flex: 1,
  },
  brandContainer: {
    paddingHorizontal: 24,
    marginBottom: 24,
    height: 32,
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIconBlock: {
    backgroundColor: '#4C1D95',
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  brandIconText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  brandText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandAccent: {
    color: '#8B5CF6',
  },
  brandTextIcon: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8B5CF6',
    alignSelf: 'center',
  },
  navScroll: {
    flex: 1,
    paddingHorizontal: 12,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: 8,
  },
  navItemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    width: 48,
    alignSelf: 'center',
  },
  navItemSelected: {
    backgroundColor: '#4C1D95',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    paddingRight: 16,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    marginLeft: 12,
    flex: 1,
  },
  navLabelSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  navBadge: {
    backgroundColor: '#374151',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  navBadgeSelected: {
    backgroundColor: '#DC2626', // Red badge when active as per mockup
  },
  navBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  navBadgeTextSelected: {
    color: '#FFFFFF',
  },
  
  // Footer Area (User Profile)
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: ShellTheme.colors.border,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#080C10',
  },
  userContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
    borderRadius: 8,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4C1D95',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#6D28D9',
  },
  userInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userInfo: {
    marginLeft: 12,
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  userEmail: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  userRole: {
    fontSize: 10,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: '#8B5CF6',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  
  // Workspace Switcher
  workspaceContainer: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  workspaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F131A',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  workspaceButtonActive: {
    borderColor: '#4C1D95',
    backgroundColor: '#161B22',
  },
  workspaceIconPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceIconText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  workspaceInfo: {
    flex: 1,
    marginLeft: 12,
  },
  workspaceLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    color: '#6B7280',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  workspaceName: {
    fontSize: 13,
    color: '#E5E7EB',
    fontWeight: '600',
    marginTop: 2,
  },
  workspaceDropdown: {
    marginTop: 8,
    backgroundColor: '#161B22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  workspaceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  workspaceOptionActive: {
    backgroundColor: '#4C1D95',
  },
  workspaceOptionText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  workspaceOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // Market Widget
  marketWidget: {
    margin: 12,
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(22, 27, 34, 0.4)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  marketWidgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  marketWidgetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  marketWidgetBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  marketWidgetBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  marketWidgetText: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  
  // Premium Radar Styles
  radarWrapper: {
    marginTop: 24,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarCircle: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 1,
  },
  radarOuter: { width: 90, height: 90 },
  radarMiddle: { width: 60, height: 60 },
  radarInner: { width: 30, height: 30 },
  radarCenter: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  radarBeamWrapper: {
    position: 'absolute',
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  radarBeam: {
    width: 1.5,
    height: 45,
    borderRadius: 1,
  },
  radarSignalDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  // Mobile Overrides
  mobileHeader: {
    height: 70,
    backgroundColor: '#080C10',
    borderBottomWidth: 1,
    borderBottomColor: ShellTheme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    zIndex: 50,
  },
  hamburger: {
    padding: 8,
  },
  mobileMenuContainer: {
    flex: 1,
    backgroundColor: '#080C10',
  },
  mobileMenuHeader: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: ShellTheme.colors.border,
    marginBottom: 24,
  },
});

