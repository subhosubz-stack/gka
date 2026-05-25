import { parseYoutubeVideoId, youtubeEmbedUrl, defaultListingVideoId } from './youtube.js';

export function resolveListingMedia(property) {
  const media = Array.isArray(property?.media) ? property.media : [];
  const youtubeRow = media.find((m) => m.file_type === 'youtube');
  const images = media
    .filter((m) => m.file_type === 'image' || (m.file_type !== 'youtube' && m.file_url))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const fromProperty =
    parseYoutubeVideoId(property?.youtube_url) ||
    parseYoutubeVideoId(property?.youtube_video_id);

  const videoId =
    parseYoutubeVideoId(youtubeRow?.file_url) ||
    fromProperty ||
    defaultListingVideoId();

  return {
    videoId,
    embedUrl: youtubeEmbedUrl(videoId),
    images: images.map((m) => m.file_url).filter(Boolean),
    coverImage: images[0]?.file_url || null
  };
}
