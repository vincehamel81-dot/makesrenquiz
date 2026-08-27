export function youtubeVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}
