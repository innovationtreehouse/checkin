/**
 * Font loading for the Innovation Treehouse brand (Next.js App Router).
 *   HNkani     → headings / brand wordmark (commercial face, bundled locally)
 *   Nunito     → body / UI text
 *   Space Mono → IDs, codes, mono accents
 *
 * Put HNkani.ttf + HNkani-Italic.ttf in src/app/fonts/ and fix the localFont paths to
 * resolve from THIS file's location. Then put `fontVariables` on <body> (see MIGRATION.md).
 */
import localFont from 'next/font/local';
import { Nunito, Space_Mono } from 'next/font/google';

export const hnkani = localFont({
  src: [
    { path: '../app/fonts/HNkani.ttf', weight: '400', style: 'normal' },
    { path: '../app/fonts/HNkani-Italic.ttf', weight: '400', style: 'italic' },
  ],
  variable: '--font-hnkani',
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
export const fontVariables = `${hnkani.variable} ${nunito.variable} ${spaceMono.variable}`;
