/* Deltos landing — interactividad: idioma, tema, capturas por idioma/tema, post-its, reveal, copiar */
(function () {
  'use strict';

  const LANG_KEY = 'deltos-landing-lang';
  const THEME_KEY = 'deltos-landing-theme';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  /* Capturas por idioma/tema: la clave id se mapea a ficheros shot-<id>-<lang>-<theme>.webp */
  const SHOTS = [
    { id: 'board', el: document.getElementById('heroShot') },
    { id: 'casa', el: document.getElementById('shotCasa') },
    { id: 'viaje', el: document.getElementById('shotViaje') },
    { id: 'trabajo', el: document.getElementById('shotTrabajo') },
    { id: 'expenses', el: document.getElementById('shotExpenses') },
  ];

  /* ---------- Idioma ---------- */
  function applyLang(lang) {
    const dict = I18N[lang] || I18N.es;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-aria');
      if (dict[key]) el.setAttribute('aria-label', dict[key]);
    });
    root.lang = lang;
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* noop */ }
    applyShots();
  }

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.addEventListener('change', function () { applyLang(this.value); });
  }

  function initialLang() {
    const urlLang = new URLSearchParams(window.location.search).get('hl');
    if (urlLang === 'en' || urlLang === 'es') return urlLang;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && I18N[saved]) return saved;
    } catch (e) { /* noop */ }
    return (navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  }

  /* ---------- Tema ---------- */
  const themeBtn = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon');

  function iconPath(theme) {
    if (theme === 'dark') {
      return '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
    return '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeIcon) themeIcon.innerHTML = iconPath(theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1b140c' : '#f6f1e8');
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* noop */ }
    applyShots();
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  function themeNow() { return root.getAttribute('data-theme') || 'light'; }
  function langNow() { return root.lang || 'es'; }
  function shotUrl(id) {
    return 'assets/shot-' + id + '-' + langNow() + '-' + themeNow() + '.webp';
  }

  /* ---------- Capturas por idioma/tema ---------- */
  function applyShots() {
    SHOTS.forEach(function (s) {
      if (s.el) s.el.src = shotUrl(s.id);
    });
  }

  /* ---------- Lightbox: zoom de cualquier captura ---------- */
  const lightbox = document.getElementById('shotLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');

  function openLightbox(img) {
    if (!lightbox) return;
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || '';
    lightboxCaption.textContent = '';
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    if (lightboxClose) lightboxClose.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.taped img, .scene-shot img').forEach(function (img) {
    img.addEventListener('click', function () { openLightbox(img); });
    img.setAttribute('tabindex', '0');
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(img); }
    });
  });
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightbox) {
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
    });
  }

  /* ---------- Post-its del hero: se "pegan" con giro ---------- */
  const heroStickies = Array.prototype.slice.call(document.querySelectorAll('.hero-stickies .sticky, .hero-note'));
  const tapeWiggle = [-2, 1.5, -1, 2];
  heroStickies.forEach(function (el, i) {
    el.style.setProperty('--tape', tapeWiggle[i % tapeWiggle.length] + 'deg');
    if (!reduceMotion) {
      el.style.opacity = '0';
      el.style.transform = 'rotate(' + (tapeWiggle[i % tapeWiggle.length] - 6) + 'deg) scale(0.9)';
    }
  });
  function stickNotes() {
    heroStickies.forEach(function (el, i) {
      el.style.transition = 'transform 420ms var(--ease-out), opacity 420ms var(--ease-out)';
      el.style.opacity = '1';
      el.style.transform = 'rotate(var(--tape)) scale(1)';
      setTimeout(function () { el.style.transition = ''; }, 450);
    });
  }
  if (heroStickies.length && 'IntersectionObserver' in window && !reduceMotion) {
    const so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { stickNotes(); so.disconnect(); }
      });
    }, { threshold: 0.2 });
    so.observe(document.getElementById('heroBoard') || document.body);
  } else {
    heroStickies.forEach(function (el) { el.style.opacity = '1'; el.style.transform = 'rotate(var(--tape)) scale(1)'; });
  }

  /* ---------- Reveal al hacer scroll ---------- */
  const reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reduceMotion) {
    const ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          ro.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (r) { ro.observe(r); });
  } else {
    reveals.forEach(function (r) { r.classList.add('in'); });
  }

  /* ---------- Copiar comando ---------- */
  const copyBtn = document.getElementById('copyBtn');
  const installCmd = document.getElementById('installCmd');
  if (copyBtn && installCmd) {
    copyBtn.addEventListener('click', function () {
      const text = installCmd.textContent.trim();
      const done = function () {
        const dict = I18N[root.lang] || I18N.es;
        const orig = copyBtn.textContent;
        copyBtn.textContent = dict['misc.copied'] || (root.lang === 'es' ? 'Copiado ✓' : 'Copied ✓');
        setTimeout(function () { copyBtn.textContent = orig; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        try { document.execCommand('copy'); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------- Arranque ---------- */
  applyTheme(initialTheme());
  applyLang(initialLang());

  function initialTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* noop */ }
    return 'light';
  }
})();
