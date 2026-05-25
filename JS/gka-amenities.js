/**
 * Master amenity catalog — used in listing forms, filters, and property detail view.
 */
window.GKA_AMENITIES = [
  { id: 'ac', label: 'AC', icon: 'fa-snowflake', category: 'comfort' },
  { id: 'wifi', label: 'WiFi', icon: 'fa-wifi', category: 'essentials' },
  { id: 'geyser', label: 'Geyser', icon: 'fa-shower', category: 'comfort' },
  { id: 'washing_machine', label: 'Washing Machine', icon: 'fa-soap', category: 'appliances' },
  { id: 'fridge', label: 'Fridge', icon: 'fa-kitchen-set', category: 'appliances' },
  { id: 'microwave', label: 'Microwave', icon: 'fa-fire-burner', category: 'appliances' },
  { id: 'tv', label: 'TV', icon: 'fa-tv', category: 'comfort' },
  { id: 'furnished', label: 'Fully Furnished', icon: 'fa-couch', category: 'furniture' },
  { id: 'semi_furnished', label: 'Semi Furnished', icon: 'fa-chair', category: 'furniture' },
  { id: 'bed', label: 'Bed Included', icon: 'fa-bed', category: 'furniture' },
  { id: 'wardrobe', label: 'Wardrobe', icon: 'fa-door-closed', category: 'furniture' },
  { id: 'study_table', label: 'Study Table', icon: 'fa-book', category: 'furniture' },
  { id: 'kitchen', label: 'Kitchen', icon: 'fa-utensils', category: 'essentials' },
  { id: 'meals', label: 'Meals', icon: 'fa-bowl-food', category: 'essentials' },
  { id: 'laundry', label: 'Laundry', icon: 'fa-shirt', category: 'appliances' },
  { id: 'parking', label: 'Parking', icon: 'fa-square-parking', category: 'building' },
  { id: 'cctv', label: 'CCTV', icon: 'fa-video', category: 'security' },
  { id: 'security', label: '24×7 Security', icon: 'fa-shield-halved', category: 'security' },
  { id: 'power_backup', label: 'Power Backup', icon: 'fa-bolt', category: 'building' },
  { id: 'balcony', label: 'Balcony', icon: 'fa-tree', category: 'building' },
  { id: 'lift', label: 'Lift', icon: 'fa-elevator', category: 'building' },
  { id: 'housekeeping', label: 'Housekeeping', icon: 'fa-broom', category: 'essentials' },
  { id: 'water_purifier', label: 'Water Purifier', icon: 'fa-droplet', category: 'essentials' },
  { id: 'attached_bathroom', label: 'Attached Bathroom', icon: 'fa-toilet', category: 'comfort' },
  { id: 'cooler', label: 'Cooler', icon: 'fa-fan', category: 'comfort' }
];

window.GKAAmenities = {
  catalog: () => window.GKA_AMENITIES,

  labelFor(idOrLabel) {
    const raw = String(idOrLabel || '').trim();
    const found = window.GKA_AMENITIES.find(
      (a) => a.id === raw.toLowerCase() || a.label.toLowerCase() === raw.toLowerCase()
    );
    return found ? found.label : raw;
  },

  normalizeList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => {
      const s = String(x).trim();
      const found = window.GKA_AMENITIES.find(
        (a) => a.id === s.toLowerCase() || a.label.toLowerCase() === s.toLowerCase()
      );
      return found ? found.label : s;
    });
  },

  renderChips(container, selected = [], { toggle = false, onChange } = {}) {
    if (!container) return;
    container.innerHTML = '';
    container.className = 'gka-amenity-grid';
    window.GKA_AMENITIES.forEach((a) => {
      const sel = selected.includes(a.label) || selected.includes(a.id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `gka-amenity-chip${sel ? ' is-on' : ''}`;
      chip.dataset.id = a.id;
      chip.dataset.label = a.label;
      chip.innerHTML = `<i class="fa-solid ${a.icon}"></i><span>${a.label}</span>`;
      if (toggle) {
        chip.addEventListener('click', () => {
          chip.classList.toggle('is-on');
          const picked = [...container.querySelectorAll('.gka-amenity-chip.is-on')].map(
            (c) => c.dataset.label
          );
          if (onChange) onChange(picked);
        });
      }
      container.appendChild(chip);
    });
  },

  renderFilterBar(container, active = [], onFilter) {
    if (!container) return;
    container.innerHTML = '';
    container.className = 'gka-filter-amenities';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `gka-filter-chip${!active.length ? ' is-on' : ''}`;
    allBtn.textContent = 'All amenities';
    allBtn.addEventListener('click', () => onFilter([]));
    container.appendChild(allBtn);

    window.GKA_AMENITIES.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const on = active.includes(a.label) || active.includes(a.id);
      btn.className = `gka-filter-chip${on ? ' is-on' : ''}`;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.innerHTML = `<i class="fa-solid ${a.icon}"></i> ${a.label}`;
      btn.addEventListener('click', () => {
        const next = on ? active.filter((x) => x !== a.label && x !== a.id) : [...active, a.label];
        onFilter(next);
      });
      container.appendChild(btn);
    });
  }
};
