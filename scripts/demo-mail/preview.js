(function () {
  'use strict';
  var root = document.getElementById('root');

  function card(s) {
    var svg = window.demoAvatarSvg(s, s.kind);
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<div class="imgs"><div class="small">' + svg + '</div><div class="big">' + svg + '</div></div>';
    [['name', s.name], ['email', s.email], ['kind', s.kind]].forEach(function (p) {
      var d = document.createElement('div');
      d.className = p[0];
      d.textContent = p[1];
      el.appendChild(d);
    });
    return el;
  }

  fetch('emails.json')
    .then(function (r) { return r.json(); })
    .then(function (emails) {
      var senders = window.demoAvatarSenders(emails);
      root.textContent = '';
      ['brand', 'person'].forEach(function (kind) {
        var list = senders.filter(function (s) { return s.kind === kind; });
        var h = document.createElement('h2');
        h.textContent = (kind === 'brand' ? 'Brands' : 'Persons') + ' (' + list.length + ')';
        var grid = document.createElement('div');
        grid.className = 'grid';
        list.forEach(function (s) { grid.appendChild(card(s)); });
        root.appendChild(h);
        root.appendChild(grid);
      });
    })
    .catch(function (err) { root.textContent = 'Failed to load emails.json: ' + err.message; });
})();
