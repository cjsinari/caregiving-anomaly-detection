import { useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import AuthNavigator from './src/navigation/AuthNavigator';
import { useAppFonts } from './src/theme/fonts';
import { colors } from './src/theme/tokens';

/*
 * The app root.
 *
 * Holds the splash screen until the fonts are registered, so the first frame
 * is the real design rather than a flash of system type that reflows. The
 * splash is hidden from `onLayout` rather than from an effect: that fires once
 * the first view has actually been measured, which is the point at which there
 * is something to show.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Throws only if the splash screen is already gone, which is not a problem.
});

export default function App() {
  const fontsReady = useAppFonts();

  const onLayout = useCallback(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.navy }} onLayout={onLayout}>
        {/* Light status bar content: every screen in the auth flow opens with
            the navy hero running up behind it. */}
        <StatusBar style="light" />
        <NavigationContainer>
          <AuthNavigator />
        </NavigationContainer>
      </View>
    </SafeAreaProvider>
  );
}
