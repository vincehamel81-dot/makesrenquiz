// Locates ffmpeg/yt-dlp: prefers PATH, falls back to known winget install
// locations in case the shell's PATH hasn't picked up a fresh install yet.
import { execFileSync } from 'node:child_process';

const FFMPEG_BIN_DIR =
  'C:\\Users\\rain_\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin';

const FALLBACKS = {
  ffmpeg: `${FFMPEG_BIN_DIR}\\ffmpeg.exe`,
  ffprobe: `${FFMPEG_BIN_DIR}\\ffprobe.exe`,
  'yt-dlp':
    'C:\\Users\\rain_\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe',
};

const VERSION_FLAG = { ffmpeg: '-version', ffprobe: '-version', 'yt-dlp': '--version' };
const resolved = {};

export function resolveBin(name) {
  if (resolved[name]) return resolved[name];
  try {
    execFileSync(name, [VERSION_FLAG[name]], { stdio: 'ignore' });
    resolved[name] = name;
  } catch {
    resolved[name] = FALLBACKS[name];
  }
  return resolved[name];
}
