import { Router } from 'express';
import type { Request, Response } from 'express';

/**
 * Deterministic SVG product imagery. Generated locally so the marketplace looks
 * complete without any external image host, and stays identical across reloads.
 */

const GLYPHS: Record<string, string[]> = {
  cat_phones: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 6h6v9H9z', 'M10 18h4'],
  cat_laptops: ['M4 6h16v9H4z', 'M2 17h20l-1.5 2h-17z'],
  cat_audio: ['M6 10v4a3 3 0 0 0 6 0v-4', 'M12 10v4a3 3 0 0 0 6 0v-4', 'M4 10v4', 'M20 10v4'],
  cat_appliances: ['M6 3h12v18H6z', 'M9 7h6', 'M14 18h2'],
  cat_bedding: ['M3 12h18v6H3z', 'M3 12V8h18v4', 'M7 12v6'],
  cat_furniture: ['M3 8h18v4H3z', 'M5 12v8', 'M19 12v8', 'M3 8V5h18v3'],
  cat_coffee: ['M5 9h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', 'M16 11h2a2 2 0 0 1 0 4h-2', 'M7 3v3', 'M11 3v3'],
  cat_spices: ['M8 8h8l2 12H6z', 'M9 8V5h6v3', 'M10 13h4'],
  cat_womenswear: ['M8 4l4 3 4-3 4 4-3 2 1 10H6l1-10-3-2z'],
  cat_menswear: ['M9 3l3 2 3-2 4 3-2 3v12H7V9L5 6z', 'M9 3v4h6V3'],
  cat_haircare: ['M9 3h6v4l2 3v11H7V10l2-3z', 'M10 8h4'],
  cat_skincare: ['M9 3h6v3l1 2v13H8V8l1-2z', 'M8 10h8'],
  cat_diapers: ['M7 4h10l2 8-2 8H7L5 12z', 'M8 8h8'],
  cat_toys: ['M3 8h18v12H3z', 'M7 8V5h4v3', 'M13 8V5h4v3'],
  cat_autoparts: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M12 2v3', 'M12 19v3'],
  cat_care: ['M12 3s6 6 6 10a6 6 0 0 1-12 0c0-4 6-10 6-10z'],
  cat_packaging: ['M3 7l9-4 9 4-9 4z', 'M3 7v10l9 4 9-4V7', 'M12 11v10'],
  cat_bulk: ['M3 6h8v6H3z', 'M13 6h8v6h-8z', 'M3 14h8v5H3z', 'M13 14h8v5h-8z'],
  default: ['M4 5h16v14H4z', 'M8 9h8', 'M8 13h5'],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function productSvg(id: string, variant = 0): string {
  const h = hash(id);
  const hue = h % 360;
  const hue2 = (hue + 34 + variant * 12) % 360;
  const glyphs = GLYPHS[''] ?? [];
  void glyphs;
  const catGuess = GLYPHS.default!;
  const pick = Object.values(GLYPHS)[h % Object.keys(GLYPHS).length]!;
  const shapes =
    variant % 3 === 0
      ? pick
      : variant % 3 === 1
        ? pick.map((d) => d)
        : [...pick].reverse();
  const path = shapes.join(' ');
  const rot = (h % 5) * 2 - 4;
  const scale = 1 + (h % 3) * 0.04;
  void catGuess;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 62% 94%)"/>
      <stop offset="0.55" stop-color="hsl(${hue} 48% 88%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 55% 82%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.7">
      <stop offset="0" stop-color="#fff" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="hsl(${hue} 40% 30%)" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <rect width="400" height="400" fill="url(#glow)"/>
  <g opacity="0.18" fill="none" stroke="hsl(${hue} 45% 40%)" stroke-width="1.2">
    ${Array.from({ length: 9 }, (_, i) => `<circle cx="${(h % 400)}" cy="${(i * 47 + 20) % 400}" r="${18 + i * 6}"/>`).join('')}
  </g>
  <g filter="url(#soft)" transform="translate(200 200) rotate(${rot}) scale(${scale}) translate(-200 -200)">
    <g transform="translate(200 200) scale(6.4) translate(-12 -12)">
      <path d="${path}" fill="none" stroke="hsl(${hue} 62% 26%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    </g>
  </g>
  <rect x="14" y="14" width="372" height="372" rx="26" fill="none" stroke="hsl(${hue} 40% 30%)" stroke-opacity="0.14" stroke-width="2"/>
</svg>`;
}

export function avatarSvg(seed: string): string {
  const h = hash(seed);
  const hue = h % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 68% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 70% 46%)"/>
  </linearGradient></defs>
  <rect width="120" height="120" rx="60" fill="url(#g)"/>
  <circle cx="60" cy="47" r="20" fill="#fff" fill-opacity="0.92"/>
  <path d="M20 110c0-22 18-34 40-34s40 12 40 34z" fill="#fff" fill-opacity="0.92"/>
</svg>`;
}

export function sceneSvg(kind: string): string {
  const h = hash(kind);
  const hue = h % 360;
  const label = kind.includes('pod') || kind.includes('ev_') ? 'Photo' : kind.includes('rev') ? 'Review' : 'Image';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 28% 82%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 30% 66%)"/>
  </linearGradient></defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <g opacity="0.35" fill="#fff">
    <rect x="60" y="120" width="280" height="180" rx="16"/>
    <circle cx="130" cy="175" r="22"/>
    <path d="M60 300l80-80 60 60 50-40 90 60v0H60z"/>
  </g>
  <text x="200" y="360" text-anchor="middle" font-family="Inter,sans-serif" font-size="22" font-weight="600" fill="#fff" fill-opacity="0.9">${label}</text>
</svg>`;
}

export function mediaRouter(): Router {
  const r = Router();
  r.get(/^\/media\/([\w-]+?)(?:_(\d))?$/, (req: Request, res: Response) => {
    const key = req.params[0] as string;
    const variant = Number(req.params[1] ?? 0);
    const svg = key.startsWith('pod') || key.startsWith('ev_') || key.startsWith('rev') ? sceneSvg(key) : productSvg(key, variant);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(svg);
  });
  r.get('/media/avatar/:seed', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(avatarSvg(req.params.seed));
  });
  return r;
}
