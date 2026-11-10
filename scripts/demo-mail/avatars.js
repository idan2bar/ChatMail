/* Procedural demo avatars. Plain browser script; exposes window.demoAvatarSvg / demoAvatarSenders / demoAvatarPng. */
(function () {
  'use strict';

  // ---------- seeded random ----------
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- brand glyphs: 100x100 box, white; "@" is replaced with the dark background tone ----------
  var W = '#fff';
  function ring(cx, cy, r, n, w) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      s += 'M' + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1) +
        'L' + (cx + Math.cos(a) * (r + w)).toFixed(1) + ' ' + (cy + Math.sin(a) * (r + w)).toFixed(1);
    }
    return s;
  }
  var petals = [[50, 28], [70.9, 43.2], [63, 67.8], [37, 67.8], [29.1, 43.2]].map(function (p) {
    return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="17"/>';
  }).join('');

  var GLYPHS = {
    coffee: '<path d="M20 38h48v22a18 18 0 0 1-18 18H38a18 18 0 0 1-18-18z"/>' +
      '<path d="M68 44h6a10 10 0 0 1 0 20h-8" fill="none" stroke="' + W + '" stroke-width="6"/>' +
      '<path d="M35 14q-6 7 0 13M48 12q-6 8 0 15" fill="none" stroke="' + W + '" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M14 88h60" stroke="' + W + '" stroke-width="6" stroke-linecap="round"/>',
    leaf: '<path d="M16 84C8 42 34 14 86 14c4 46-20 70-56 68z"/>' +
      '<path d="M20 80L62 38M44 56l2-18M52 48l14 2" fill="none" stroke="@" stroke-width="4" stroke-linecap="round" opacity=".45"/>',
    plane: '<path d="M50 8c4 0 6 4 6 10v22l34 22v8L56 62v16l10 8v6l-16-4-16 4v-6l10-8V62L10 70v-8l34-22V18c0-6 2-10 6-10z"/>',
    book: '<path d="M8 24c14-5 29-4 40 5v52C37 72 22 71 8 76z"/><path d="M92 24c-14-5-29-4-40 5v52c11-9 26-10 40-5z"/>',
    dumbbell: '<rect x="4" y="38" width="12" height="24" rx="3"/><rect x="18" y="26" width="14" height="48" rx="4"/>' +
      '<rect x="32" y="45" width="36" height="10"/><rect x="68" y="26" width="14" height="48" rx="4"/><rect x="84" y="38" width="12" height="24" rx="3"/>',
    mic: '<rect x="36" y="8" width="28" height="50" rx="14"/>' +
      '<path d="M24 46a26 26 0 0 0 52 0M50 72v16M34 90h32" fill="none" stroke="' + W + '" stroke-width="6" stroke-linecap="round"/>',
    play: '<rect x="8" y="20" width="84" height="60" rx="18"/><path d="M42 36l24 14-24 14z" fill="@"/>',
    wrench: '<path d="M72 8a24 24 0 0 0-22 32L12 78a9 9 0 0 0 12 12l38-38a24 24 0 0 0 32-22L74 46l-14-6-4-14z"/>',
    shield: '<path d="M50 6l36 13v27c0 24-15 40-36 48C29 86 14 70 14 46V19z"/>' +
      '<path d="M33 48l13 13 22-25" fill="none" stroke="@" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    bank: '<path d="M50 8l44 24H6z"/><rect x="14" y="40" width="12" height="36"/><rect x="34" y="40" width="12" height="36"/>' +
      '<rect x="54" y="40" width="12" height="36"/><rect x="74" y="40" width="12" height="36"/><rect x="8" y="82" width="84" height="10" rx="2"/>',
    box: '<path d="M50 8l38 19v46L50 92 12 73V27z"/>' +
      '<path d="M12 27l38 19 38-19M50 46v46M31 17l38 19" fill="none" stroke="@" stroke-width="4" stroke-linejoin="round" opacity=".5"/>',
    calendar: '<rect x="10" y="18" width="80" height="72" rx="10"/><rect x="24" y="6" width="9" height="22" rx="4.5"/><rect x="67" y="6" width="9" height="22" rx="4.5"/>' +
      '<rect x="18" y="38" width="64" height="44" rx="5" fill="@" opacity=".35"/>' +
      '<rect x="24" y="46" width="14" height="10" rx="2"/><rect x="43" y="46" width="14" height="10" rx="2"/><rect x="62" y="46" width="14" height="10" rx="2"/>' +
      '<rect x="24" y="63" width="14" height="10" rx="2"/><rect x="43" y="63" width="14" height="10" rx="2"/>',
    code: '<path d="M34 28L12 50l22 22M66 28l22 22-22 22M57 20L43 80" fill="none" stroke="' + W + '" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
    terminal: '<rect x="8" y="16" width="84" height="68" rx="10"/>' +
      '<path d="M24 38l16 12-16 12M48 66h26" fill="none" stroke="@" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
    chart: '<rect x="12" y="54" width="18" height="32" rx="3"/><rect x="41" y="34" width="18" height="52" rx="3"/><rect x="70" y="14" width="18" height="72" rx="3"/>',
    fork: '<path d="M22 8v24c0 8 5 12 12 12s12-4 12-12V8M34 8v82" fill="none" stroke="' + W + '" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M70 90V10c-12 6-17 22-17 38h17z" stroke="' + W + '" stroke-width="4" stroke-linejoin="round"/>',
    palette: '<path d="M50 8C26 8 8 27 8 50s17 42 40 42c9 0 11-6 7-12s0-12 8-12h14c13 0 23-5 23-17C100 26 76 8 50 8z" transform="translate(-2 0)"/>' +
      '<circle cx="28" cy="48" r="7" fill="@"/><circle cx="40" cy="28" r="7" fill="@" opacity=".7"/><circle cx="62" cy="26" r="7" fill="@"/><circle cx="76" cy="44" r="7" fill="@" opacity=".7"/>',
    flower: petals + '<circle cx="50" cy="50" r="12" fill="@"/>',
    bolt: '<path d="M58 6L18 56h26l-6 38 44-54H56z" stroke="' + W + '" stroke-width="3" stroke-linejoin="round"/>',
    suitcase: '<rect x="8" y="30" width="84" height="56" rx="10"/>' +
      '<path d="M34 30v-8a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v8" fill="none" stroke="' + W + '" stroke-width="6"/>' +
      '<path d="M8 55h84" stroke="@" stroke-width="4" opacity=".4"/><rect x="43" y="49" width="14" height="12" rx="3" fill="@" opacity=".6"/>',
    cart: '<path d="M6 16h14l11 46h44l9-32" fill="none" stroke="' + W + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M26 32h58l-8 28H33z"/><circle cx="38" cy="80" r="7"/><circle cx="72" cy="80" r="7"/>',
    star: '<path d="M50 6l13 28 30 4-22 21 6 30-27-15-27 15 6-30L7 38l30-4z" stroke="' + W + '" stroke-width="3" stroke-linejoin="round"/>',
    film: '<path d="M8 24L82 8l4 18L12 42z"/><path d="M26 20l8 10M44 16l8 10M62 12l8 10" stroke="@" stroke-width="5" stroke-linecap="round" opacity=".55"/>' +
      '<rect x="8" y="46" width="84" height="44" rx="6"/>',
    news: '<rect x="12" y="10" width="76" height="80" rx="8"/><rect x="22" y="22" width="56" height="16" rx="3" fill="@" opacity=".55"/>' +
      '<path d="M22 50h56M22 62h56M22 74h34" fill="none" stroke="@" stroke-width="5" stroke-linecap="round" opacity=".55"/>',
    chat: '<path d="M16 12h68a8 8 0 0 1 8 8v42a8 8 0 0 1-8 8H50L28 90V70H16a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8z"/>' +
      '<circle cx="30" cy="41" r="5.5" fill="@"/><circle cx="50" cy="41" r="5.5" fill="@"/><circle cx="70" cy="41" r="5.5" fill="@"/>',
    heart: '<path d="M50 90C12 64 6 40 17 25c9-12 27-10 33 4 6-14 24-16 33-4 11 15 5 39-33 65z"/>',
    mountain: '<path d="M2 86L34 28l17 27 12-18 35 49z"/><circle cx="76" cy="20" r="9"/>',
    cap: '<path d="M50 14L4 37l46 23 46-23z"/><path d="M24 52v20c0 9 52 9 52 0V52L50 65z"/>' +
      '<path d="M90 40v28" stroke="' + W + '" stroke-width="5" stroke-linecap="round"/>',
    sun: '<circle cx="50" cy="50" r="20"/><path d="' + ring(50, 50, 30, 8, 14) + '" stroke="' + W + '" stroke-width="7" stroke-linecap="round"/>'
  };

  // keyword -> glyph, first match wins (matched against "name domain local")
  var KEYWORDS = [
    [/brightside|sunrise|sunny/, 'sun'],
    [/air\b|airline|flight|northwind/, 'plane'],
    [/hammer|hardware|nail|tool|repair/, 'wrench'],
    [/salt|kitchen|recipe|restaurant|food|dining/, 'fork'],
    [/skill|learn|academy|course|school/, 'cap'],
    [/bloom|flower|florist/, 'flower'],
    [/garden|green|plant|thumb/, 'leaf'],
    [/bank|credit|union|harbor|finance|statement/, 'bank'],
    [/wayfarer|travel|hotel|trip|tour/, 'suitcase'],
    [/byte/, 'terminal'],
    [/code|dev|git|nest/, 'code'],
    [/stream|video|watch/, 'play'],
    [/brew|coffee|cafe|bean/, 'coffee'],
    [/trail|outdoor|hike|camp|peak/, 'mountain'],
    [/pixel|grain|design|art\b|studio/, 'palette'],
    [/book|page|library|read/, 'book'],
    [/power|lumen|energy|electric|utility/, 'bolt'],
    [/penny|money|wise|invest|budget/, 'chart'],
    [/shop|cart|store|market|order/, 'cart'],
    [/star|reward|points|loyal/, 'star'],
    [/dispatch|news|daily|sunday|journal/, 'news'],
    [/fit|pulse|gym|sport|coach/, 'dumbbell'],
    [/loud|podcast|audio|radio|wave/, 'mic'],
    [/secure|security|shield|vpn|auth/, 'shield'],
    [/reel|film|movie|cinema/, 'film'],
    [/thread|forum|community|chat/, 'chat'],
    [/friend|social|loop|love|dating/, 'heart'],
    [/calendar|event|schedule|remind/, 'calendar'],
    [/parcel|deliver|ship|package|courier|post/, 'box']
  ];

  // 2-tone backgrounds [light, dark]; harmonious, mid-saturation
  var BRAND_COLORS = [
    ['#f08a5d', '#d9582b'], ['#4fb3a5', '#2a8579'], ['#5b8def', '#3b62c9'], ['#f2b84b', '#d18a14'],
    ['#9b7ede', '#6f4fbd'], ['#ec6f8f', '#c7436a'], ['#58b368', '#2e8a43'], ['#4cb5d6', '#2784a8'],
    ['#e5775a', '#b8452c'], ['#7a8bd8', '#4f5fb0'], ['#d9a066', '#a8713a'], ['#5fa8a0', '#37766f'],
    ['#c46fcb', '#97449e'], ['#6bb5e8', '#3a86c0']
  ];

  function domainOf(email) { return String(email || '').split('@')[1] || ''; }
  function localOf(email) { return String(email || '').split('@')[0] || ''; }

  function brandSvg(sender) {
    var email = String(sender.email || '').toLowerCase();
    var r = rng(hash(email));
    var col = pick(r, BRAND_COLORS);
    var angle = pick(r, [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0.5, 0, 0.5, 1]]);
    var text = ((sender.name || '') + ' ' + domainOf(email) + ' ' + localOf(email)).toLowerCase();
    var glyph = null;
    for (var i = 0; i < KEYWORDS.length; i++) {
      if (KEYWORDS[i][0].test(text)) { glyph = KEYWORDS[i][1]; break; }
    }
    var id = 'g' + hash(email).toString(36);
    var body;
    if (glyph) {
      body = '<g transform="translate(53 53) scale(1.5)" fill="' + W + '">' + GLYPHS[glyph].replace(/@/g, col[1]) + '</g>';
    } else {
      var letter = (String(sender.name || email).replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();
      body = '<circle cx="128" cy="128" r="76" fill="none" stroke="' + W + '" stroke-width="6" opacity=".35"/>' +
        '<text x="128" y="128" text-anchor="middle" dominant-baseline="central" dy=".04em" font-family="sans-serif" font-weight="700" font-size="110" fill="' + W + '">' + esc(letter) + '</text>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
      '<defs><linearGradient id="' + id + '" x1="' + angle[0] + '" y1="' + angle[1] + '" x2="' + angle[2] + '" y2="' + angle[3] + '">' +
      '<stop offset="0" stop-color="' + col[0] + '"/><stop offset="1" stop-color="' + col[1] + '"/></linearGradient></defs>' +
      '<rect width="256" height="256" fill="url(#' + id + ')"/>' + body + '</svg>';
  }

  // ---------- persons ----------
  var SKINS = ['#f6d7bf', '#efc09a', '#e0a97c', '#c68a5e', '#a96b43', '#7d4c2e', '#5a3622'];
  var HAIRS = ['#1f1a17', '#3a2a20', '#5b3b24', '#8a5a33', '#b9803c', '#d6b36a', '#9a9a9f', '#a8402a'];
  var SHIRTS = ['#4f7cdb', '#e0645b', '#3f9d8a', '#f0a43c', '#8a6bd1', '#d96a9b', '#5a6b7d', '#6aa84f', '#2f4f7f', '#c9513a'];
  var BGS = ['#dbe8fb', '#fde3d7', '#dcf1e4', '#fdf0cc', '#e9e0f8', '#fbdde8', '#d9f0f1', '#ece6dc'];
  var FEMALE = /^(sofia|leila|elena|amara|noor|priya|maria|anna|sara|sarah|emma|mia|julia|laura|aisha|fatima|yuki|mei|lina|nina)$/;
  var MALE = /^(jonas|gareth|marcus|tomasz|kenji|diego|john|david|james|omar|ahmed|carlos|rafael|ivan|liam|noah|luca)$/;

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    });
    return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }

  // Each hair style returns [behindHead, inFrontOfHead]
  var HAIR_STYLES = [
    function (h) { // short crop
      return ['', '<path d="M80 108C76 66 98 54 128 54s52 12 48 54c-6-20-22-32-48-32s-42 12-48 32z" fill="' + h + '"/>']; },
    function (h) { // side sweep
      return ['', '<path d="M79 110C70 64 100 50 134 54c30 4 46 24 42 56-4-16-14-26-30-30-20 14-44 18-67 30z" fill="' + h + '"/>']; },
    function (h) { // long
      return ['<path d="M74 112C68 60 98 50 128 50s60 10 54 62l6 86H68z" fill="' + h + '"/>',
        '<path d="M80 110C80 74 100 62 128 62s48 12 48 48c-10-18-26-26-48-24-24 2-38 10-48 24z" fill="' + h + '"/>']; },
    function (h) { // bun
      return ['<circle cx="128" cy="40" r="22" fill="' + h + '"/>',
        '<path d="M80 108C76 66 98 54 128 54s52 12 48 54c-6-20-22-32-48-32s-42 12-48 32z" fill="' + h + '"/>']; },
    function (h) { // curly
      var s = '';
      var pts = [[88, 74, 20], [108, 60, 22], [132, 56, 22], [154, 62, 22], [172, 80, 20], [80, 98, 16], [180, 100, 16], [120, 72, 22], [148, 76, 20]];
      pts.forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '" fill="' + h + '"/>'; });
      return [s, '']; },
    function () { return ['', '']; }, // bald
    function (h) { // bob
      return ['<path d="M72 118C68 62 98 50 128 50s60 12 56 68l-6 38H78z" fill="' + h + '"/>',
        '<path d="M78 108C78 72 100 60 128 60s50 12 50 48c-4-14-14-22-28-26-12 12-40 20-72 26z" fill="' + h + '"/>']; },
    function (h) { // round afro
      return ['<circle cx="128" cy="96" r="66" fill="' + h + '"/>',
        '<path d="M86 104c2-20 18-30 42-30s40 10 42 30c-8-12-22-18-42-18s-34 6-42 18z" fill="' + h + '"/>']; }
  ];
  var MALE_STYLES = [0, 1, 4, 5, 7, 0, 1];
  var FEMALE_STYLES = [2, 3, 6, 4, 2, 6, 3, 7];

  function personSvg(sender) {
    var email = String(sender.email || '').toLowerCase();
    var seed = hash(email);
    var r = rng(seed);
    var first = String(sender.name || localOf(email)).toLowerCase().split(/[\s._]/)[0];
    var gender = FEMALE.test(first) ? 'f' : MALE.test(first) ? 'm' : (r() < 0.5 ? 'f' : 'm');
    var skin = pick(r, SKINS), hair = pick(r, HAIRS), shirt = pick(r, SHIRTS), bg = pick(r, BGS);
    var style = pick(r, gender === 'f' ? FEMALE_STYLES : MALE_STYLES);
    var glasses = r() < 0.3;
    var beard = gender === 'm' && style !== 7 && r() < 0.45;
    var dark = shade(skin, -0.12);
    var hs = HAIR_STYLES[style](hair);
    var id = 'p' + seed.toString(36);

    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
      '<defs><clipPath id="' + id + '"><rect width="256" height="256"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')"><rect width="256" height="256" fill="' + bg + '"/>' +
      hs[0] +
      // shoulders / shirt
      '<path d="M22 262c0-52 44-78 106-78s106 26 106 78z" fill="' + shirt + '"/>' +
      '<path d="M104 184l24 26 24-26" fill="' + shade(shirt, -0.18) + '"/>' +
      // neck
      '<path d="M106 150h44v32c0 12-10 22-22 22s-22-10-22-22z" fill="' + dark + '"/>' +
      '<path d="M106 176c14 10 30 10 44 0v-10c-14 8-30 8-44 0z" fill="' + shade(dark, -0.15) + '" opacity=".5"/>' +
      // ears
      '<circle cx="82" cy="120" r="11" fill="' + skin + '"/><circle cx="174" cy="120" r="11" fill="' + skin + '"/>' +
      // head
      '<ellipse cx="128" cy="116" rx="47" ry="54" fill="' + skin + '"/>' +
      // cheeks
      '<circle cx="100" cy="134" r="8" fill="#ff8c8c" opacity=".18"/><circle cx="156" cy="134" r="8" fill="#ff8c8c" opacity=".18"/>';
    if (beard) {
      s += '<path d="M82 122c0 38 18 60 46 60s46-22 46-60c-8 14-20 22-46 22s-38-8-46-22z" fill="' + hair + '"/>';
    }
    s += hs[1];
    // face
    var brows = '<path d="M97 101q9-6 18 0M141 101q9-6 18 0" fill="none" stroke="' + hair + '" stroke-width="4" stroke-linecap="round"/>';
    s += brows +
      '<circle cx="106" cy="118" r="5" fill="#2b2320"/><circle cx="150" cy="118" r="5" fill="#2b2320"/>' +
      '<circle cx="107.5" cy="116.5" r="1.6" fill="#fff"/><circle cx="151.5" cy="116.5" r="1.6" fill="#fff"/>' +
      '<path d="M128 122v14q-4 3 0 3" fill="none" stroke="' + dark + '" stroke-width="3.5" stroke-linecap="round"/>';
    if (beard) {
      s += '<path d="M114 152q14 10 28 0q-14 4-28 0z" fill="#f4d8d2"/>';
    } else {
      s += '<path d="M113 148q15 13 30 0" fill="none" stroke="#b5574d" stroke-width="4.5" stroke-linecap="round"/>';
    }
    if (glasses) {
      var gc = pick(r, ['#2b2320', '#3a5a8a', '#a8402a']);
      s += '<circle cx="106" cy="118" r="15" fill="#fff" fill-opacity=".18" stroke="' + gc + '" stroke-width="3.5"/>' +
        '<circle cx="150" cy="118" r="15" fill="#fff" fill-opacity=".18" stroke="' + gc + '" stroke-width="3.5"/>' +
        '<path d="M121 117q7-4 14 0M91 116l-9-2M165 116l9-2" fill="none" stroke="' + gc + '" stroke-width="3.5" stroke-linecap="round"/>';
    }
    return s + '</g></svg>';
  }

  // ---------- public API ----------
  window.demoAvatarSvg = function (sender, kind) {
    return kind === 'person' ? personSvg(sender) : brandSvg(sender);
  };

  window.demoAvatarSenders = function (emails) {
    var map = {};
    var order = [];
    (emails || []).forEach(function (m) {
      if (!m || !m.from || m.from === 'ME') return;
      var e = String(m.from.email || '').toLowerCase();
      if (!e) return;
      if (!map[e]) { map[e] = { email: e, name: m.from.name || e, allPrimary: true }; order.push(e); }
      if (m.category !== 'primary') map[e].allPrimary = false;
    });
    return order.map(function (e) {
      var s = map[e];
      var person = s.allPrimary && /^[a-z]+[._][a-z]+$/.test(localOf(e));
      return { email: s.email, name: s.name, kind: person ? 'person' : 'brand' };
    });
  };

  window.demoAvatarPng = function (svg, size) {
    size = size || 256;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = c.height = size;
          c.getContext('2d').drawImage(img, 0, 0, size, size);
          resolve(c.toDataURL('image/png').split(',')[1]);
        } catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('Could not render avatar SVG')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  };
})();
