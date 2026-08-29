/**
 * Migration 026 — Wallpaper Editor Settings
 *
 * Adds admin settings for wallpaper editing:
 *   opacity, blur, position, scale, tint, brightness, saturation, grayscale
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return !!row;
  };

  if (!hasTable('admin_settings')) return;

  const insertSetting = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)');

  const wallpaperSettings = [
    ['wallpaper_opacity', '100'],
    ['wallpaper_blur', '0'],
    ['wallpaper_position', 'center'],
    ['wallpaper_scale', 'cover'],
    ['wallpaper_tint_color', '#000000'],
    ['wallpaper_tint_opacity', '0'],
    ['wallpaper_brightness', '100'],
    ['wallpaper_saturation', '100'],
    ['wallpaper_grayscale', 'false'],
  ];

  for (const [key, value] of wallpaperSettings) {
    insertSetting.run(key, value);
  }
};
