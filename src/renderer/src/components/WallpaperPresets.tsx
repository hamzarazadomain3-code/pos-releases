import { WALLPAPER_PRESETS, presetToDataUrl } from './wallpaperPresetsData';

interface Props {
  currentWallpaper: string;
  onSelect: (dataUrl: string) => void;
}

export default function WallpaperPresets({ currentWallpaper, onSelect }: Props) {
  return (
    <div className="wallpaper-presets">
      <div className="muted small" style={{ marginBottom: 8 }}>Built-in Wallpapers:</div>
      <div className="wallpaper-presets-grid">
        {WALLPAPER_PRESETS.map((p) => {
          const dataUrl = presetToDataUrl(p);
          const isActive = currentWallpaper === dataUrl;
          return (
            <button
              key={p.id}
              className={`wallpaper-preset-thumb ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(dataUrl)}
              title={p.name}
            >
              <div
                className="wallpaper-preset-preview"
                style={{ background: p.gradient }}
              />
              <span className="wallpaper-preset-name">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
