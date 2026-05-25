/** Parse YouTube watch / shorts / embed URLs into video id */
export function parseYoutubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];

  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function youtubeEmbedUrl(videoId, { autoplay = true, mute = true } = {}) {
  if (!videoId) return null;
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    mute: mute ? '1' : '0',
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  });
  if (autoplay) params.set('loop', '1');
  if (autoplay) params.set('playlist', videoId);
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function defaultListingVideoId() {
  return (
    process.env.DEFAULT_LISTING_YOUTUBE_ID ||
    parseYoutubeVideoId(process.env.DEFAULT_LISTING_YOUTUBE_URL) ||
    'UfEiKK-iX70'
  );
}
