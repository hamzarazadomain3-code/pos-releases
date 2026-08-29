export interface WallpaperPreset {
  id: string;
  name: string;
  gradient: string;
  category: 'dark' | 'light' | 'color';
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    category: 'dark',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    gradient: 'linear-gradient(135deg, #005c97 0%, #363795 100%)',
    category: 'color',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 50%, #fda085 100%)',
    category: 'color',
  },
  {
    id: 'forest',
    name: 'Forest',
    gradient: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
    category: 'color',
  },
  {
    id: 'snow',
    name: 'Snow',
    gradient: 'linear-gradient(135deg, #e6e9f0 0%, #eef1f5 100%)',
    category: 'light',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    gradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 30%, #7c3aed 70%, #f43f5e 100%)',
    category: 'color',
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    category: 'dark',
  },
  {
    id: 'peach',
    name: 'Peach',
    gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    category: 'light',
  },
];

export function presetToDataUrl(preset: WallpaperPreset): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        ${extractStops(preset.gradient)}
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function extractStops(gradient: string): string {
  const colorRegex = /#([0-9a-fA-F]{3,8})/g;
  const colors: string[] = [];
  let match;
  while ((match = colorRegex.exec(gradient)) !== null) {
    colors.push(`#${match[1]}`);
  }
  return colors
    .map((c, i, arr) => {
      const pct = arr.length > 1 ? Math.round((i / (arr.length - 1)) * 100) : 0;
      return `<stop offset="${pct}%" stop-color="${c}"/>`;
    })
    .join('\n        ');
}
