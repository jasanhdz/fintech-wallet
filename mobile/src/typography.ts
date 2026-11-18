import { useEffect, useState } from 'react';
import * as Font from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

// Stitch (design/mobile/*/code.html, DESIGN.md) loads Inter 400/500/600/700 only. Each weight is its own family: a
// custom family cannot be combined with fontWeight (Android ignores it, the web synthesizes a faux bold), so styles
// name the family of their weight instead.
export const INTER_FAMILIES = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
} as const;
export const INTER_FONT_MAP = {
  [INTER_FAMILIES['400']]: Inter_400Regular,
  [INTER_FAMILIES['500']]: Inter_500Medium,
  [INTER_FAMILIES['600']]: Inter_600SemiBold,
  [INTER_FAMILIES['700']]: Inter_700Bold,
};

type Weight = keyof typeof INTER_FAMILIES;
const WEIGHT_ALIASES: Record<string, Weight> = { normal: '400', bold: '700', '100': '400', '200': '400', '300': '400', '400': '400', '500': '500', '600': '600', '700': '700', '800': '700', '900': '700' };

export function interFamily(weight: unknown): string {
  return INTER_FAMILIES[WEIGHT_ALIASES[String(weight ?? '400')] ?? '400'];
}

/**
 * Returns a copy of a style map where every typographic entry (fontSize or fontWeight) uses the Inter family of its
 * weight and drops fontWeight. Entries that already name a family (e.g. the monospace demo code) are kept as is.
 */
export function withInter<T extends Record<string, object>>(sheet: T): T {
  const result: Record<string, object> = {};
  for (const [name, style] of Object.entries(sheet)) {
    const entry = style as Record<string, unknown>;
    if (('fontSize' in entry || 'fontWeight' in entry) && !('fontFamily' in entry)) {
      const { fontWeight, ...rest } = entry;
      result[name] = { ...rest, fontFamily: interFamily(fontWeight) };
    } else {
      result[name] = style;
    }
  }
  return result as T;
}

export type Typeface = 'loading' | 'inter' | 'system';
// A font that never arrives must not keep the user out of the app: after this delay the system font is used (F-17:
// 2.5 s instead of 6 s of loading view). The fonts are bundled with the app (native) or served with it (web), so a normal
// load takes a fraction of this; a load that has not finished by then is treated as failed for this app start.
export const FONT_LOAD_TIMEOUT_MS = 2500;

/** Loads Inter before the app renders. Resolves to 'system' (safe fallback) when loading fails or takes too long. */
export function useInterTypeface(onSettled?: (typeface: Exclude<Typeface, 'loading'>) => void): Typeface {
  const [typeface, setTypeface] = useState<Typeface>(() => (Object.values(INTER_FAMILIES).every((family) => Font.isLoaded(family)) ? 'inter' : 'loading'));
  useEffect(() => {
    if (typeface !== 'loading') { onSettled?.(typeface); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'system'>((resolve) => { timer = setTimeout(() => resolve('system'), FONT_LOAD_TIMEOUT_MS); });
    void Promise.race([Font.loadAsync(INTER_FONT_MAP).then(() => 'inter' as const), timeout])
      .catch(() => 'system' as const)
      .then((result) => {
        if (timer) clearTimeout(timer);
        if (!active) return;
        onSettled?.(result);
        setTypeface(result);
      });
    return () => { active = false; if (timer) clearTimeout(timer); };
    // Fonts are loaded once per app start (no dependencies on purpose).
  }, []);
  return typeface;
}
