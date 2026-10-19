/* Deltos landing - boot de tema ANTES del CSS (evita flash de tema). Sin FOUC de idioma: ES es el default del HTML. */
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    var t = localStorage.getItem('deltos-landing-theme');
    if (t !== 'light' && t !== 'dark') {
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    d.setAttribute('data-theme', t);
  } catch (e) {
    d.setAttribute('data-theme', 'dark');
  }
})();
