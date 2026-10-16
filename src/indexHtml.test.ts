import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const SITE = 'https://pablomedinabetancor.github.io/property-investment-analyzer/';

const meta = (attr: string, key: string) =>
  new RegExp(`<meta\\s+${attr}="${key}"[^>]*?content="([^"]*)"`, 's').exec(html)?.[1];

describe('index.html page metadata', () => {
  it('has a description and preview tags with absolute URLs', () => {
    expect(meta('name', 'description')?.length).toBeGreaterThan(40);
    expect(meta('property', 'og:title')).toBe('Property Investment Analyzer');
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:url')).toBe(SITE);
    expect(meta('property', 'og:image')).toBe(`${SITE}og-image.png`);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('has a real favicon, a theme colour and a noscript line', () => {
    expect(html).not.toContain('href="data:,"');
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/favicon\.svg"/);
    expect(html).toContain('name="theme-color"');
    expect(html).toMatch(/<noscript\s*>[^<]*JavaScript[^<]*<\/noscript\s*>/);
  });
});
