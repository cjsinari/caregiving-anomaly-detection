import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import RootNavigator from './src/navigation/RootNavigator';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { useAppFonts } from './src/theme/fonts';
import { colors } from './src/theme/tokens';

/*
 * The app root.
 *
 * Two things have to finish before the first frame is worth showing: the fonts
 * have to be registered, so the first screen is the real design rather than a
 * flash of system type that reflows, and the stored session has to be read and
 * confirmed, so someone who was signed in last night does not watch a login
 * form appear and then vanish.
 *
 * Both are held behind the splash screen, which is hidden from `onLayout`
 * rather than from an effect: that fires once the first view has actually been
 * measured, which is the point at which there is something to show.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Throws only if the splash screen is already gone, which is not a problem.
});

export default function App() {
  const fontsReady = useAppFonts();

  if (!fontsReady) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/*
 * Inside the provider, so it can wait for the session restore.
 *
 * The splash has to outlast `restoring`, and only a component under the
 * provider can know when that ends. Keeping this separate from App is what
 * lets the provider do its first read while the splash is still up.
 */
function Shell() {
  const { isRestoring } = useAuth();
  const [laidOut, setLaidOut] = useState(false);

  const onLayout = useCallback(() => setLaidOut(true), []);

  /*
   * Hidden from an effect, gated on both conditions.
   *
   * It cannot be hidden from onLayout alone: the restore usually finishes
   * *after* the first layout, and the layout does not happen again when it
   * does, so the splash would stay up for good. It cannot be hidden from the
   * effect alone either -- that can run before anything has been drawn, which
   * is a white flash between the splash and the first screen. So: the first
   * layout says there is something to show, the restore says it is the right
   * thing to show, and the splash goes when both are true.
   */
  useEffect(() => {
    if (laidOut && !isRestoring) SplashScreen.hideAsync().catch(() => {});
  }, [laidOut, isRestoring]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.navy }} onLayout={onLayout}>
      {/* Light status bar content: every screen in the auth flow, and the
          signed-in header, opens with the navy hero running up behind it. */}
      <StatusBar style="light" />
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </View>
  );
}
