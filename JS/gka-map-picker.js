/**
 * Leaflet map picker — tap to set lat/lng + address hint (Rapido-style).
 */
window.GKAMapPicker = (function () {
  const DEFAULT_CENTER = [30.7333, 76.7794];
  const DEFAULT_ZOOM = 12;

  function mount(containerId, { onPick, initialLat, initialLng } = {}) {
    const el = document.getElementById(containerId);
    if (!el || !window.L) return null;

    const lat = parseFloat(initialLat) || DEFAULT_CENTER[0];
    const lng = parseFloat(initialLng) || DEFAULT_CENTER[1];

    el.innerHTML = '';
    const mapEl = document.createElement('div');
    mapEl.style.height = '220px';
    mapEl.style.borderRadius = '14px';
    mapEl.style.overflow = 'hidden';
    el.appendChild(mapEl);

    const map = L.map(mapEl).setView([lat, lng], DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    let marker = L.marker([lat, lng], { draggable: true }).addTo(map);

    function emit(pos) {
      if (onPick) onPick({ lat: pos.lat, lng: pos.lng });
    }

    marker.on('dragend', () => emit(marker.getLatLng()));
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      emit(e.latlng);
    });

    setTimeout(() => map.invalidateSize(), 200);

    return {
      setLatLng(newLat, newLng) {
        const p = [parseFloat(newLat), parseFloat(newLng)];
        if (!Number.isFinite(p[0])) return;
        marker.setLatLng(p);
        map.setView(p, map.getZoom());
        emit({ lat: p[0], lng: p[1] });
      },
      getLatLng() {
        const p = marker.getLatLng();
        return { lat: p.lat, lng: p.lng };
      }
    };
  }

  return { mount, DEFAULT_CENTER };
})();
