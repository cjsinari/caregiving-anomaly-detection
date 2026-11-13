import { useFonts, Poppins_400Regular, Poppins_500Medium,
  Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';

/*
 * The four Poppins weights every style in tokens.js names.
 *
 * Bundled with the app rather than fetched: this app is used between houses on
 * whatever signal a caregiver has, and a webfont that has not arrived yet
 * means a screen of invisible or reflowing text at exactly the wrong moment.
 *
 * The hook returns false until they are ready, and App.jsx holds the splash
 * screen until then. Four weights and no more -- each one is a file shipped in
 * the APK, and the design only ever distinguishes regular, medium, semibold
 * and bold.
 */
export function useAppFonts() {
  const [loaded, error] = useFonts({
    Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
  });
  // A font that failed to load should not hold the app hostage behind a splash
  // screen forever. React Native falls back to the system face, which is
  // uglier than the mockups and entirely usable.
  return loaded || Boolean(error);
}
