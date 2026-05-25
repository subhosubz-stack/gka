/**
 * GharKaAdda chat — listing inbox (one thread per property) + preset/unlocked modes.
 */
window.GKAChat = (function () {
  const API_BASE = window.GKA_CONFIG?.API_BASE_URL || '/api';

  function authHeaders(token) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    };
  }

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  async function startConversation(token, propertyId) {
    const res = await fetch(`${API_BASE}/conversations/start`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ property_id: propertyId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not open chat');
    return data.conversation;
  }

  async function loadTemplates(token) {
    const res = await fetch(`${API_BASE}/conversations/templates`, {
      headers: authHeaders(token)
    });
    if (!res.ok) return [];
    const rows = await res.json();
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter((t) => {
      const key = String(t.body || t.label || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function loadMessages(token, conversationId) {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
      headers: authHeaders(token)
    });
    if (!res.ok) return [];
    return res.json();
  }

  async function sendMessage(token, conversationId, body, templateId) {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ body, template_id: templateId || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed');
    return data;
  }

  function injectStyles() {
    if (document.getElementById('gka-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'gka-chat-styles';
    style.textContent = `
      .gka-chat-panel { margin-top:24px; padding:24px; border:1px solid rgba(122,78,45,.16); border-radius:24px; background:rgba(255,255,255,.68); backdrop-filter:blur(20px); }
      .gka-chat-panel h3 { font-family:Manrope,Inter,sans-serif; color:#7a4e2d; font-size:22px; margin-bottom:12px; letter-spacing:-.04em; }
      .gka-chat-hint { font-size:13px; color:#77695f; font-weight:650; margin-bottom:14px; line-height:1.5; }
      .gka-chat-msgs { max-height:260px; overflow-y:auto; display:grid; gap:10px; margin-bottom:14px; }
      .gka-chat-bubble { padding:12px 14px; border-radius:16px; font-size:14px; font-weight:650; max-width:85%; line-height:1.45; }
      .gka-chat-bubble.mine { margin-left:auto; background:#7a4e2d; color:#fff; }
      .gka-chat-bubble.theirs { background:rgba(122,78,45,.08); color:#1c1713; }
      .gka-chat-bubble .meta { font-size:11px; opacity:.75; margin-bottom:4px; }
      .gka-chat-bubble.is-pending { opacity:.92; }
      .gka-chat-bubble.is-pending.mine { box-shadow:0 0 0 2px rgba(255,255,255,.25); animation:gka-chat-pulse .9s ease-in-out infinite; }
      .gka-chat-bubble.is-failed.mine { background:#8b2918; }
      .gka-chat-retry { margin-top:8px; padding:6px 12px; border-radius:8px; border:1px solid rgba(255,255,255,.4); background:transparent; color:#fff; font-size:11px; font-weight:800; cursor:pointer; }
      @keyframes gka-chat-pulse { 0%,100%{opacity:.88} 50%{opacity:1} }
      .gka-chat-presets { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
      .gka-chat-preset-btn.is-sending { opacity:.55; pointer-events:none; }
      .gka-chat-preset-btn { padding:8px 12px; border-radius:999px; border:1px solid rgba(122,78,45,.2); background:#fff; font-size:12px; font-weight:800; color:#7a4e2d; cursor:pointer; }
      .gka-chat-preset-btn:hover { background:rgba(122,78,45,.08); }
      .gka-chat-compose { display:flex; gap:10px; }
      .gka-chat-compose input { flex:1; min-height:44px; border-radius:12px; border:1px solid rgba(122,78,45,.2); padding:0 14px; font:inherit; }
      .gka-chat-compose button { min-height:44px; padding:0 18px; border-radius:12px; background:#7a4e2d; color:#fff; font-weight:900; cursor:pointer; border:0; }
      .gka-chat-compose button:disabled { opacity:.5; cursor:not-allowed; }
      .gka-chat-modal { position:fixed; inset:0; z-index:800; background:rgba(28,23,19,.45); display:none; align-items:center; justify-content:center; padding:20px; }
      .gka-chat-modal.show { display:flex; }
      .gka-chat-modal-card { width:min(520px,100%); max-height:90vh; overflow:auto; padding:28px; border-radius:28px; background:#fffaf4; border:1px solid rgba(122,78,45,.16); box-shadow:0 34px 100px rgba(63,39,24,.2); }
      .gka-chat-modal-close { float:right; border:0; background:transparent; font-size:22px; color:#7a4e2d; cursor:pointer; }
    `;
    document.head.appendChild(style);
  }

  function ensureOlxCss() {
    if (document.getElementById('gka-chat-olx-css')) return;
    const link = document.createElement('link');
    link.id = 'gka-chat-olx-css';
    link.rel = 'stylesheet';
    link.href = 'CSS/gka-chat-olx.css?v=2';
    document.head.appendChild(link);
  }

  function getDisplayName() {
    try {
      const u = JSON.parse(localStorage.getItem('gka_user') || '{}');
      return u.full_name || 'You';
    } catch {
      return 'You';
    }
  }

  function scrollMsgs(container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  function isMine(m, currentUserId) {
    return m._mine === true || m.sender_id === currentUserId;
  }

  function buildBubble(m, currentUserId, onRetry) {
    const mine = isMine(m, currentUserId);
    const pending = !!m._pending;
    const failed = !!m._failed;
    const bubble = el(
      'div',
      `gka-chat-bubble ${mine ? 'mine' : 'theirs'}${pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}`
    );
    const metaLabel = pending
      ? 'Sending…'
      : failed
        ? 'Failed to send'
        : m.sender_name || (mine ? 'You' : 'User');
    bubble.innerHTML = `<div class="meta">${escapeHtml(metaLabel)}</div>${escapeHtml(m.body)}`;
    if (failed && onRetry) {
      const retryBtn = el('button', 'gka-chat-retry', 'Tap to retry');
      retryBtn.type = 'button';
      retryBtn.onclick = () => onRetry(m);
      bubble.appendChild(retryBtn);
    }
    return bubble;
  }

  function renderMessages(container, messages, currentUserId, onRetry) {
    container.innerHTML = '';
    const visible = messages.filter((m) => !m._removed);
    if (!visible.length) {
      container.innerHTML =
        '<p class="gka-chat-hint" style="margin:0;">No messages yet. Choose a quick reply below to contact the owner.</p>';
      return;
    }
    visible.forEach((m) => container.appendChild(buildBubble(m, currentUserId, onRetry)));
    scrollMsgs(container);
  }

  /**
   * Optimistic send: show message instantly, sync with server in background.
   */
  async function sendOptimistic(ctx, text, templateId = null) {
    const {
      token,
      conversationId,
      msgsEl,
      messageList,
      currentUserId,
      onError,
      onSent,
      sendBtn,
      input
    } = ctx;

    const body = String(text || '').trim();
    if (!body || ctx._sending) return;

    const optimistic = {
      id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender_id: currentUserId,
      sender_name: getDisplayName(),
      body,
      _pending: true,
      _mine: true,
      created_at: new Date().toISOString()
    };

    ctx._sending = true;
    if (input) {
      input.value = '';
      input.focus();
    }
    if (sendBtn) sendBtn.disabled = true;

    messageList.push(optimistic);
    renderMessages(msgsEl, messageList, currentUserId, (failed) =>
      retryFailed(ctx, failed, templateId)
    );

    try {
      const data = await sendMessage(token, conversationId, body, templateId);
      const idx = messageList.findIndex((m) => m.id === optimistic.id);
      const saved = data.message || {};
      const confirmed = {
        ...saved,
        id: saved.id || optimistic.id,
        sender_id: currentUserId,
        sender_name: getDisplayName(),
        body: saved.body || body,
        _pending: false,
        _mine: true
      };
      if (idx >= 0) messageList[idx] = confirmed;
      else messageList.push(confirmed);

      renderMessages(msgsEl, messageList, currentUserId, (failed) =>
        retryFailed(ctx, failed, templateId)
      );
      if (onSent) onSent(body);
    } catch (err) {
      const idx = messageList.findIndex((m) => m.id === optimistic.id);
      if (idx >= 0) {
        messageList[idx]._pending = false;
        messageList[idx]._failed = true;
      }
      renderMessages(msgsEl, messageList, currentUserId, (failed) =>
        retryFailed(ctx, failed, templateId)
      );
      onError(err.message || 'Message could not be sent.');
    } finally {
      ctx._sending = false;
      if (sendBtn && !input?.disabled) sendBtn.disabled = false;
    }
  }

  function retryFailed(ctx, failedMsg, templateId) {
    const idx = ctx.messageList.findIndex((m) => m.id === failedMsg.id);
    if (idx >= 0) ctx.messageList.splice(idx, 1);
    sendOptimistic(ctx, failedMsg.body, templateId);
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function resolveToken(token) {
    return (
      token ||
      localStorage.getItem('gka_token') ||
      localStorage.getItem('gka_auth_token') ||
      ''
    );
  }

  function resolveHost(containerId, containerEl) {
    if (containerEl) return containerEl;
    if (containerId) return document.getElementById(containerId);
    return null;
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();
      if (sameDay) {
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  }

  function formatRent(rent) {
    const n = parseFloat(rent || 0);
    if (!n) return '';
    return `₹${n.toLocaleString('en-IN')}/mo`;
  }

  function thumbStyle(url) {
    if (!url) return '';
    const safe = String(url).replace(/'/g, '%27').replace(/"/g, '');
    return `background-image:url('${safe}')`;
  }

  async function renderChatUI(host, { token, conversation, currentUserId, onError, compact, onSent }) {
    const isPreset = conversation.status === 'preset_only';
    host.innerHTML = '';
    const panel = el('div', 'gka-chat-panel');
    const messageList = [];
    const sendCtx = {
      token,
      conversationId: conversation.id,
      messageList,
      currentUserId,
      onError,
      onSent,
      _sending: false
    };
    if (!compact) {
      panel.appendChild(el('h3', null, `Chat — ${conversation.property_title || 'Property'}`));
      panel.appendChild(
        el(
          'p',
          'gka-chat-hint',
          isPreset
            ? 'Inquiry mode: use quick replies only. Contact details are hidden until your stay is active.'
            : 'Resident chat: message your landlord about rent, maintenance, and your stay.'
        )
      );
    } else {
      panel.appendChild(
        el(
          'p',
          'gka-chat-hint',
          isPreset
            ? 'Quick replies only — contact details are hidden until your stay is active.'
            : 'Full chat with your landlord is enabled.'
        )
      );
    }

    const msgsEl = el('div', 'gka-chat-msgs');
    panel.appendChild(msgsEl);
    sendCtx.msgsEl = msgsEl;

    const presetsEl = el('div', 'gka-chat-presets');
    panel.appendChild(presetsEl);

    const compose = el('div', 'gka-chat-compose');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = isPreset ? 'Select a quick reply below' : 'Type your message…';
    input.disabled = isPreset;
    const sendBtn = el('button', null, 'Send');
    sendBtn.disabled = isPreset;
    compose.appendChild(input);
    compose.appendChild(sendBtn);
    panel.appendChild(compose);
    host.appendChild(panel);
    sendCtx.input = input;
    sendCtx.sendBtn = sendBtn;

    if (isPreset) {
      presetsEl.innerHTML = '';
      const templates = await loadTemplates(token);
      if (!templates.length) {
        presetsEl.innerHTML =
          '<p class="gka-chat-hint" style="margin:0;">Quick replies are not configured yet. Please try again later.</p>';
      } else {
        templates.forEach((t) => {
          const btn = el('button', 'gka-chat-preset-btn', escapeHtml(t.label || t.body));
          btn.type = 'button';
          btn.onclick = () => {
            btn.classList.add('is-sending');
            sendOptimistic(sendCtx, t.body, t.id).finally(() => btn.classList.remove('is-sending'));
          };
          presetsEl.appendChild(btn);
        });
      }
    }

    const messages = await loadMessages(token, conversation.id);
    messageList.push(...messages);
    renderMessages(msgsEl, messageList, currentUserId, (failed) =>
      retryFailed(sendCtx, failed, null)
    );

    sendBtn.onclick = () => sendOptimistic(sendCtx, input.value, null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendOptimistic(sendCtx, input.value, null);
      }
    });
  }

  /**
   * Listing inbox: threads left, active chat right.
   */
  async function mountOlxInbox(options) {
    injectStyles();
    ensureOlxCss();

    const {
      containerId,
      token: rawToken,
      currentUserId,
      onError = (msg) => alert(msg),
      listUrl,
      userRole = 'tenant',
      openPropertyId = null,
      listingHref = 'tenant-search-dashboard.html?property='
    } = options;

    const token = resolveToken(rawToken);
    const host = document.getElementById(containerId);
    if (!host) return;
    if (host.dataset.gkaInboxMounted === '1') return;
    host.dataset.gkaInboxMounted = '1';

    host.innerHTML = '<p class="gka-chat-hint">Loading messages…</p>';

    let list = [];
    let startWarning = null;

    if (openPropertyId && userRole === 'tenant') {
      try {
        await startConversation(token, openPropertyId);
      } catch (e) {
        startWarning = e.message || 'Could not open chat for this listing.';
      }
    }

    try {
      const res = await fetch(listUrl || `${API_BASE}/conversations`, {
        headers: authHeaders(token)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not load messages');
      }
      const raw = await res.json();
      list = Array.isArray(raw) ? raw : raw.conversations || [];
    } catch (e) {
      host.innerHTML = `<p class="gka-chat-hint">${escapeHtml(e.message)}</p>`;
      return;
    }

    const wrap = el('div', 'gka-olx-wrap');
    const listPanel = el('aside', 'gka-olx-list');
    listPanel.innerHTML = `
      <div class="gka-olx-list-head">
        <h2>Messages</h2>
        <p>One conversation per property listing</p>
      </div>
      <div class="gka-olx-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" placeholder="Search by listing or message…" id="gkaOlxSearch" autocomplete="off" />
      </div>
      <div class="gka-olx-rows" id="gkaOlxRows"></div>
    `;

    const threadPanel = el('section', 'gka-olx-thread');
    threadPanel.innerHTML = `<div class="gka-olx-thread-empty" id="gkaOlxThreadEmpty">
      <div>
        <i class="fa-solid fa-comments" style="font-size:32px;color:#7a4e2d;opacity:.35;display:block;margin-bottom:12px;"></i>
        Select a listing chat or browse properties to start messaging.
      </div>
    </div>
    <div id="gkaOlxThreadActive" class="gka-olx-thread-active"></div>`;

    wrap.appendChild(listPanel);
    wrap.appendChild(threadPanel);
    host.innerHTML = '';
    host.appendChild(wrap);

    if (startWarning) {
      const warn = el('p', 'gka-chat-hint');
      warn.style.cssText = 'margin:12px 14px 0;padding:10px 14px;border-radius:12px;background:rgba(217,48,37,.08);color:#8b2918;';
      warn.textContent = startWarning;
      listPanel.insertBefore(warn, listPanel.querySelector('.gka-olx-search'));
    }

    const rowsEl = listPanel.querySelector('#gkaOlxRows');
    const searchInput = listPanel.querySelector('#gkaOlxSearch');
    const threadEmpty = threadPanel.querySelector('#gkaOlxThreadEmpty');
    const threadActive = threadPanel.querySelector('#gkaOlxThreadActive');

    let activeId = null;
    let filtered = list;

    function updateThreadPreview(conversationId, previewText) {
      const conv = list.find((c) => c.id === conversationId);
      if (conv) {
        conv.last_message = previewText;
        conv.last_message_at = new Date().toISOString();
      }
      renderRows(filtered);
    }

    function peerLabel(conv) {
      return conv.peer_name || conv.owner_name || conv.tenant_name || 'User';
    }

    function renderRows(conversations) {
      rowsEl.innerHTML = '';
      if (!conversations.length) {
        rowsEl.innerHTML = `<div class="gka-olx-empty-list">
          No conversations yet.<br><a href="${userRole === 'tenant' ? 'tenant-search-dashboard.html' : 'owner-dashboard.html'}">Browse listings</a> and select <strong>Message seller</strong> on a property.
        </div>`;
        return;
      }

      conversations.forEach((conv) => {
        const row = el('button', `gka-olx-row${conv.id === activeId ? ' is-active' : ''}`);
        row.type = 'button';
        row.dataset.id = conv.id;
        const img = conv.property_image
          ? `<div class="gka-olx-thumb" style="${thumbStyle(conv.property_image)}"></div>`
          : `<div class="gka-olx-thumb"><i class="fa-solid fa-house"></i></div>`;
        const preview = conv.last_message || 'No messages yet';
        row.innerHTML = `
          ${img}
          <div class="gka-olx-row-body">
            <strong>${escapeHtml(conv.property_title || 'Property')}</strong>
            <div class="price">${escapeHtml(formatRent(conv.property_rent))}${conv.property_city ? ` · ${escapeHtml(conv.property_city)}` : ''}</div>
            <div class="preview">${escapeHtml(preview)}</div>
          </div>
          <div class="gka-olx-row-meta">${escapeHtml(formatTime(conv.last_message_at || conv.updated_at))}</div>
        `;
        row.onclick = () => selectConversation(conv);
        rowsEl.appendChild(row);
      });
    }

    async function selectConversation(conv) {
      activeId = conv.id;
      wrap.classList.add('is-thread-open');
      renderRows(filtered);
      threadEmpty.classList.add('is-hidden');
      threadActive.classList.add('is-visible');
      threadActive.innerHTML = '';

      const head = el('div', 'gka-olx-thread-head');
      const backBtn = el('button', 'gka-olx-back');
      backBtn.type = 'button';
      backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
      backBtn.onclick = () => {
        wrap.classList.remove('is-thread-open');
        activeId = null;
        renderRows(filtered);
        threadActive.classList.remove('is-visible');
        threadActive.innerHTML = '';
        threadEmpty.classList.remove('is-hidden');
      };

      const propLink = document.createElement('a');
      propLink.className = 'gka-olx-listing-link';
      if (userRole === 'tenant' && conv.property_id) {
        propLink.href = `${listingHref}${conv.property_id}`;
      } else {
        propLink.href = '#';
        propLink.onclick = (e) => e.preventDefault();
      }
      const thumb = conv.property_image
        ? `<div class="gka-olx-thumb" style="${thumbStyle(conv.property_image)}"></div>`
        : `<div class="gka-olx-thumb"><i class="fa-solid fa-house"></i></div>`;
      propLink.innerHTML = `
        ${thumb}
        <div>
          <h3>${escapeHtml(conv.property_title || 'Property')}</h3>
          <span>${escapeHtml(peerLabel(conv))} · ${escapeHtml(formatRent(conv.property_rent))}</span>
        </div>
      `;

      head.appendChild(backBtn);
      head.appendChild(propLink);
      threadActive.appendChild(head);

      const chatHost = el('div');
      chatHost.style.flex = '1';
      chatHost.style.minHeight = '0';
      chatHost.style.display = 'flex';
      chatHost.style.flexDirection = 'column';
      threadActive.appendChild(chatHost);

      await renderChatUI(chatHost, {
        token,
        conversation: conv,
        currentUserId,
        onError,
        compact: true,
        onSent: (text) => updateThreadPreview(conv.id, text)
      });
    }

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        filtered = list;
      } else {
        filtered = list.filter((c) => {
          const hay = [
            c.property_title,
            c.last_message,
            c.peer_name,
            c.owner_name,
            c.tenant_name,
            c.property_city
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        });
      }
      renderRows(filtered);
    });

    renderRows(filtered);

    let openConv = null;
    if (openPropertyId) {
      openConv = list.find((c) => String(c.property_id) === String(openPropertyId));
    }
    if (!openConv && list.length) {
      openConv = list[0];
    }
    if (openConv) {
      await selectConversation(openConv);
    }
  }

  async function mountInline(options) {
    injectStyles();
    const {
      containerId,
      containerEl,
      token: rawToken,
      propertyId,
      currentUserId,
      onError = (msg) => alert(msg)
    } = options;

    const token = resolveToken(rawToken);
    const host = resolveHost(containerId, containerEl);
    if (!host) return;

    host.hidden = false;
    host.innerHTML = '<p class="gka-chat-hint">Opening chat…</p>';

    try {
      const conversation = await startConversation(token, propertyId);
      await renderChatUI(host, { token, conversation, currentUserId, onError });
    } catch (e) {
      host.innerHTML = `<p class="gka-chat-hint">${escapeHtml(e.message)}</p>`;
    }
  }

  function openListingChat(propertyId, { role = 'tenant' } = {}) {
    if (role === 'tenant') {
      window.location.href = `tenant-chats.html?property=${encodeURIComponent(propertyId)}`;
      return;
    }
    window.location.href = `owner-dashboard.html#ownerChatInbox`;
  }

  function mountInPropertyDrawer(options) {
    openListingChat(options.propertyId, { role: 'tenant' });
  }

  function openModal(options) {
    openListingChat(options.propertyId, { role: 'tenant' });
  }

  async function mountInbox(options) {
    return mountOlxInbox(options);
  }

  return {
    mountInline,
    mountOlxInbox,
    mountInbox,
    openModal,
    openListingChat,
    mountInPropertyDrawer,
    startConversation
  };
})();
