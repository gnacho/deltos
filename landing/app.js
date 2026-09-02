/* Deltos landing - tema, capturas por idioma/tema, lightbox, reveal, copiar, nav, parallax, versión */
(function () {
  'use strict';

  const THEME_KEY = 'deltos-landing-theme';
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Tema (el boot inline del <head> ya fijó data-theme) ---------- */
  const themeBtn = document.getElementById('themeBtn');
  const iconSun = document.getElementById('iconSun');
  const iconMoon = document.getElementById('iconMoon');

  function paintTheme() {
    const dark = root.getAttribute('data-theme') !== 'light';
    if (iconSun) iconSun.style.display = dark ? '' : 'none';
    if (iconMoon) iconMoon.style.display = dark ? 'none' : '';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#070b15' : '#f3f5fa');
  }
  paintTheme();

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* noop */ }
      paintTheme();
      applyShots();
    });
  }

  function themeNow() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function langNow() { return root.lang === 'en' ? 'en' : 'es'; }

  /* ---------- Capturas: principal + carrusel, por idioma/tema ---------- */
  const SHOT_ORDER = ['board', 'casa', 'viaje', 'trabajo', 'expenses', 'invite', 'settings'];
  let shotIndex = 0;
  const mainImg = document.getElementById('shotMain');
  const capEl = document.getElementById('shotCap');
  const thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumb'));
  const prevBtn = document.getElementById('shotPrev');
  const nextBtn = document.getElementById('shotNext');
  const stage = document.getElementById('shotStage');

  function shotUrl(id) { return 'assets/shot-' + id + '-' + langNow() + '-' + themeNow() + '.webp'; }

  const capKey = function (id) { return 'shot.' + id + '.cap'; };
  const altKey = function (id) { return 'shot.' + id + '.alt'; };

  function renderMain() {
    if (!mainImg || !capEl) return;
    const id = SHOT_ORDER[shotIndex];
    mainImg.src = shotUrl(id);
    mainImg.dataset.i18nAlt = altKey(id);
    mainImg.alt = window.LandingLang.altFor(altKey(id)) || mainImg.alt;
    capEl.innerHTML = window.LandingLang.textFor(capKey(id));
    thumbs.forEach(function (t) {
      const on = t.dataset.shot === id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
  }

  function applyShots() {
    thumbs.forEach(function (t) { t.querySelector('img').src = shotUrl(t.dataset.shot); });
    renderMain();
  }
  document.addEventListener('deltos:lang', applyShots);

  function goto(idx) {
    shotIndex = (idx + SHOT_ORDER.length) % SHOT_ORDER.length;
    renderMain();
  }
  if (thumbs.length) {
    thumbs.forEach(function (t) {
      t.addEventListener('click', function () { goto(SHOT_ORDER.indexOf(t.dataset.shot)); });
    });
  }
  if (prevBtn) prevBtn.addEventListener('click', function () { goto(shotIndex - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { goto(shotIndex + 1); });
  if (stage) {
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goto(shotIndex - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goto(shotIndex + 1); }
    });
  }
  applyShots();

  /* ---------- Lightbox: zoom de la captura principal ---------- */
  const lightbox = document.getElementById('shotLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');

  function openLightbox() {
    if (!lightbox || !mainImg) return;
    lightboxImg.src = mainImg.src;
    lightboxImg.alt = mainImg.alt || '';
    lightboxCaption.textContent = capEl ? capEl.textContent : '';
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { lightbox.classList.add('open'); });
    if (lightboxClose) lightboxClose.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    setTimeout(function () {
      lightbox.hidden = true;
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }, reduceMotion ? 0 : 220);
  }

  if (stage) {
    stage.addEventListener('click', openLightbox);
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(); }
    });
  }
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxImg) lightboxImg.addEventListener('click', closeLightbox);
  if (lightbox) {
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
    });
  }

  /* ---------- Copiar comando ---------- */
  const copyBtn = document.getElementById('copyBtn');
  const installCmd = document.getElementById('installCmd');
  if (copyBtn && installCmd) {
    copyBtn.addEventListener('click', function () {
      const text = installCmd.textContent.trim();
      const span = copyBtn.querySelector('span');
      const prev = span ? span.textContent : '';
      const done = function () {
        copyBtn.classList.add('copied');
        if (span) span.textContent = langNow() === 'en' ? 'Copied!' : '¡Copiado!';
        setTimeout(function () {
          copyBtn.classList.remove('copied');
          if (span) span.textContent = prev;
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      } else {
        fallback();
      }
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------- Reveal al hacer scroll ---------- */
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- Nav con scroll ---------- */
  const nav = document.getElementById('nav');
  addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', scrollY > 12);
  }, { passive: true });

  /* ---------- Parallax del fondo (ratón, solo puntero fino y sin reduced-motion) ---------- */
  (function () {
    if (reduceMotion) return;
    if (!matchMedia('(pointer: fine)').matches) return;
    const glow = document.querySelector('.bg-glow');
    const grid = document.querySelector('.grid-lines');
    if (!glow || !grid) return;
    let tx = 0, ty = 0, cx = 0, cy = 0;
    addEventListener('pointermove', function (e) {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    (function loop() {
      cx += (tx - cx) * 0.055;
      cy += (ty - cy) * 0.055;
      glow.style.transform = 'translate3d(' + (cx * 34).toFixed(1) + 'px,' + (cy * 34).toFixed(1) + 'px,0)';
      grid.style.transform = 'translate3d(' + (cx * -14).toFixed(1) + 'px,' + (cy * -14).toFixed(1) + 'px,0)';
      requestAnimationFrame(loop);
    })();
  })();

  /* ---------- Versión actual (GitHub releases, caché 1h) ---------- */
  (function () {
    const KEY = 'deltos-landing-release';
    const statVer = document.getElementById('statVer');
    const footVer = document.getElementById('footVer');
    function paint(tag) {
      if (statVer) statVer.textContent = tag;
      if (footVer) { footVer.textContent = tag; footVer.hidden = false; }
    }
    function fail() {
      if (statVer) statVer.style.display = 'none';
    }
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.tag && Date.now() - c.ts < 36e5) { paint(c.tag); return; }
    } catch (e) { /* noop */ }
    fetch('https://api.github.com/repos/gnacho/deltos/releases/latest')
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (j) {
        if (!j.tag_name) throw new Error('shape');
        try { localStorage.setItem(KEY, JSON.stringify({ tag: j.tag_name, ts: Date.now() })); } catch (e) { /* noop */ }
        paint(j.tag_name);
      })
      .catch(fail);
  })();
})();
