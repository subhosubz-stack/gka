/**
 * Multi-step property listing wizard (owner & broker).
 */
window.GKAListingWizard = (function () {
  const STEPS = ['basic', 'location', 'pricing', 'capacity', 'amenities', 'rules', 'media'];

  function mount({ hostId, role = 'owner', onSubmit }) {
    const host = document.getElementById(hostId);
    if (!host) return;

    host.innerHTML = `
      <h2 style="font-family:Manrope,sans-serif;color:var(--accent);font-size:28px;font-weight:800;margin-bottom:8px;">Property listing wizard</h2>
      <p class="gka-sub" style="margin-bottom:20px;">Every field syncs to your database — tenants filter by amenities you select.</p>
      <div class="gka-wizard-progress" id="lwProgress"></div>
      <div id="lwSteps"></div>
      <div class="gka-wizard-nav">
        <button type="button" class="gka-btn gka-btn-ghost" id="lwPrev">Back</button>
        <button type="button" class="gka-btn gka-btn-primary" id="lwNext">Continue</button>
      </div>
      <label style="display:flex;align-items:center;gap:10px;margin-top:16px;cursor:pointer;font-weight:700;">
        <input type="checkbox" id="pVisibilityBoost" />
        Add visibility boost (+₹99, 30 days) at checkout
      </label>
    `;

    const progress = host.querySelector('#lwProgress');
    const stepsEl = host.querySelector('#lwSteps');
    STEPS.forEach(() => {
      const d = document.createElement('div');
      d.className = 'gka-wizard-dot';
      progress.appendChild(d);
    });

    let step = 0;
    let selectedAmenities = [];
    let mapPicker = null;

    stepsEl.innerHTML = `
      <div class="gka-wizard-step is-active" data-step="basic">
        <h3 class="gka-title" style="font-size:22px;">Basic details</h3>
        <div class="lw-field"><label>Property title</label><input id="pTitle" required placeholder="Rohini Sector-15 Elite Studio"></div>
        <div class="lw-row">
          <div class="lw-field"><label>Property type</label>
            <select id="pType"><option>Single Room</option><option>Shared Pg</option><option>1BHK</option><option>2BHK</option><option>3BHK</option><option>Studio</option><option>Hostel</option></select>
          </div>
          <div class="lw-field"><label>Listing tier</label>
            <select id="pPremium"><option value="false">Standard</option><option value="true">Premium</option></select>
          </div>
        </div>
        <div class="lw-field"><label>Short description</label><textarea id="pDesc" rows="3" placeholder="Describe the room, floor, sunlight, nearby metro..."></textarea></div>
      </div>
      <div class="gka-wizard-step" data-step="location">
        <h3 class="gka-title" style="font-size:22px;">Location</h3>
        <div class="lw-field"><label>Nearest college (for students)</label>
          <select id="pCollege" required>
            <option value="">Select college</option>
            <option>CGC UNIVERSITY MOHALI</option>
            <option>CHANDIGARH UNIVERSITY</option>
            <option>CGC LANDRAN</option>
            <option>QUEST GROUP OF COLLEGES</option>
            <option>CHITKARA UNIVERSITY</option>
          </select>
        </div>
        <div class="lw-field"><label>Address line</label><input id="pAddress" placeholder="House / building / street"></div>
        <div class="lw-row">
          <div class="lw-field"><label>Locality</label><input id="pLocality" placeholder="Sector 15"></div>
          <div class="lw-field"><label>City</label><input id="pCity" required placeholder="Mohali / Chandigarh"></div>
        </div>
        <div class="lw-row">
          <div class="lw-field"><label>State</label><input id="pState" placeholder="Punjab" value="Punjab"></div>
          <div class="lw-field"><label>Pincode</label><input id="pPincode" placeholder="160055"></div>
        </div>
        <div class="lw-field"><label>Pin on map (tap or drag marker)</label><div id="pMapPicker"></div></div>
        <input type="hidden" id="pLat"><input type="hidden" id="pLng">
        <p class="gka-sub" style="margin-top:8px;font-size:12px;">Service area: Punjab, Chandigarh &amp; nearby tricity only.</p>
      </div>
      <div class="gka-wizard-step" data-step="pricing">
        <h3 class="gka-title" style="font-size:22px;">Pricing</h3>
        <p class="gka-sub" style="margin-bottom:12px;">Set an actual price and a lower offer price to highlight deals on listings.</p>
        <div class="lw-row">
          <div class="lw-field"><label>Actual price (₹/mo)</label><input type="number" id="pActual" placeholder="Market rent"></div>
          <div class="lw-field"><label>Offer price (₹/mo)</label><input type="number" id="pOffer" required placeholder="Price tenants pay"></div>
        </div>
        <div class="lw-field"><label>Offer reason</label><input type="text" id="pOfferReason" placeholder="e.g. Early bird discount, festival offer"></div>
        <div class="lw-row">
          <div class="lw-field"><label>Security deposit (₹)</label><input type="number" id="pDeposit" value="0"></div>
          <div class="lw-field"><label>Monthly rent (legacy)</label><input type="number" id="pRent" hidden></div>
        </div>
        <div class="lw-row">
          <div class="lw-field"><label>Maintenance / month (₹)</label><input type="number" id="pMaintenance" value="0"></div>
          <div class="lw-field"><label>Brokerage fee (₹)</label><input type="number" id="pBrokerage" value="0"></div>
        </div>
      </div>
      <div class="gka-wizard-step" data-step="capacity">
        <h3 class="gka-title" style="font-size:22px;">Availability</h3>
        <div class="lw-row">
          <div class="lw-field"><label>Available from</label><input type="date" id="pAvailableFrom"></div>
          <div class="lw-field"><label>Gender preference</label>
            <select id="pGender"><option value="any">Any</option><option value="male">Male</option><option value="female">Female</option></select>
          </div>
        </div>
        <div class="lw-row">
          <div class="lw-field"><label>Total capacity</label><input type="number" id="pCapacity" value="1" min="1"></div>
          <div class="lw-field"><label>Available beds</label><input type="number" id="pBeds" value="1" min="1"></div>
        </div>
      </div>
      <div class="gka-wizard-step" data-step="amenities">
        <h3 class="gka-title" style="font-size:22px;">Amenities</h3>
        <p class="gka-sub">Select everything available — tenants filter by these.</p>
        <div id="pAmenitiesGrid"></div>
      </div>
      <div class="gka-wizard-step" data-step="rules">
        <h3 class="gka-title" style="font-size:22px;">House rules</h3>
        <div class="lw-field"><label>Guests policy</label><input id="pRuleGuests" placeholder="e.g. No overnight guests"></div>
        <div class="lw-field"><label>Smoking / alcohol</label><input id="pRuleSmoke" placeholder="e.g. Not allowed inside"></div>
        <div class="lw-field"><label>Pets</label><input id="pRulePets" placeholder="e.g. No pets"></div>
        <div class="lw-field"><label>Other rules</label><input id="pRuleOther" placeholder="Curfew, noise, etc."></div>
      </div>
      <div class="gka-wizard-step" data-step="media">
        <h3 class="gka-title" style="font-size:22px;">Photos & video</h3>
        <div class="lw-field"><label>YouTube tour link</label><input type="url" id="pYoutube" placeholder="https://youtube.com/watch?v=..."></div>
        <div class="video-preview" id="videoPreview" hidden style="margin-top:10px;border-radius:16px;overflow:hidden;aspect-ratio:16/9;"><iframe id="youtubePreviewFrame" style="width:100%;height:100%;min-height:200px;border:0;"></iframe></div>
        <div class="upload-zone" id="photoUploadZone" style="margin-top:14px;padding:22px;border:2px dashed rgba(122,78,45,.28);border-radius:16px;text-align:center;cursor:pointer;">
          <i class="fa-solid fa-images"></i><p>Upload multiple photos</p>
        </div>
        <input type="file" id="pPhotos" accept="image/*" multiple hidden>
        <div class="photo-previews" id="photoPreviews" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;margin-top:12px;"></div>
      </div>
    `;

    if (window.GKAAmenities) {
      GKAAmenities.renderChips(document.getElementById('pAmenitiesGrid'), [], {
        toggle: true,
        onChange: (picked) => {
          selectedAmenities = picked;
        }
      });
    }

    function showStep(i) {
      step = i;
      stepsEl.querySelectorAll('.gka-wizard-step').forEach((el, idx) => {
        el.classList.toggle('is-active', idx === step);
      });
      progress.querySelectorAll('.gka-wizard-dot').forEach((dot, idx) => {
        dot.classList.toggle('is-active', idx === step);
        dot.classList.toggle('is-done', idx < step);
      });
      host.querySelector('#lwPrev').style.visibility = step === 0 ? 'hidden' : 'visible';
      host.querySelector('#lwNext').innerHTML =
        step === STEPS.length - 1
          ? '<span>Publish listing</span><i class="fa-solid fa-rocket"></i>'
          : '<span>Continue</span><i class="fa-solid fa-arrow-right"></i>';

      if (step === 1 && window.GKAMapPicker && !mapPicker) {
        mapPicker = GKAMapPicker.mount('pMapPicker', {
          onPick: ({ lat, lng }) => {
            document.getElementById('pLat').value = lat;
            document.getElementById('pLng').value = lng;
          }
        });
      }

      if (window.gsap) {
        const active = stepsEl.querySelector('.gka-wizard-step.is-active');
        gsap.fromTo(active, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
      }
    }

    host.querySelector('#lwPrev').onclick = () => {
      if (step > 0) showStep(step - 1);
    };

    host.querySelector('#lwNext').onclick = () => {
      if (step < STEPS.length - 1) showStep(step + 1);
      else if (onSubmit) onSubmit(collect());
    };

    showStep(0);

    return {
      collect,
      getSelectedAmenities: () => selectedAmenities
    };

    function collect() {
      const rules = {};
      const g = (id) => document.getElementById(id)?.value?.trim();
      if (g('pRuleGuests')) rules.guests = g('pRuleGuests');
      if (g('pRuleSmoke')) rules.smoking_alcohol = g('pRuleSmoke');
      if (g('pRulePets')) rules.pets = g('pRulePets');
      if (g('pRuleOther')) rules.other = g('pRuleOther');

      const chips = document.querySelectorAll('#pAmenitiesGrid .gka-amenity-chip.is-on');
      const amenities = chips.length
        ? [...chips].map((c) => c.dataset.label)
        : selectedAmenities;

      return {
        title: g('pTitle'),
        description: g('pDesc'),
        property_type: g('pType'),
        listing_type: document.getElementById('pPremium')?.value === 'true' ? 'premium' : 'regular',
        address_line: g('pAddress'),
        locality: g('pLocality'),
        city: g('pCity'),
        state: g('pState'),
        pincode: g('pPincode'),
        nearest_college: g('pCollege'),
        latitude: g('pLat') ? parseFloat(g('pLat')) : null,
        longitude: g('pLng') ? parseFloat(g('pLng')) : null,
        map_address: [g('pAddress'), g('pLocality'), g('pCity')].filter(Boolean).join(', '),
        monthly_rent: parseFloat(g('pOffer') || g('pRent') || 0),
        actual_price: g('pActual') ? parseFloat(g('pActual')) : null,
        offer_price: parseFloat(g('pOffer') || g('pRent') || 0),
        offer_reason: g('pOfferReason') || null,
        security_deposit: parseFloat(g('pDeposit') || 0),
        maintenance_fee: parseFloat(g('pMaintenance') || 0),
        brokerage_fee: parseFloat(g('pBrokerage') || 0),
        available_from: g('pAvailableFrom') || null,
        gender_preference: g('pGender') || 'any',
        capacity: parseInt(g('pCapacity') || 1, 10),
        available_beds: parseInt(g('pBeds') || 1, 10),
        amenities,
        rules,
        youtube_url: g('pYoutube'),
        visibility_boost: document.getElementById('pVisibilityBoost')?.checked || false,
        role
      };
    }
  }

  return { mount, STEPS };
})();
