/* Deltos landing - i18n ES/EN. ES vive inline en el HTML; este fichero captura
   el dict ES del DOM y aplica el EN. Expone window.LandingLang. */
(function () {
  'use strict';

  const LANG_KEY = 'deltos-landing-lang';

  /* ES se captura del propio DOM (la página se escribe en ES) */
  const esDict = {};
  document.querySelectorAll('[data-i18n]').forEach(function (el) { esDict[el.dataset.i18n] = el.innerHTML; });
  const esAlt = {};
  document.querySelectorAll('[data-i18n-alt]').forEach(function (el) { esAlt[el.dataset.i18nAlt] = el.getAttribute('alt'); });
  const esAria = {};
  document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { esAria[el.dataset.i18nAria] = el.getAttribute('aria-label'); });

  const enDict = {
    "misc.skip": "Skip to content",
    "appearance.theme": "Toggle theme",
    "nav.scenes": "At home", "nav.shots": "Screenshots", "nav.features": "What's in it",
    "nav.compare": "Compare", "nav.install": "Install", "nav.cta": "Install",
    "hero.badge": "Self-hosted kanban · tasks and expenses for home, trips and small teams",
    "hero.t1": "Everyday life, on a board.", "hero.t2": "Live. No cloud.",
    "hero.sub": "Deltos is your home's board, done properly: the shopping, the renovation, shared expenses or the trip with friends. <strong>Move a card and everyone sees it right away.</strong> It lives on your own server: no accounts, no subscriptions, no cloud.",
    "hero.cta1": "Install on your server", "hero.cta2": "View on GitHub",
    "hero.chip1": "move a card and everyone sees it", "hero.chip2": "no cloud", "hero.chip3": "alerts to your phone",
    "mock.all": "All", "mock.projects": "Projects", "mock.work": "Work", "mock.trip": "Trip to Lisbon", "mock.garden": "Veggie patch",
    "mock.new": "New", "mock.progress": "In progress", "mock.done": "Done",
    "mock.c1": "Book car inspection", "mock.high": "High", "mock.c2": "Review bathroom renovation quote",
    "mock.urgent": "Urgent", "mock.mid": "Medium", "mock.yesterday": "Yesterday", "mock.c3": "Buy bulbs for the hallway",
    "mock.shopping": "Shopping", "mock.low": "Low", "mock.ghost": "Call the car insurance", "mock.dragging": "dragging…",
    "stats.s1": "current version, in production", "stats.s2": "of RAM in real use",
    "stats.cmd": "command", "stats.s3": "to install, update and uninstall", "stats.eur": "€", "stats.s4": "forever · AGPL-3.0",
    "scenes.eyebrow": "At home",
    "scenes.title": "From shopping to work, and shared expenses: one board",
    "scenes.lede": "Deltos is for what really happens: lists, plans, errands, shared expenses and small projects. Four scenes, all from the real app.",
    "sc1.title": "The shopping and the house",
    "sc1.text": "The list that doesn't get lost in chat: whoever stops by the shop ticks it and home sees it instantly.",
    "sc1.c1": "live sync", "sc1.c2": "colored labels", "sc1.c3": "attachments with photo crop",
    "sc2.title": "The trip with friends",
    "sc2.text": "Every task with an owner, a date and comments. Alerts reach your phone: nothing gets buried in chat.",
    "sc2.c1": "comments on every card", "sc2.c2": "due dates", "sc2.c3": "push to your phone",
    "sc3.title": "School and work",
    "sc3.text": "Shared tasks, each person in their own language. With roles, export and automatic backups.",
    "sc3.c1": "multi-user with roles", "sc3.c2": "ES and EN per person", "sc3.c3": "export and backups",
    "sc4.title": "Shared expenses",
    "sc4.text": "Who paid what and how much each one owes, no spreadsheets. Split, settle in one click, invite with a link.",
    "sc4.c1": "expense splitting", "sc4.c2": "invite without an account", "sc4.c3": "one-click settle",
    "sc4.note": "(optional plugin, enable in Settings)",
    "shots.eyebrow": "The app",
    "shots.title": "The app, inside",
    "shots.lede": "Real screenshots from the demo, in your language and your theme. Click any of them for full size.",
    "shot.board.cap": "The board, with its three stages and filters",
    "shot.casa.cap": "The Home project, with labels and priorities",
    "shot.viaje.cap": "The Lisbon trip, with dates and owners",
    "shot.trabajo.cap": "The Work board, for small teams",
    "shot.expenses.cap": "Shared expenses, with their splits",
    "shot.settings.cap": "Settings: theme, accent, density and labels",
    "shots.close": "Close",
    "feat.eyebrow": "What's in it", "feat.title": "Everything the board can do",
    "feat.lede": "Twelve pieces that fit together, including the expense plugin. Not a single filler feature.",
    "f1.t": "Live sync", "f1.p": "Drag a card and everyone sees it instantly, no refresh. All over SSE.",
    "f2.t": "Phone alerts", "f2.p": "Web Push with the app closed: assigns and comments reach you.",
    "f3.t": "Cards with everything", "f3.p": "Comments, cropped attachments, priority, due dates and activity.",
    "f4.t": "Projects and labels", "f4.p": "Each project with its own board and labels to filter.",
    "f5.t": "Each one in their language", "f5.p": "Roles, hashed passwords and rate-limited login.",
    "f6.t": "Installable PWA", "f6.p": "Installable app, works offline, with light and dark theme.",
    "f7.t": "One-click demo", "f7.p": "Sign in password-free into a demo full of sample tasks.",
    "f8.t": "Your data, yours", "f8.p": "JSON export, automatic backups and an audit trail.",
    "f9.t": "Shared expenses", "f9.p": "Equal or per-person splits, via Bizum, transfer or cash.",
    "f10.t": "Invite anyone", "f10.p": "One link: see their share, comment, mark as paid. No signup.",
    "f11.t": "Settle up", "f11.p": "One click and the app calculates who owes whom. Done.",
    "f12.t": "Drag your cards", "f12.p": "Hold and drag on mobile, or swipe the whole column.",
    "cmp.eyebrow": "Compare",
    "cmp.title": "The category that was missing: a light board for real life",
    "cmp.lede": "This is a comparison of task boards, not office suites. Data cross-checked against each project's public sources in August 2026.",
    "cmp.l1": "native", "cmp.l2": "partial, paid or cloud only", "cmp.l3": "not available", "cmp.l4": "not applicable",
    "cmp.t1": "Platform and deployment", "cmp.t2": "Everyday tasks",
    "cmp.cloud": "(cloud only)", "cmp.unmaint": "(unmaintained)",
    "cmp.r.account": "Account / subscription", "cmp.none": "none", "cmp.freelim": "free with limits",
    "cmp.peruser": "per user", "cmp.optional": "optional", "cmp.none2": "none", "cmp.none3": "none",
    "cmp.r.ram": "Realistic RAM", "cmp.cloud2": "cloud", "cmp.cloud3": "cloud",
    "cmp.nopub": "not published", "cmp.nopub2": "not published", "cmp.min": "min.",
    "cmp.r.deps": "Dependencies", "cmp.r.license": "License", "cmp.prop": "proprietary", "cmp.prop2": "proprietary",
    "cmp.r.maint": "Active maintenance", "cmp.yes": "yes", "cmp.yes2": "yes", "cmp.yes3": "yes", "cmp.yes4": "yes", "cmp.yes5": "yes",
    "cmp.disc": "(discontinued)",
    "cmp.r.live": "Live sync", "cmp.r.push": "Push with app closed", "cmp.apps": "apps",
    "cmp.r.comments": "Comments", "cmp.r.attach": "Attachments", "cmp.r.labels": "Labels", "cmp.props": "properties",
    "cmp.r.due": "Due dates", "cmp.r.roles": "Multi-user roles", "cmp.r.export": "Data export", "cmp.premium": "paid CSV",
    "cmp.r.demo": "Demo mode", "cmp.templates": "templates", "cmp.r.pwa": "Installable PWA",
    "cmp.native": "native apps", "cmp.native2": "native apps", "cmp.native3": "native apps",
    "cmp.r.split": "Shared expenses with splits",
    "cmp.nodoc": "not doc.", "cmp.nodoc2": "not doc.", "cmp.nodoc3": "not doc.", "cmp.nodoc4": "not doc.",
    "cmp.nodoc5": "not doc.", "cmp.nodoc6": "not doc.", "cmp.nodoc7": "not doc.",
    "cmp.nodoc10": "not doc.", "cmp.nodoc11": "not doc.", "cmp.nodoc12": "not doc.", "cmp.nodoc13": "not doc.",
    "cmp.nodoc14": "not doc.", "cmp.nodoc15": "not doc.", "cmp.nodoc16": "not doc.", "cmp.nodoc17": "not doc.",
    "cmp.nodoc18": "not doc.", "cmp.nodoc19": "not doc.", "cmp.nodoc20": "not doc.",
    "honest.t": "The honest side",
    "honest.p1": "Deltos deliberately does less: no swimlanes, no Gantt view, no CalDAV, no integrations and no complex automations. If you run software sprints, use Jira. If you want an all-in-one manager with Gantt and calendars, Vikunja fits you better. And Trello is still a great product if you don't mind your boards living in Atlassian's cloud.",
    "honest.p2": "But if what you want is <strong>a shared board for home life, on your own server, with your data in one file you just copy</strong>, Deltos is the only tool in that category. And the only one that alerts your phone with the app closed, splits household expenses, and installs in a single line.",
    "inst.eyebrow": "Install", "inst.title": "Set up your own board",
    "inst.lede": "The installer downloads the latest release, verifies its checksum and installs Node and the systemd service. No Docker, no manual dependencies.",
    "inst.tl1": "# downloads the release · verifies the checksum",
    "inst.tl2": "# installs Node · creates the systemd service · done",
    "inst.copy": "Copy command",
    "inst.note1": "The installer is plain, readable shell.", "inst.note2": "Inspect it first",
    "inst.note3": "Update by re-running the same line; uninstall with",
    "inst.r1": "(x86_64 or arm64): Debian, Ubuntu, Fedora, Arch…", "inst.r2": "is installed for you, version verified",
    "inst.r3b": "No Docker", "inst.r3": "(though a Docker option is available if you prefer)",
    "inst.r4": "needs HTTPS (Nginx Proxy Manager, Caddy…)",
    "club.eyebrow": "The club", "club.title": "Cloudless Club principles",
    "club.lede": "Deltos follows the three principles of the Cloudless Club. They are shared by every app in the club and live in a single place.",
    "club.c1t": "Digital sovereignty",
    "club.c1p": "Your data lives on your server, in one file you can copy, export or take with you whenever you want. Nobody holds it hostage.",
    "club.c2t": "Free forever",
    "club.c2p": "No plans, no artificial limits, no «premium». Open source under AGPL-3.0, today and always.",
    "club.c3t": "By people, not companies",
    "club.c3p": "Software made by people who use what they publish. No investors, no growth metrics, no surprises.",
    "club.cta": "Meet the club",
    "about.eyebrow": "About me", "about.title": "A person is behind Deltos",
    "about.p1": "Deltos was not built to be published. I started it to organize a trip with friends, and it ended up on the kitchen cork board at home: the groceries, the renovation, the school stuff. I have used it every day for a long time: <strong>it is my unified tool to keep life on a board</strong>. I develop it in my spare time, between work and family.",
    "about.p2": "Over time, and consistently with the principles I believe in, I decided to make it free and share it with the community. There is no company behind it, just a person who uses what they publish. It will always be free, it runs 24/7 in production at my home, and every release is tested there first. If it helps you, I am glad. If something breaks, I want to know.",
    "about.kofi": "Support me on Ko-fi", "about.kofi2": "a coffee if it helps you",
    "about.bug": "Something broken?", "about.bug2": "open an issue and I'll look",
    "foot.tag": "Everyday tasks on a shared board. At home, no cloud.",
    "foot.c1": "Project", "foot.c2": "Community", "foot.c3": "Support",
    "foot.r1": "Releases", "foot.r2": "Documentation", "foot.r3": "License",
    "foot.r4": "Discussions", "foot.r5": "Contribute", "foot.r6": "Buy me a coffee", "foot.r7": "Star on GitHub",
    "foot.copy": "AGPL-3.0 · Made at home, for home life.", "foot.live": "live"
  };

  const enAlt = {
    "shot.board.alt": "Deltos board in demo mode with the New, In progress and Done stages, and cards for home, work and trip",
    "shot.casa.alt": "Deltos Home project board with cards like booking the car inspection or reviewing the renovation quote",
    "shot.viaje.alt": "Deltos Trip to Lisbon project board with hotel bookings, tickets and a restaurant list",
    "shot.trabajo.alt": "Deltos Work project board with the quarterly presentation, an invoice and a login bug",
    "shot.expenses.alt": "Deltos expenses board with the supermarket shopping, a dinner and the power bill, with payment splits",
    "shot.settings.alt": "Deltos settings: light, dark or auto theme, accent color, density and label editor"
  };

  const enAria = {
    "appearance.theme": "Toggle theme",
    "shots.close": "Close",
    "shots.prev": "Previous",
    "shots.next": "Next"
  };

  const titles = {
    es: "Deltos - tareas y gastos de casa en un tablero. Sin nube.",
    en: "Deltos - home tasks and expenses on one board. No cloud."
  };

  function setLang(lang) {
    const dict = lang === 'en' ? enDict : esDict;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const v = dict[el.dataset.i18n];
      if (v !== undefined) el.innerHTML = v;
    });
    const altDict = lang === 'en' ? enAlt : esAlt;
    document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      const v = altDict[el.dataset.i18nAlt];
      if (v !== undefined) el.setAttribute('alt', v);
    });
    const ariaDict = lang === 'en' ? enAria : esAria;
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      const v = ariaDict[el.dataset.i18nAria];
      if (v !== undefined) el.setAttribute('aria-label', v);
    });
    document.documentElement.lang = lang;
    document.title = titles[lang];
    document.getElementById('langEs').classList.toggle('active', lang === 'es');
    document.getElementById('langEn').classList.toggle('active', lang === 'en');
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* noop */ }
    document.dispatchEvent(new CustomEvent('deltos:lang', { detail: lang }));
  }

  function initialLang() {
    const urlLang = new URLSearchParams(window.location.search).get('hl');
    if (urlLang === 'en' || urlLang === 'es') return urlLang;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'es') return saved;
    } catch (e) { /* noop */ }
    return (navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  }

  document.getElementById('langEs').addEventListener('click', function () { setLang('es'); });
  document.getElementById('langEn').addEventListener('click', function () { setLang('en'); });

  window.LandingLang = {
    setLang: setLang,
    get lang() { return document.documentElement.lang || 'es'; },
    altFor: function (key) { return (this.lang === 'en' ? enAlt : esAlt)[key] || ''; },
    textFor: function (key) {
      const d = this.lang === 'en' ? enDict : esDict;
      return d[key] !== undefined ? d[key] : '';
    },
    ariaFor: function (key) { return (this.lang === 'en' ? enAria : esAria)[key] || ''; }
  };

  const boot = initialLang();
  if (boot !== 'es') setLang(boot);
})();
