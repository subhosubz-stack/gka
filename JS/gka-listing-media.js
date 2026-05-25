/**
 * Listing media: YouTube tour (lazy) + photo gallery with thumb switch and back-to-video.
 */
window.GKAListingMedia = (function () {
  const DEFAULT_VIDEO = 'UfEiKK-iX70';

  function parseVideoId(url) {
    if (!url) return null;
    const t = String(url).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m?.[1]) return m[1];
    }
    return null;
  }

  function embedUrl(videoId) {
    const id = videoId || DEFAULT_VIDEO;
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&enablejsapi=0`;
  }

  /** Make relative /uploads paths work on any app origin. */
  function normalizeMediaUrl(url) {
    if (!url) return '';
    const u = String(url).trim();
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (u.startsWith('//')) return `${window.location.protocol}${u}`;
    if (u.startsWith('/')) return `${window.location.origin}${u}`;
    return u;
  }

  function resolve(property) {
    const media = property?.media || [];
    const yt = media.find((m) => m.file_type === 'youtube');
    const images = media
      .filter((m) => m.file_type === 'image' && m.file_url)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((m) => normalizeMediaUrl(m.file_url))
      .filter(Boolean);

    const videoId =
      parseVideoId(yt?.file_url) ||
      parseVideoId(property?.youtube_url) ||
      DEFAULT_VIDEO;

    return { videoId, embedUrl: embedUrl(videoId), images };
  }

  function injectStyles() {
    if (document.getElementById('gka-listing-media-styles')) return;
    const s = document.createElement('style');
    s.id = 'gka-listing-media-styles';
    s.textContent = `
      .gka-media-wrap { position:relative; height:210px; background:rgba(122,78,45,.08); overflow:hidden; }
      .gka-media-poster { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; background:#1c1713; cursor:pointer; }
      .gka-media-poster img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.72; pointer-events:none; }
      .gka-media-play { position:relative; z-index:3; min-height:44px; padding:0 18px; border-radius:999px; border:0; background:#7a4e2d; color:#fff; font-weight:900; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; box-shadow:0 12px 32px rgba(0,0,0,.35); }
      .gka-media-play:hover { transform:translateY(-1px); }
      .gka-media-video-slot { position:absolute; inset:0; z-index:1; }
      .gka-media-video-slot iframe { width:100%; height:100%; border:0; display:block; }
      .gka-media-wrap.is-video-active .gka-media-poster { display:none; }
      .gka-media-wrap.is-video-active .gka-media-video-slot { z-index:3; }
      .gka-photo-strip { position:absolute; left:10px; bottom:10px; display:flex; gap:6px; z-index:6; max-width:calc(100% - 120px); overflow-x:auto; padding-bottom:2px; }
      .gka-photo-thumb { flex:0 0 auto; width:48px; height:48px; border-radius:10px; border:2px solid #fff; background-size:cover; background-position:center; background-color:rgba(122,78,45,.2); box-shadow:0 4px 12px rgba(0,0,0,.25); cursor:pointer; }
      .gka-photo-thumb.active { border-color:#7a4e2d; box-shadow:0 0 0 2px #7a4e2d; }
      .gka-image-overlay { position:absolute; inset:0; z-index:4; display:none; background:#1c1713; }
      .gka-image-overlay img { width:100%; height:100%; object-fit:cover; display:block; }
      .gka-media-wrap.is-photo-mode .gka-image-overlay { display:block; }
      .gka-media-wrap.is-photo-mode .gka-media-poster { display:none; }
      .gka-media-wrap.is-photo-mode .gka-media-video-slot { opacity:0; pointer-events:none; }
      .gka-media-back-video { position:absolute; left:10px; top:10px; z-index:7; min-height:36px; padding:0 12px; border-radius:999px; border:0; background:rgba(255,255,255,.92); color:#7a4e2d; font-weight:900; font-size:11px; cursor:pointer; display:none; align-items:center; gap:6px; box-shadow:0 4px 14px rgba(0,0,0,.2); }
      .gka-media-wrap.is-photo-mode .gka-media-back-video { display:inline-flex; }
      .gka-media-wrap.is-video-active .gka-media-back-video { display:inline-flex; }
    `;
    document.head.appendChild(s);
  }

  function ensureOverlay(wrap) {
    let overlay = wrap.querySelector('.gka-image-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'gka-image-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.alt = 'Property photo';
      img.loading = 'lazy';
      overlay.appendChild(img);
      wrap.insertBefore(overlay, wrap.firstChild);
    }
    return overlay;
  }

  function showVideo(wrap) {
    const videoId = wrap.dataset.videoId;
    const slot = wrap.querySelector('.gka-media-video-slot');
    if (!slot || !videoId) return;
    slot.hidden = false;
    if (!slot.querySelector('iframe')) {
      const iframe = document.createElement('iframe');
      iframe.src = embedUrl(videoId);
      iframe.title = 'Property video tour';
      iframe.setAttribute(
        'allow',
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      );
      iframe.allowFullscreen = true;
      iframe.loading = 'lazy';
      slot.appendChild(iframe);
    }
    wrap.classList.add('is-video-active');
    wrap.classList.remove('is-photo-mode');
    wrap.querySelectorAll('.gka-photo-thumb').forEach((t) => t.classList.remove('active'));
    const first = wrap.querySelector('.gka-photo-thumb');
    if (first) first.classList.add('active');
  }

  function showPhoto(wrap, url, thumb) {
    const src = normalizeMediaUrl(url);
    if (!src) return;
    const overlay = ensureOverlay(wrap);
    const img = overlay.querySelector('img');
    if (img) {
      img.src = src;
      img.onerror = () => {
        img.alt = 'Photo unavailable';
        img.style.opacity = '0.35';
      };
    }
    wrap.classList.add('is-photo-mode');
    wrap.classList.remove('is-video-active');
    wrap.querySelectorAll('.gka-photo-thumb').forEach((t) => t.classList.remove('active'));
    if (thumb) thumb.classList.add('active');
  }

  function cardHeroHtml(property, { height = 210 } = {}) {
    injectStyles();
    const { videoId, images } = resolve(property);
    const poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const thumbs =
      images.length > 0
        ? `<div class="gka-photo-strip" role="tablist" aria-label="Property photos">${images
            .slice(0, 8)
            .map((url, i) => {
              const safe = normalizeMediaUrl(url);
              return `<button type="button" class="gka-photo-thumb ${i === 0 ? 'active' : ''}" data-url="${attrEsc(safe)}" style="background-image:url(${JSON.stringify(safe)})" title="Photo ${i + 1}" aria-label="Show photo ${i + 1}"></button>`;
            })
            .join('')}</div>`
        : '';

    return `<div class="gka-media-wrap" style="height:${height}px" data-video-id="${videoId}">
      <button type="button" class="gka-media-back-video"><i class="fa-solid fa-circle-play"></i> Video tour</button>
      <div class="gka-media-poster" data-play-video>
        <img src="${poster}" alt="Property tour preview" loading="lazy" />
        <button type="button" class="gka-media-play"><i class="fa-solid fa-play"></i> Watch tour</button>
      </div>
      <div class="gka-media-video-slot" hidden></div>
      ${thumbs}
    </div>`;
  }

  function bindThumbClicks(root) {
    if (!root) return;
    root.querySelectorAll('.gka-media-wrap').forEach((wrap) => {
      if (wrap.dataset.gkaMediaBound) return;
      wrap.dataset.gkaMediaBound = '1';

      const playPoster = wrap.querySelector('[data-play-video]');
      const playBtn = wrap.querySelector('.gka-media-play');
      const backBtn = wrap.querySelector('.gka-media-back-video');

      const onPlay = (e) => {
        e.stopPropagation();
        e.preventDefault();
        showVideo(wrap);
      };

      if (playBtn) playBtn.addEventListener('click', onPlay);
      if (playPoster) {
        playPoster.addEventListener('click', (e) => {
          if (e.target.closest('.gka-photo-thumb')) return;
          onPlay(e);
        });
      }

      if (backBtn) {
        backBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const slot = wrap.querySelector('.gka-media-video-slot');
          if (slot?.querySelector('iframe')) {
            showVideo(wrap);
          } else {
            wrap.classList.remove('is-photo-mode', 'is-video-active');
            if (slot) slot.hidden = true;
            wrap.querySelectorAll('.gka-photo-thumb').forEach((t) => t.classList.remove('active'));
            const first = wrap.querySelector('.gka-photo-thumb');
            if (first) first.classList.add('active');
          }
        });
      }

      wrap.querySelectorAll('.gka-photo-thumb').forEach((thumb) => {
        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const url = thumb.dataset.url;
          if (!url) return;
          showPhoto(wrap, url, thumb);
        });
      });
    });
  }

  return {
    resolve,
    embedUrl,
    parseVideoId,
    normalizeMediaUrl,
    cardHeroHtml,
    bindThumbClicks,
    showPhoto,
    showVideo,
    DEFAULT_VIDEO
  };
})();
