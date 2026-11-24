// Token Launch Radar, model radar-2. It reads window.RADAR_DATA (or the legacy window.RADAR)
// and renders the ranked board, the model's own calibration, a filterable and sortable table, and a
// per-protocol detail panel whose figures are the very numbers board.json carries: the value
// breakdown and the farm plan are the entry's own, not a second copy. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR_DATA || window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUSD(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function fmtFull(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function fmtPct(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function fmtAge(d) { return d == null ? '—' : d >= 730 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function fmtMult(x) { return Number(x).toFixed(3); }

  var hash = {};
  (location.hash || '').replace(/^#/, '').split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv.length === 2) hash[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
  });

  var state = {
    q: hash.q || '',
    category: hash.cat || 'all',
    chain: hash.chain || 'all',
    watch: hash.watch === '1',
    sort: hash.sort || 'rank',
    dir: 1,
    tab: hash.tab || 'board',
    selected: hash.detail || null,
  };

  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }

  var SORTS = {
    name: function (a, b) { return a.name.localeCompare(b.name); },
    category: function (a, b) { return (a.category || '').localeCompare(b.category || ''); },
    chains: function (a, b) { return a.chains.join().localeCompare(b.chains.join()); },
    rank: function (a, b) { return a.rank - b.rank; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    change: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
    multiple: function (a, b) { return b.category_multiple - a.category_multiple; },
  };

  function saveHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    history.replaceState(null, '', '#' + parts.join('&'));
  }

  function headerHTML() {
    return '<header class="top"><div class="masthead"><p class="eyebrow"><span class="radar-mark" aria-hidden="true"></span>Token launch radar</p>'
      + '<span class="edition">make.fun / Research board <span class="edition-model">Model ' + esc(DATA.model_version) + '</span></span></div>'
      + '<div class="hero"><h1>Pre-token protocols.<br><em>Priced by their peers.</em></h1>'
      + '<div class="intro"><p class="deck">Ranked by what a token would be worth.</p>'
      + '<p class="sub">Every protocol in the sealed snapshot that records no token, screened against the house watchlist and priced by live peers in its category. Each row carries the steps to farm it.</p></div></div>'
      + '<div class="stats">'
      + '<div class="stat"><b>' + DATA.board_size + '</b><span>protocols ranked</span></div>'
      + '<div class="stat"><b>' + DATA.watchlist_size + '</b><span><i class="watch-dot"></i>on the house watchlist</span></div>'
      + '<div class="stat"><b>' + DATA.early_size + '</b><span>found below the floor</span></div>'
      + '<div class="stat"><b>' + DATA.screened_size + '</b><span>derivatives screened out</span></div>'
      + '<div class="stat date"><b>' + esc(DATA.as_of) + '</b><span>snapshot date (UTC)</span></div>'
      + '</div></header>';
  }

  function modelHTML() {
    var cal = DATA.calibration;
    var rows = cal.categories.slice(0, 8).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="n">' + c.peers + '</td><td class="n">' + fmtMult(c.median) + '</td><td class="n used">' + fmtMult(c.multiple) + '</td></tr>';
    }).join('');
    return '<section class="model" aria-labelledby="model-title"><div class="method"><p class="section-label">The methodology</p><h2 id="model-title">How a value is priced</h2>'
      + '<p class="model-intro">Live category peers set the price. No fixed multiple or hand-picked names.</p>'
      + '<div class="formula"><span>Implied value</span><strong>TVL <i>×</i> category multiple <i>×</i> growth <i>×</i> maturity</strong></div>'
      + '<dl class="definitions"><div><dt>Multiple</dt><dd>Live peers\' median cap-to-TVL, with ratios capped at the field\'s 75th percentile, shrunk toward the global median (' + fmtMult(cal.global_median) + ', ' + cal.live_peers + ' peers) by peer count.</dd></div>'
      + '<div><dt>Growth</dt><dd>Seven-day TVL change, clamped −50%…+100%, × 0.4.</dd></div>'
      + '<div><dt>Maturity</dt><dd>0.70–1.00 over four tokenless years.</dd></div></dl>'
      + '<p class="screen-note">Wrapped, staked and bridged products of tokens already trading are screened out first (' + DATA.screened_size + '), as on the house watchlist.</p></div>'
      + '<div class="calibration"><p class="section-label">Calibration / live market peers</p><table class="cal"><thead><tr><th>Category</th><th class="n">Live peers</th><th class="n">Median cap/TVL</th><th class="n">Multiple used</th></tr></thead>'
      + '<tbody>' + rows
      + '<tr class="global"><td>All categories (fallback)</td><td class="n">' + cal.live_peers + '</td><td class="n">' + fmtMult(cal.global_median) + '</td><td class="n used">' + fmtMult(cal.global_median) + '</td></tr>'
      + '</tbody></table></div></section>';
  }

  function controlsHTML() {
    var catOpts = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<section class="controls" aria-label="Board controls">'
      + '<div class="tabs" role="group" aria-label="View">'
      + '<button type="button" data-tab="board" aria-pressed="' + (state.tab === 'board') + '">Pre-token board</button>'
      + '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Already trading</button></div><div class="filters">'
      + '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '" aria-label="Search">'
      + '<select id="cat" aria-label="Category">' + catOpts + '</select>'
      + '<select id="chain" aria-label="Chain">' + chainOpts + '</select>'
      + '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>'
      + '</div><div class="results"><span class="count" id="count" role="status"></span><span>Click a protocol to explore its value &amp; farm plan <span aria-hidden="true">↗</span></span></div></section>';
  }

  function boardHTML(rows) {
    var head = '<table class="board"><thead><tr>'
      + '<th data-sort="rank">#</th><th data-sort="name">Protocol</th><th data-sort="category">Category</th><th data-sort="chains">Chains</th><th class="n" data-sort="tvl">TVL</th>'
      + '<th class="n" data-sort="change">7d</th><th class="n" data-sort="age">Age</th>'
      + '<th class="n" data-sort="multiple">Multiple</th><th class="n" data-sort="implied">Implied value</th></tr></thead><tbody>';
    var body = rows.map(function (r) {
      var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '" aria-selected="' + (state.selected === r.slug) + '" tabindex="0">'
        + '<td class="n">' + r.rank + '</td>'
        + '<td><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '')
        + '</td><td class="cat">' + esc(r.category || '—') + '</td>'
        + '<td class="chains" title="' + esc(r.chains.join(', ')) + '">' + esc(r.chains.slice(0, 3).join(' · ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
        + '<td class="n">' + fmtUSD(r.tvl_usd) + '</td><td class="n">' + chg + '</td>'
        + '<td class="n">' + fmtAge(r.age_days) + '</td><td class="n">' + fmtMult(r.category_multiple) + '</td>'
        + '<td class="n implied">' + fmtUSD(r.implied_value_usd) + '</td></tr>';
    }).join('');
    return '<div class="boardwrap">' + head + (body || '<tr><td colspan="9" class="empty">No protocols match these filters.</td></tr>') + '</tbody></table></div>';
  }

  function liveHTML() {
    var body = DATA.live.map(function (r) {
      return '<tr><td><span class="nm">' + esc(r.name) + '</span><div class="chains">' + esc(r.chains.slice(0, 3).join(' · ')) + '</div></td>'
        + '<td class="cat">' + esc(r.category || '—') + '</td><td class="n">' + fmtUSD(r.tvl_usd) + '</td>'
        + '<td class="n implied">' + fmtUSD(r.mcap_usd) + '</td><td class="n">' + (r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : '—') + '</td><td class="n">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<div class="boardwrap"><table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Ratio</th><th class="n">7d</th></tr></thead><tbody>'
      + body + '</tbody></table></div>'
      + '<p class="empty">These protocols already have a token: the radar shows the market\'s own value and never ranks them against the pre-token board. '
      + 'Their market-cap-to-TVL ratios are the peers the model calibrates from.</p>';
  }

  function detailHTML() {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { r = DATA.rows[i]; break; }
    if (!r || state.tab === 'live') return '';
    state.selected = r.slug;
    var peerLine = r.peer_count > 0
      ? 'median ' + fmtMult(r.peer_median) + ' across ' + r.peer_count + ' live peer' + (r.peer_count === 1 ? '' : 's') + ', shrunk toward the global median'
      : 'no live peers in this category: the global median applies';
    var growthLine = r.change_7d == null ? 'seven-day change not recorded, counted as 0' : 'seven-day TVL change ' + fmtPct(r.change_7d) + ', clamped to −50%…+100%';
    var ageLine = r.age_days == null ? 'listing date not recorded, counted as 365 days' : 'tracked for ' + r.age_days + ' days with no token; full credit at 1,460';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<div class="detail-shade" data-close></div><aside class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1"><div class="detail-top"><span class="section-label">Protocol research</span><button type="button" class="close" data-close aria-label="Close detail">Close <span aria-hidden="true">×</span></button></div><h2 id="detail-title">' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>'
      + '<p class="meta">Rank #' + r.rank + ' of ' + DATA.board_size + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain recorded')
      + (r.listed_at ? ' · tracked since ' + esc(r.listed_at) : '') + '</p>'
      + '<div class="detail-value"><span>Implied value</span><strong>' + fmtUSD(r.implied_value_usd) + '</strong><small>TVL × multiple × growth × maturity</small></div><h3>Why this value</h3><table class="calc"><tbody>'
      + '<tr><td>TVL in the snapshot</td><td class="n">' + fmtFull(r.tvl_usd) + '</td></tr>'
      + '<tr><td>× Category multiple<span class="why">' + esc(peerLine) + '</span></td><td class="n">' + fmtMult(r.category_multiple) + '</td></tr>'
      + '<tr><td>× Growth<span class="why">' + esc(growthLine) + '</span></td><td class="n">' + fmtMult(r.growth_multiplier) + '</td></tr>'
      + '<tr><td>× Maturity<span class="why">' + esc(ageLine) + '</span></td><td class="n">' + fmtMult(r.maturity_multiplier) + '</td></tr>'
      + '<tr class="total"><td>Implied value</td><td class="n">' + fmtFull(r.implied_value_usd) + '</td></tr>'
      + '</tbody></table>'
      + '<h3>How to farm it</h3><ol class="plan">' + steps + '</ol></aside>';
  }

  function render() {
    var rows = filtered().sort(SORTS[state.sort] || SORTS.rank);
    if (state.dir < 0) rows.reverse();
    var main = state.tab === 'live' ? liveHTML() : boardHTML(rows);
    app.innerHTML = headerHTML() + modelHTML() + controlsHTML()
      + '<div class="layout">' + main + '</div>' + detailHTML()
      + '<footer>Source: ' + esc(DATA.source) + ', sealed as of ' + esc(DATA.as_of) + ' (UTC). A protocol appears here because its snapshot record carries no token; '
      + 'that is what the record says, not proof that no token exists. An implied value is this board\'s own model claim about what a token would be worth '
      + 'if the protocol\'s record stayed as it is; it is not a price prediction or a prediction that a token will be issued. Model ' + esc(DATA.model_version) + ', computed from the snapshot alone, offline.</footer>';
    app.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count) count.textContent = state.tab === 'live' ? DATA.live.length + ' trading' : rows.length + ' of ' + DATA.board_size + ' shown';
    document.body.classList.toggle('detail-open', !!document.querySelector('.detail'));
    bind(rows);
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      var active = th.getAttribute('data-sort') === state.sort;
      th.setAttribute('aria-sort', active ? ((state.sort === 'rank' || /name|category|chains/.test(state.sort)) === (state.dir > 0) ? 'ascending' : 'descending') : 'none');
      th.innerHTML = '<button type="button">' + th.textContent + '<span class="sort-icon" aria-hidden="true">' + (active ? (th.getAttribute('aria-sort') === 'ascending' ? '↑' : '↓') : '↕') + '</span></button>';
    });
    saveHash();
  }

  function closeDetail() {
    var slug = state.selected; state.selected = null; render();
    Array.prototype.some.call(document.querySelectorAll('[data-slug]'), function (el) { if (el.getAttribute('data-slug') === slug) { el.focus({preventScroll:true}); return true; } });
  }

  function bind(rows) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeDetail); });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var watch = document.getElementById('watch');
    if (watch) watch.addEventListener('change', function () { state.watch = watch.checked; render(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = 1; }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-slug]'), function (tr) {
      function pick() { var top = document.querySelector('.boardwrap').scrollTop; state.selected = tr.getAttribute('data-slug'); render(); document.querySelector('.boardwrap').scrollTop = top; document.querySelector('.detail').focus(); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  document.addEventListener('keydown', function (e) {
    var panel = document.querySelector('.detail');
    if (!panel) return;
    if (e.key === 'Escape') closeDetail();
    if (e.key === 'Tab') { e.preventDefault(); panel.querySelector('.close').focus(); }
  });
  window.addEventListener('hashchange', function () {
    var params = new URLSearchParams(location.hash.slice(1));
    state.q = params.get('q') || ''; state.category = params.get('cat') || 'all';
    state.chain = params.get('chain') || 'all'; state.watch = params.get('watch') === '1';
    state.sort = params.get('sort') || 'rank'; state.tab = params.get('tab') || 'board';
    state.selected = params.get('detail'); state.dir = 1; render();
  });
  render();
})();
