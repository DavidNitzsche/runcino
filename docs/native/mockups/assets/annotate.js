/* ─────────────────────────────────────────────────────────────────
   annotate.js — Round 2 inline annotation tooling
   Faff.run native mockup review infrastructure

   Design goals (per David's Round 2 spec):
     • anchor notes to specific elements (not floating)
     • persist across browser sessions (localStorage)
     • export to markdown (single doc, all pages)
     • importable (Claude pastes exported MD, sees notes in context)
     • status-tagged (approved / iterate / question)

   Bootstraps automatically on every page that includes this script.
   No per-page setup required.
   ───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Storage key + per-page key ─────────────────────────────────
  const STORAGE_KEY = 'faff-mockup-notes-v1';

  // Pull the path after /mockups/ as the page key so notes scope to
  // a single mockup file. Works for file:// and http:// URLs alike.
  let PAGE_KEY = 'unknown';
  const match = location.pathname.match(/\/mockups\/(.*)$/);
  if (match && match[1]) PAGE_KEY = match[1];
  else if (location.pathname.endsWith('index.html')) PAGE_KEY = 'index.html';

  // ── State ──────────────────────────────────────────────────────
  let mode = 'view';   // 'view' or 'annotate'
  let allNotes = loadAll();
  let pageNotes = allNotes[PAGE_KEY] || [];
  let resizeTimer = null;

  // ── Storage ─────────────────────────────────────────────────────
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('annotate.js · localStorage read failed', e);
      return {};
    }
  }

  function saveAll() {
    allNotes[PAGE_KEY] = pageNotes;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allNotes));
    } catch (e) {
      console.warn('annotate.js · localStorage write failed', e);
    }
  }

  // ── Element fingerprinting ──────────────────────────────────────
  // Each annotated element gets a stable CSS selector so notes
  // re-anchor across reloads even without explicit element IDs.
  function selectorFor(el) {
    if (!el || el === document.body || el === document) return 'body';
    if (el.id) return '#' + cssEscape(el.id);

    const path = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 12) {
      let part = cur.tagName.toLowerCase();

      // Add the first two class names for specificity
      if (typeof cur.className === 'string' && cur.className.trim()) {
        const cls = cur.className
          .split(/\s+/)
          .filter(Boolean)
          .filter(c => !c.startsWith('ann-'))   // ignore our own classes
          .slice(0, 2)
          .map(cssEscape)
          .join('.');
        if (cls) part += '.' + cls;
      }

      // Nth-of-type if there are siblings with same tag
      const parent = cur.parentNode;
      if (parent && parent.children) {
        const sameTag = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(cur) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      path.unshift(part);
      cur = cur.parentNode;
      depth++;
    }
    return path.join(' > ');
  }

  function cssEscape(s) {
    return String(s).replace(/([\!\"\#\$\%\&\'\(\)\*\+\,\.\/\:\;\<\=\>\?\@\[\\\]\^\`\{\|\}\~])/g, '\\$1');
  }

  function findBySelector(sel) {
    try { return document.querySelector(sel); }
    catch (e) { return null; }
  }

  // ── Element preview text (for note context) ─────────────────────
  function previewText(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }

  // ── Toolbar ─────────────────────────────────────────────────────
  function buildToolbar() {
    const bar = document.createElement('div');
    bar.id = 'ann-toolbar';
    bar.innerHTML = `
      <div class="ann-toolbar-row">
        <button id="ann-toggle" class="ann-btn">📝 Annotate</button>
        <button id="ann-panel-toggle" class="ann-btn">📋 Notes <span id="ann-count" class="ann-count">0</span></button>
        <button id="ann-export" class="ann-btn">⬇ Export all</button>
        <button id="ann-import" class="ann-btn">⬆ Import</button>
        <button id="ann-clear-page" class="ann-btn ann-btn-danger" title="Clear notes on this page only">Clear page</button>
      </div>
    `;
    document.body.appendChild(bar);

    document.getElementById('ann-toggle').onclick = toggleMode;
    document.getElementById('ann-panel-toggle').onclick = togglePanel;
    document.getElementById('ann-export').onclick = exportAll;
    document.getElementById('ann-import').onclick = openImport;
    document.getElementById('ann-clear-page').onclick = clearPage;
  }

  function updateCount() {
    const el = document.getElementById('ann-count');
    if (el) el.textContent = pageNotes.length;
  }

  function toggleMode() {
    mode = mode === 'view' ? 'annotate' : 'view';
    document.body.classList.toggle('ann-mode-active', mode === 'annotate');
    const btn = document.getElementById('ann-toggle');
    btn.textContent = mode === 'annotate' ? '✓ Click any element' : '📝 Annotate';
    btn.classList.toggle('ann-btn-active', mode === 'annotate');
  }

  // ── Click capture in annotate mode ──────────────────────────────
  document.addEventListener('click', function (e) {
    if (mode !== 'annotate') return;
    // Ignore clicks inside our own UI
    if (e.target.closest('#ann-toolbar, .ann-pin, .ann-popup, #ann-panel, #ann-import-modal')) return;

    e.preventDefault();
    e.stopPropagation();

    const sel = selectorFor(e.target);
    const preview = previewText(e.target);
    openNoteEditor(sel, e.target, null, preview);
  }, true);

  // ── Note editor popup ───────────────────────────────────────────
  function openNoteEditor(selector, el, existingIdx, preview) {
    // Close any open editor first
    document.querySelectorAll('.ann-popup').forEach(p => p.remove());

    const existing = existingIdx != null ? pageNotes[existingIdx] : null;
    const popup = document.createElement('div');
    popup.className = 'ann-popup';
    popup.innerHTML = `
      <div class="ann-popup-head">
        <span class="ann-popup-label">Note on:</span>
        <code class="ann-popup-sel">${escapeHTML(selector)}</code>
      </div>
      ${preview ? `<div class="ann-popup-preview">"${escapeHTML(preview)}"</div>` : ''}
      <textarea class="ann-popup-text" rows="4" placeholder="What needs to change? Or 'approved.' for explicit sign-off.">${existing ? escapeHTML(existing.text) : ''}</textarea>
      <div class="ann-popup-statusrow">
        <label><input type="radio" name="ann-status" value="approved" ${existing && existing.status === 'approved' ? 'checked' : ''}> <span class="ann-dot ann-dot-approved"></span> approved</label>
        <label><input type="radio" name="ann-status" value="iterate" ${!existing || existing.status === 'iterate' ? 'checked' : ''}> <span class="ann-dot ann-dot-iterate"></span> iterate</label>
        <label><input type="radio" name="ann-status" value="question" ${existing && existing.status === 'question' ? 'checked' : ''}> <span class="ann-dot ann-dot-question"></span> question</label>
      </div>
      <div class="ann-popup-actions">
        <button class="ann-btn-save">Save</button>
        ${existing ? '<button class="ann-btn-delete">Delete</button>' : ''}
        <button class="ann-btn-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(popup);

    // Position near the clicked element
    const rect = el.getBoundingClientRect();
    const popupW = 340;
    let left = rect.left + window.scrollX + rect.width + 12;
    if (left + popupW > window.scrollX + window.innerWidth - 20) {
      left = rect.left + window.scrollX - popupW - 12;
    }
    if (left < 10) left = 10;
    popup.style.left = left + 'px';
    popup.style.top = (rect.top + window.scrollY) + 'px';

    popup.querySelector('.ann-popup-text').focus();

    popup.querySelector('.ann-btn-save').onclick = function () {
      const text = popup.querySelector('.ann-popup-text').value.trim();
      const status = popup.querySelector('input[name=ann-status]:checked').value;
      if (!text) { popup.remove(); return; }
      const note = {
        selector,
        preview: preview || '',
        text,
        status,
        ts: Date.now()
      };
      if (existingIdx != null) pageNotes[existingIdx] = note;
      else pageNotes.push(note);
      saveAll();
      renderPins();
      renderPanel();
      popup.remove();
    };
    if (existing) {
      popup.querySelector('.ann-btn-delete').onclick = function () {
        pageNotes.splice(existingIdx, 1);
        saveAll();
        renderPins();
        renderPanel();
        popup.remove();
      };
    }
    popup.querySelector('.ann-btn-cancel').onclick = function () { popup.remove(); };
  }

  // ── Pin rendering (numbered badge next to each annotated element) ─
  function renderPins() {
    document.querySelectorAll('.ann-pin').forEach(p => p.remove());

    pageNotes.forEach((note, i) => {
      const el = findBySelector(note.selector);
      if (!el) {
        // Stale selector — render an orphan pin in the panel area
        return;
      }
      const rect = el.getBoundingClientRect();
      const pin = document.createElement('div');
      pin.className = 'ann-pin ann-pin-' + note.status;
      pin.textContent = String(i + 1);
      pin.title = note.text;
      pin.style.top = (rect.top + window.scrollY - 6) + 'px';
      pin.style.left = (rect.left + window.scrollX - 14) + 'px';
      pin.onclick = function (e) {
        e.stopPropagation();
        openNoteEditor(note.selector, el, i, note.preview);
      };
      document.body.appendChild(pin);
    });
    updateCount();
  }

  // ── Side panel ──────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'ann-panel';
    panel.innerHTML = `
      <div class="ann-panel-head">
        <strong>Notes on this page</strong>
        <button class="ann-btn-close" id="ann-panel-close">×</button>
      </div>
      <div class="ann-panel-list" id="ann-panel-list"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('ann-panel-close').onclick = togglePanel;
  }

  function togglePanel() {
    const panel = document.getElementById('ann-panel');
    panel.classList.toggle('ann-panel-open');
    if (panel.classList.contains('ann-panel-open')) renderPanel();
  }

  function renderPanel() {
    const list = document.getElementById('ann-panel-list');
    if (!list) return;
    if (pageNotes.length === 0) {
      list.innerHTML = '<div class="ann-panel-empty">No notes on this page yet. Click <b>Annotate</b>, then click any element to leave a note.</div>';
      return;
    }
    list.innerHTML = pageNotes.map((note, i) => `
      <div class="ann-panel-item ann-panel-item-${note.status}" data-idx="${i}">
        <div class="ann-panel-item-head">
          <span class="ann-pin-num ann-pin-${note.status}">${i + 1}</span>
          <span class="ann-panel-item-status">${note.status}</span>
          <button class="ann-panel-item-jump" data-idx="${i}" title="Scroll to element">↗</button>
        </div>
        ${note.preview ? `<div class="ann-panel-preview">"${escapeHTML(note.preview)}"</div>` : ''}
        <div class="ann-panel-text">${escapeHTML(note.text)}</div>
        <code class="ann-panel-sel">${escapeHTML(note.selector)}</code>
      </div>
    `).join('');

    list.querySelectorAll('.ann-panel-item-jump').forEach(btn => {
      btn.onclick = function (e) {
        e.stopPropagation();
        const i = +btn.dataset.idx;
        const el = findBySelector(pageNotes[i].selector);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ann-flash');
          setTimeout(() => el.classList.remove('ann-flash'), 1400);
        }
      };
    });

    list.querySelectorAll('.ann-panel-item').forEach(item => {
      item.onclick = function () {
        const i = +item.dataset.idx;
        const el = findBySelector(pageNotes[i].selector);
        if (el) openNoteEditor(pageNotes[i].selector, el, i, pageNotes[i].preview);
      };
    });
  }

  // ── Export to markdown ──────────────────────────────────────────
  function exportAll() {
    allNotes = loadAll();
    allNotes[PAGE_KEY] = pageNotes;
    const pages = Object.keys(allNotes).filter(k => (allNotes[k] || []).length > 0).sort();
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const lines = [
      '# Faff.run mockup review · notes export',
      '',
      `Generated: ${now}`,
      `Pages with notes: ${pages.length}`,
      `Total notes: ${pages.reduce((sum, k) => sum + allNotes[k].length, 0)}`,
      '',
      '---',
      ''
    ];

    pages.forEach(pageKey => {
      const notes = allNotes[pageKey] || [];
      if (!notes.length) return;
      lines.push(`## ${pageKey}`);
      lines.push('');
      const byStatus = { iterate: 0, question: 0, approved: 0 };
      notes.forEach(n => byStatus[n.status] = (byStatus[n.status] || 0) + 1);
      lines.push(`_${notes.length} notes · ${byStatus.iterate || 0} iterate · ${byStatus.question || 0} questions · ${byStatus.approved || 0} approved_`);
      lines.push('');
      notes.forEach((note, i) => {
        lines.push(`### Note ${i + 1} · ${note.status}`);
        lines.push('');
        lines.push(`**Selector:** \`${note.selector}\``);
        if (note.preview) lines.push(`**Element text:** "${note.preview}"`);
        lines.push('');
        lines.push(note.text);
        lines.push('');
      });
      lines.push('---');
      lines.push('');
    });

    const md = lines.join('\n');

    // Show in a modal so reviewer can copy or download
    const modal = document.createElement('div');
    modal.id = 'ann-export-modal';
    modal.innerHTML = `
      <div class="ann-modal-inner">
        <div class="ann-modal-head">
          <strong>Export notes · ${pages.length} pages · ${pages.reduce((s, k) => s + allNotes[k].length, 0)} notes</strong>
          <button class="ann-btn-close" id="ann-export-close">×</button>
        </div>
        <textarea class="ann-modal-text" id="ann-export-text" readonly></textarea>
        <div class="ann-modal-actions">
          <button class="ann-btn" id="ann-export-copy">📋 Copy to clipboard</button>
          <button class="ann-btn" id="ann-export-download">⬇ Download .md</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('ann-export-text').value = md;
    document.getElementById('ann-export-close').onclick = () => modal.remove();
    document.getElementById('ann-export-copy').onclick = () => {
      navigator.clipboard.writeText(md).then(() => {
        const btn = document.getElementById('ann-export-copy');
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = '📋 Copy to clipboard'; }, 1600);
      });
    };
    document.getElementById('ann-export-download').onclick = () => {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faff-mockup-notes-${now.replace(/[^0-9]/g, '')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  // ── Import from markdown ────────────────────────────────────────
  function openImport() {
    const modal = document.createElement('div');
    modal.id = 'ann-import-modal';
    modal.innerHTML = `
      <div class="ann-modal-inner">
        <div class="ann-modal-head">
          <strong>Import notes</strong>
          <button class="ann-btn-close" id="ann-import-close">×</button>
        </div>
        <div class="ann-import-hint">
          Paste exported markdown below. Notes will be merged into localStorage and re-anchored across all mockup pages.
        </div>
        <textarea class="ann-modal-text" id="ann-import-text" placeholder="Paste exported markdown here..."></textarea>
        <div class="ann-modal-actions">
          <button class="ann-btn" id="ann-import-go">Import (merge)</button>
          <button class="ann-btn ann-btn-danger" id="ann-import-replace">Import (replace all)</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('ann-import-close').onclick = () => modal.remove();
    document.getElementById('ann-import-go').onclick = () => doImport(false);
    document.getElementById('ann-import-replace').onclick = () => doImport(true);
  }

  function doImport(replace) {
    const text = document.getElementById('ann-import-text').value;
    const parsed = parseMarkdown(text);
    if (replace) allNotes = {};
    Object.keys(parsed).forEach(k => {
      if (!allNotes[k]) allNotes[k] = [];
      // Dedupe by selector + text
      parsed[k].forEach(n => {
        const dup = allNotes[k].find(x => x.selector === n.selector && x.text === n.text);
        if (!dup) allNotes[k].push(n);
      });
    });
    pageNotes = allNotes[PAGE_KEY] || [];
    saveAll();
    renderPins();
    renderPanel();
    document.getElementById('ann-import-modal').remove();
    const total = Object.values(allNotes).reduce((s, a) => s + a.length, 0);
    alert(`Imported. Total notes across all pages: ${total}`);
  }

  function parseMarkdown(md) {
    const out = {};
    let currentPage = null;
    let currentNote = null;
    const lines = md.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pageMatch = line.match(/^##\s+(\S+\.html)$/);
      if (pageMatch) {
        currentPage = pageMatch[1];
        out[currentPage] = out[currentPage] || [];
        currentNote = null;
        continue;
      }
      const noteHead = line.match(/^###\s+Note\s+\d+\s+·\s+(approved|iterate|question)/);
      if (noteHead && currentPage) {
        currentNote = { status: noteHead[1], selector: '', preview: '', text: '', ts: Date.now() };
        out[currentPage].push(currentNote);
        continue;
      }
      if (currentNote) {
        const selMatch = line.match(/^\*\*Selector:\*\*\s+`(.+)`/);
        if (selMatch) { currentNote.selector = selMatch[1]; continue; }
        const prevMatch = line.match(/^\*\*Element text:\*\*\s+"(.*)"/);
        if (prevMatch) { currentNote.preview = prevMatch[1]; continue; }
        // Anything else non-empty after the selector/preview is the note body
        if (line.trim() && !line.startsWith('**') && !line.startsWith('---')) {
          currentNote.text = currentNote.text ? currentNote.text + '\n' + line : line;
        }
      }
    }
    return out;
  }

  function clearPage() {
    if (!confirm(`Clear all ${pageNotes.length} notes on this page?`)) return;
    pageNotes = [];
    saveAll();
    renderPins();
    renderPanel();
  }

  // ── Utility ─────────────────────────────────────────────────────
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  function init() {
    buildToolbar();
    buildPanel();
    renderPins();
    updateCount();

    window.addEventListener('scroll', schedulePinUpdate, { passive: true });
    window.addEventListener('resize', schedulePinUpdate);
  }

  function schedulePinUpdate() {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(renderPins);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API (used by the notes-index page) ──────────────────
  window.faffNotes = {
    getAll: () => loadAll(),
    pageKey: () => PAGE_KEY,
    export: exportAll,
    import: openImport
  };
})();
