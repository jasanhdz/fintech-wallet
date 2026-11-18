// WCAG 2.x contrast helpers (A11Y-04). Pure functions plus an in-page collector of visible text nodes.
import type { Page } from '@playwright/test';

export type Rgba = [number, number, number, number];

export function parseColor(value: string): Rgba {
  // WF-T4: `color-mix(in srgb, …)` of two tokens computes to `color(srgb r g b [/ a])` with 0–1 channels.
  const srgb = /color\(srgb ([^)]+)\)/.exec(value);
  if (srgb) {
    const parts = srgb[1]!.split(/[ /]+/).filter(Boolean).map(Number);
    return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
  }
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) throw new Error(`unsupported color ${value}`);
  const parts = match[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Composites `top` (with alpha) over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = foreground[3] < 1 ? over(foreground, background) : foreground;
  const [light, dark] = [luminance(fg), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Large text per WCAG: ≥24 px, or ≥18.66 px when bold (≥700). */
export const isLargeText = (fontSizePx: number, fontWeight: number) => fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);

export type TextSample = { text: string; color: string; background: string; fontSize: number; fontWeight: number };

/** Visible, enabled text-bearing elements with their effective (first opaque ancestor) background. */
export async function collectTextSamples(page: Page): Promise<TextSample[]> {
  return page.evaluate(() => {
    const samples: TextSample[] = [];
    const effectiveBackground = (element: Element | null): string => {
      for (let node = element; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest('[aria-hidden="true"], .sr-only, :disabled')) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || rect.width === 0) continue;
      samples.push({ text: text.slice(0, 60), color: style.color, background: effectiveBackground(element), fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) });
    }
    return samples;
  }) as Promise<TextSample[]>;
}
