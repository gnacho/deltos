/* Deltos landing — interactividad: idioma, tema, slider, contadores, reveal, copiar */
(function () {
  'use strict';

  const LANG_KEY = 'deltos-landing-lang';
  const THEME_KEY = 'deltos-landing-theme';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  /* Capturas: orden de las vistas + alt por idioma */
  const SLIDES = ['board', 'project', 'projects', 'activity', 'settings'];
  const SHOT_ALT = {
    board: { es: 'Tablero de Deltos: todas las tareas en columnas Nuevo, En curso y Hecho, con proyectos y etiquetas', en: 'Deltos board: all tasks in New, In progress and Done columns, with projects and labels' },
    project: { es: 'Tablero del proyecto Casa con sus tarjetas, etiquetas y responsables', en: 'Home project board with its cards, labels and assignees' },
    projects: { es: 'Listado de proyectos de Deltos con su progreso', en: 'Deltos project list with its progress' },
    activity: { es: 'Feed de actividad de Deltos: quién movió cada tarjeta y cuándo', en: 'Deltos activity feed: who moved each card and when' },
    settings: { es: 'Página de ajustes de Deltos con apariencia, etiquetas, perfil y sesión', en: 'Deltos settings page with appearance, labels, profile and session' }
  };

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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#17150f' : '#f7f5f0');
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
  const mobileMq = window.matchMedia('(max-width: 767px)');
  function shotUrl(view) {
    const prefix = mobileMq.matches ? 'shot-m-' : 'shot-';
    return 'assets/' + prefix + view + '-' + langNow() + '-' + themeNow() + '.webp';
  }

  /* ---------- Slider de capturas ---------- */
  const shotImg = document.getElementById('shotImg');
  const shotCaption = document.getElementById('shotCaption');
  let shotIndex = 0;

  function applyShots() {
    document.querySelectorAll('.thumb img').forEach(function (img) {
      img.src = shotUrl(img.dataset.view);
    });
    renderShot(shotIndex);
  }

  function renderShot(i) {
    shotIndex = (i + SLIDES.length) % SLIDES.length;
    const view = SLIDES[shotIndex];
    shotImg.src = shotUrl(view);
    shotImg.alt = SHOT_ALT[view][langNow()];
    const dict = I18N[langNow()] || I18N.es;
    shotCaption.textContent = dict['shots.s' + (shotIndex + 1)] || '';
    document.querySelectorAll('.thumb').forEach(function (th, idx) {
      th.classList.toggle('active', idx === shotIndex);
    });
  }

  const shotPrev = document.getElementById('shotPrev');
  const shotNext = document.getElementById('shotNext');
  if (shotPrev) shotPrev.addEventListener('click', function () { renderShot(shotIndex - 1); });
  if (shotNext) shotNext.addEventListener('click', function () { renderShot(shotIndex + 1); });
  document.querySelectorAll('.thumb').forEach(function (th) {
    th.addEventListener('click', function () { renderShot(parseInt(th.dataset.slide, 10)); });
  });
  if (mobileMq.addEventListener) mobileMq.addEventListener('change', applyShots);

  /* ---------- Lightbox ---------- */
  const lightbox = document.getElementById('shotLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  function syncLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightboxImg.src = shotImg.src;
    lightboxImg.alt = shotImg.alt;
    lightboxCaption.textContent = shotCaption.textContent;
  }

  function openLightbox() {
    if (!lightbox) return;
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    syncLightbox();
    if (lightboxClose) lightboxClose.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (shotImg) shotImg.focus();
  }

  if (shotImg) shotImg.addEventListener('click', openLightbox);
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener('click', function () { renderShot(shotIndex - 1); syncLightbox(); });
  if (lightboxNext) lightboxNext.addEventListener('click', function () { renderShot(shotIndex + 1); syncLightbox(); });
  if (lightbox) {
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') { renderShot(shotIndex - 1); syncLightbox(); }
      else if (e.key === 'ArrowRight') { renderShot(shotIndex + 1); syncLightbox(); }
    });
  }

  /* ---------- Contadores ---------- */
  function animateCount(el) {
    const target = parseFloat(el.getAttribute('data-count')) || 0;
    const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    const suffix = el.getAttribute('data-suffix') || '';
    if (reduceMotion) {
      el.textContent = (decimals ? target.toFixed(decimals) : String(target)) + suffix;
      return;
    }
    const dur = 900;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = target * eased;
      el.textContent = (decimals ? v.toFixed(decimals) : String(Math.round(v))) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const counters = Array.prototype.slice.call(document.querySelectorAll('.mini-stat [data-count]'));
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          co.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (c) { co.observe(c); });
  } else {
    counters.forEach(animateCount);
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
  renderShot(0);

  function initialTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* noop */ }
    return 'light';
  }
})();
