/**
 * Font loading for the Innovation Treehouse brand (Next.js App Router).
 *   Fredoka    → headings / brand wordmark (Google Fonts, SIL OFL)
 *   Nunito     → body / UI text
 *   Space Mono → IDs, codes, mono accents
 *
 * All three load from next/font/google; put `fontVariables` on <html> (see layout.tsx).
 */
import { Fredoka, Nunito, Space_Mono } from 'next/font/google';

export const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

export const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
});

export const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
});

/** Join all font variable classes for the <body> className. */
export const fontVariables = `${fredoka.variable} ${nunito.variable} ${spaceMono.variable}`;
