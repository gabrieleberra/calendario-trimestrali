/* =========================================================
   CALENDARIO TRIMESTRALI - app.js
   Sito statico per consultare gli earnings di un portafoglio.
   Dati: Financial Modeling Prep (FMP).
   Tutto lato client, nessun backend.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   COSTANTI
   --------------------------------------------------------- */
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore
const FETCH_CONCURRENCY = 4;

const STORAGE_KEYS = {
  apiKey: 'ct_apiKey',
  portfolio: 'ct_portfolio',
  cache: 'ct_cache',
  theme: 'ct_theme',
  view: 'ct_view',
  bannerSeen: 'ct_bannerSeen',
};

const MONTH_NAMES = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];
const WEEKDAY_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

// Mappatura suffisso ticker -> mercato/orario indicativo (per ICS)
const MARKET_BY_SUFFIX = {
  '': { tz: 'America/New_York', bmo: '08:00', amc: '17:00' },
  'MI': { tz: 'Europe/Rome', bmo: '07:30', amc: '17:35' },
  'L': { tz: 'Europe/London', bmo: '07:00', amc: '16:35' },
  'DE': { tz: 'Europe/Berlin', bmo: '07:30', amc: '17:35' },
  'F': { tz: 'Europe/Berlin', bmo: '07:30', amc: '17:35' },
  'AS': { tz: 'Europe/Amsterdam', bmo: '07:30', amc: '17:35' },
  'PA': { tz: 'Europe/Paris', bmo: '07:30', amc: '17:35' },
  'BR': { tz: 'Europe/Brussels', bmo: '07:30', amc: '17:35' },
  'MC': { tz: 'Europe/Madrid', bmo: '08:00', amc: '17:35' },
  'SW': { tz: 'Europe/Zurich', bmo: '08:00', amc: '17:30' },
  'VI': { tz: 'Europe/Vienna', bmo: '08:30', amc: '17:30' },
  'HE': { tz: 'Europe/Helsinki', bmo: '09:00', amc: '18:30' },
  'OL': { tz: 'Europe/Oslo', bmo: '08:00', amc: '16:25' },
  'ST': { tz: 'Europe/Stockholm', bmo: '08:00', amc: '17:30' },
  'CO': { tz: 'Europe/Copenhagen', bmo: '08:00', amc: '17:00' },
  'TO': { tz: 'America/Toronto', bmo: '08:00', amc: '17:00' },
  'V': { tz: 'America/Toronto', bmo: '08:00', amc: '17:00' },
  'AX': { tz: 'Australia/Sydney', bmo: '09:30', amc: '16:30' },
  'NZ': { tz: 'Pacific/Auckland', bmo: '09:30', amc: '17:00' },
  'T': { tz: 'Asia/Tokyo', bmo: '08:30', amc: '15:30' },
  'HK': { tz: 'Asia/Hong_Kong', bmo: '08:30', amc: '16:30' },
  'KS': { tz: 'Asia/Seoul', bmo: '08:30', amc: '15:30' },
  'SS': { tz: 'Asia/Shanghai', bmo: '08:30', amc: '15:00' },
  'SZ': { tz: 'Asia/Shanghai', bmo: '08:30', amc: '15:00' },
};

/* ---------------------------------------------------------
   STATO GLOBALE
   --------------------------------------------------------- */
const state = {
  apiKey: '',
  portfolio: [],          // [{ symbol, addedAt }]
  data: {},               // { TICKER: { profile, earnings, error, fetchedAt } }
  view: 'calendar',       // 'calendar' | 'list'
  calMonth: null,         // {year, month} mese visualizzato
  filters: {
    dateFrom: null,
    dateTo: null,
    time: 'all',           // 'all' | 'future' | 'past'
    sectors: [],
    search: '',
  },
  sortOrder: 'asc',
};

/* ---------------------------------------------------------
   STORAGE HELPERS
   --------------------------------------------------------- */
const Storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

/* ---------------------------------------------------------
   UTILITY DATE
   --------------------------------------------------------- */
function ymd(date) {
  // YYYY-MM-DD in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseYmd(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function startOfWeek(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // lunedì = 0
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
function formatDateIT(date) {
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function formatDateLongIT(date) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/* ---------------------------------------------------------
   FMP API CLIENT
   --------------------------------------------------------- */
async function fmpFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FMP_BASE}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('API key non valida o non autorizzata', 'auth');
  }
  if (res.status === 429) {
    throw new ApiError('Quota API esaurita', 'quota');
  }
  if (!res.ok) {
    throw new ApiError(`Errore HTTP ${res.status}`, 'http');
  }
  const body = await res.json();
  if (body && typeof body === 'object' && body['Error Message']) {
    const msg = body['Error Message'];
    if (/limit|quota/i.test(msg)) throw new ApiError('Quota API esaurita', 'quota');
    if (/key|invalid/i.test(msg)) throw new ApiError('API key non valida', 'auth');
    throw new ApiError(msg, 'api');
  }
  return body;
}

class ApiError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

async function validateApiKey(key) {
  // Endpoint leggero, disponibile su tier free
  const data = await fmpFetch(`/profile/AAPL`, key);
  return Array.isArray(data) && data.length > 0;
}

async function fetchProfile(symbol, apiKey) {
  const data = await fmpFetch(`/profile/${encodeURIComponent(symbol)}`, apiKey);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

async function fetchEarnings(symbol, apiKey) {
  const data = await fmpFetch(`/historical/earning_calendar/${encodeURIComponent(symbol)}`, apiKey);
  if (!Array.isArray(data)) return [];
  return data;
}

/* ---------------------------------------------------------
   CACHE PER TICKER
   --------------------------------------------------------- */
function loadCache() {
  return Storage.get(STORAGE_KEYS.cache, {}) || {};
}
function saveCache(cache) {
  Storage.set(STORAGE_KEYS.cache, cache);
}
function isCacheFresh(entry) {
  return entry && entry.fetchedAt && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

/* ---------------------------------------------------------
   FETCH PORTAFOGLIO COMPLETO (con concorrenza limitata)
   --------------------------------------------------------- */
async function fetchPortfolioData({ force = false } = {}) {
  if (!state.apiKey) throw new ApiError('API key mancante', 'auth');
  if (state.portfolio.length === 0) return;

  const cache = loadCache();
  const symbols = state.portfolio.map(p => p.symbol);
  const total = symbols.length;
  let done = 0;

  showLoading(`Caricamento 0/${total} ticker…`);

  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, total) }, async () => {
    while (queue.length > 0) {
      const sym = queue.shift();
      const cached = cache[sym];
      if (!force && isCacheFresh(cached)) {
        state.data[sym] = cached;
        done++;
        showLoading(`Caricamento ${done}/${total} ticker…`);
        continue;
      }
      try {
        const [profile, earnings] = await Promise.all([
          fetchProfile(sym, state.apiKey).catch(e => { throw e; }),
          fetchEarnings(sym, state.apiKey).catch(e => { throw e; }),
        ]);
        const entry = { profile, earnings, error: null, fetchedAt: Date.now() };
        if (!profile && (!earnings || earnings.length === 0)) {
          entry.error = 'Ticker non trovato';
        }
        state.data[sym] = entry;
        cache[sym] = entry;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err.message || 'Errore sconosciuto');
        const entry = { profile: null, earnings: [], error: msg, fetchedAt: Date.now() };
        state.data[sym] = entry;
        cache[sym] = entry;
        if (err instanceof ApiError && (err.kind === 'auth' || err.kind === 'quota')) {
          // Errori bloccanti: svuotiamo la coda
          queue.length = 0;
          throw err;
        }
      }
      done++;
      showLoading(`Caricamento ${done}/${total} ticker…`);
    }
  });

  try {
    await Promise.all(workers);
    saveCache(cache);
  } catch (err) {
    saveCache(cache);
    throw err;
  } finally {
    hideLoading();
  }
}

/* ---------------------------------------------------------
   DATA TRANSFORM: appiattisce in eventi
   --------------------------------------------------------- */
function buildEvents() {
  const events = [];
  for (const sym of state.portfolio.map(p => p.symbol)) {
    const entry = state.data[sym];
    if (!entry || !entry.earnings) continue;
    for (const e of entry.earnings) {
      const date = e.date;
      if (!date) continue;
      const time = (e.time || '').toLowerCase();
      let timeCode = 'unknown';
      if (time === 'bmo') timeCode = 'bmo';
      else if (time === 'amc') timeCode = 'amc';
      else if (time === 'dmh' || time === '--') timeCode = 'dmh';
      const eps = num(e.eps);
      const epsEst = num(e.epsEstimated);
      const rev = num(e.revenue);
      const revEst = num(e.revenueEstimated);
      events.push({
        symbol: sym,
        date,
        dateObj: parseYmd(date),
        timeCode,
        eps,
        epsEstimated: epsEst,
        epsSurprise: surprisePct(eps, epsEst),
        revenue: rev,
        revenueEstimated: revEst,
        revenueSurprise: surprisePct(rev, revEst),
        fiscalDateEnding: e.fiscalDateEnding || null,
        profile: entry.profile || null,
        sector: entry.profile?.sector || null,
        industry: entry.profile?.industry || null,
        companyName: entry.profile?.companyName || sym,
        currency: entry.profile?.currency || null,
        website: entry.profile?.website || null,
        exchange: entry.profile?.exchangeShortName || null,
      });
    }
  }
  return events;
}
function num(v) { return (v == null || v === '' || isNaN(+v)) ? null : +v; }
function surprisePct(actual, est) {
  if (actual == null || est == null || est === 0) return null;
  return ((actual - est) / Math.abs(est)) * 100;
}

/* ---------------------------------------------------------
   FILTRI
   --------------------------------------------------------- */
function applyFilters(events) {
  const f = state.filters;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return events.filter(ev => {
    if (!ev.dateObj) return false;

    if (f.dateFrom && ev.dateObj < f.dateFrom) return false;
    if (f.dateTo) {
      const dEnd = new Date(f.dateTo); dEnd.setHours(23, 59, 59, 999);
      if (ev.dateObj > dEnd) return false;
    }

    if (f.time === 'future' && ev.dateObj < today) return false;
    if (f.time === 'past' && ev.dateObj >= today) return false;

    if (f.sectors.length > 0 && !f.sectors.includes(ev.sector || '__none__')) return false;

    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = `${ev.symbol} ${ev.companyName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

/* ---------------------------------------------------------
   PORTAFOGLIO: gestione
   --------------------------------------------------------- */
function parseTickerInput(text) {
  return text
    .split(/[\s,;\n\r\t]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}
function addTickers(symbols) {
  const existing = new Set(state.portfolio.map(p => p.symbol));
  let added = 0;
  for (const sym of symbols) {
    if (!sym || existing.has(sym)) continue;
    state.portfolio.push({ symbol: sym, addedAt: Date.now() });
    existing.add(sym);
    added++;
  }
  if (added > 0) persistPortfolio();
  return added;
}
function removeTicker(symbol) {
  state.portfolio = state.portfolio.filter(p => p.symbol !== symbol);
  delete state.data[symbol];
  const cache = loadCache();
  delete cache[symbol];
  saveCache(cache);
  persistPortfolio();
}
function clearPortfolio() {
  state.portfolio = [];
  state.data = {};
  saveCache({});
  persistPortfolio();
}
function persistPortfolio() {
  Storage.set(STORAGE_KEYS.portfolio, state.portfolio);
}

/* ---------------------------------------------------------
   CSV PARSER (semplice, per import portafoglio)
   --------------------------------------------------------- */
function parseCsv(text) {
  // Auto-detect separator
  const firstLine = text.split(/\r?\n/)[0] || '';
  let sep = ',';
  if (firstLine.includes('\t')) sep = '\t';
  else if (firstLine.includes(';') && firstLine.split(';').length > firstLine.split(',').length) sep = ';';

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detect header
  const firstCells = splitCsvLine(lines[0], sep).map(c => c.toLowerCase().trim());
  const tickerIdx = firstCells.findIndex(c => /^(ticker|symbol|simbolo)$/i.test(c));
  let startIdx = 0;
  let useIdx = 0;
  if (tickerIdx >= 0) {
    startIdx = 1;
    useIdx = tickerIdx;
  }

  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    const val = (cells[useIdx] || '').trim().toUpperCase();
    if (val) out.push(val);
  }
  return out;
}
function splitCsvLine(line, sep) {
  // gestione minimal di virgolette
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ---------------------------------------------------------
   RENDER: PORTAFOGLIO LIST
   --------------------------------------------------------- */
function renderPortfolio() {
  const ul = document.getElementById('portfolio-list');
  ul.innerHTML = '';
  for (const p of state.portfolio) {
    const li = document.createElement('li');
    li.className = 'portfolio-item';
    const entry = state.data[p.symbol];
    const name = entry?.profile?.companyName || '';
    const err = entry?.error;
    li.innerHTML = `
      <span class="ticker-symbol">${escapeHtml(p.symbol)}</span>
      <span class="ticker-name">${escapeHtml(name)}</span>
      ${err ? `<span class="ticker-error" title="${escapeHtml(err)}">⚠</span>` : ''}
      <button data-remove="${escapeHtml(p.symbol)}" aria-label="Rimuovi">×</button>
    `;
    ul.appendChild(li);
  }
  document.getElementById('portfolio-count').textContent =
    `${state.portfolio.length} ticker in portafoglio`;
}

/* ---------------------------------------------------------
   RENDER: FILTRO SETTORE (popolato dinamicamente)
   --------------------------------------------------------- */
function renderSectorFilter() {
  const sel = document.getElementById('filter-sector');
  const sectors = new Set();
  for (const sym of state.portfolio.map(p => p.symbol)) {
    const s = state.data[sym]?.profile?.sector;
    if (s) sectors.add(s);
  }
  const sorted = [...sectors].sort();
  const previouslySelected = new Set(state.filters.sectors);
  sel.innerHTML = '';
  for (const s of sorted) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (previouslySelected.has(s)) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ---------------------------------------------------------
   RENDER: ROUTER PRINCIPALE
   --------------------------------------------------------- */
function render() {
  renderPortfolio();
  renderSectorFilter();

  const hasPortfolio = state.portfolio.length > 0;
  const hasData = Object.keys(state.data).length > 0;
  const empty = document.getElementById('empty-state');
  const calView = document.getElementById('calendar-view');
  const listView = document.getElementById('list-view');

  if (!hasPortfolio || !hasData) {
    empty.classList.remove('hidden');
    calView.classList.add('hidden');
    listView.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  if (state.view === 'calendar') {
    calView.classList.remove('hidden');
    listView.classList.add('hidden');
    renderCalendar();
  } else {
    calView.classList.add('hidden');
    listView.classList.remove('hidden');
    renderList();
  }
}

/* ---------------------------------------------------------
   RENDER: CALENDARIO
   --------------------------------------------------------- */
function renderCalendar() {
  const events = applyFilters(buildEvents());
  const eventsByDate = {};
  for (const ev of events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  const { year, month } = state.calMonth;
  const title = document.getElementById('cal-title');
  title.textContent = `${MONTH_NAMES[month]} ${year}`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Intestazione giorni settimana
  for (const wd of WEEKDAY_SHORT) {
    const h = document.createElement('div');
    h.className = 'cal-weekday';
    h.textContent = wd;
    grid.appendChild(h);
  }

  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // lun=0
  const last = new Date(year, month + 1, 0);
  const daysInMonth = last.getDate();

  const today = ymd(new Date());

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = ymd(date);
    const dayEvents = eventsByDate[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (dayEvents.length > 0) cell.classList.add('has-events');
    if (dateStr === today) cell.classList.add('is-today');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = d;
    cell.appendChild(num);

    if (dayEvents.length > 0) {
      const badges = document.createElement('div');
      badges.className = 'cal-badges';
      const visible = dayEvents.slice(0, 3);
      for (const ev of visible) {
        const b = document.createElement('div');
        b.className = `cal-badge ${badgeClass(ev)}`;
        b.title = `${ev.symbol} - ${ev.companyName}`;
        b.textContent = ev.symbol;
        badges.appendChild(b);
      }
      if (dayEvents.length > 3) {
        const more = document.createElement('div');
        more.className = 'cal-badge more';
        more.textContent = `+${dayEvents.length - 3}`;
        badges.appendChild(more);
      }
      cell.appendChild(badges);

      cell.addEventListener('click', () => openDayModal(date, dayEvents));
    }

    grid.appendChild(cell);
  }

  // Riempi celle vuote per chiudere la riga
  const totalCells = startOffset + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day empty';
      grid.appendChild(empty);
    }
  }
}

function badgeClass(ev) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isPast = ev.dateObj < today;
  if (isPast && ev.epsSurprise != null) {
    return ev.epsSurprise >= 0 ? 'pos' : 'neg';
  }
  return ev.timeCode === 'unknown' ? '' : ev.timeCode;
}

/* ---------------------------------------------------------
   RENDER: LISTA / TIMELINE
   --------------------------------------------------------- */
function renderList() {
  const events = applyFilters(buildEvents());
  events.sort((a, b) => state.sortOrder === 'asc'
    ? a.dateObj - b.dateObj
    : b.dateObj - a.dateObj);

  const cont = document.getElementById('list-content');
  cont.innerHTML = '';

  document.getElementById('list-count').textContent =
    `${events.length} trimestrali ${state.sortOrder === 'asc' ? '(crescente)' : '(decrescente)'}`;

  if (events.length === 0) {
    cont.innerHTML = `<p class="muted">Nessuna trimestrale corrisponde ai filtri.</p>`;
    return;
  }

  // Raggruppamento per settimana
  const byWeek = new Map();
  for (const ev of events) {
    const ws = startOfWeek(ev.dateObj);
    const key = ymd(ws);
    if (!byWeek.has(key)) byWeek.set(key, { weekStart: ws, items: [] });
    byWeek.get(key).items.push(ev);
  }

  for (const [, group] of byWeek) {
    const section = document.createElement('div');
    section.className = 'week-section';

    const weekEnd = new Date(group.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const { week } = isoWeek(group.weekStart);

    const h3 = document.createElement('h3');
    h3.textContent = `Settimana ${week} · ${formatDateIT(group.weekStart)} – ${formatDateIT(weekEnd)}`;
    section.appendChild(h3);

    for (const ev of group.items) {
      section.appendChild(buildEarningsCard(ev));
    }

    cont.appendChild(section);
  }
}

function buildEarningsCard(ev) {
  const card = document.createElement('div');
  card.className = 'earnings-card';

  const timeTag = ev.timeCode === 'unknown'
    ? `<span class="tag unknown">orario n.d.</span>`
    : `<span class="tag ${ev.timeCode}">${ev.timeCode.toUpperCase()}</span>`;

  const epsLine = renderMetric('EPS', ev.eps, ev.epsEstimated, ev.epsSurprise, ev.currency);
  const revLine = renderMetric('Fatturato', ev.revenue, ev.revenueEstimated, ev.revenueSurprise, ev.currency, true);

  const sectorLine = ev.sector
    ? `${escapeHtml(ev.sector)}${ev.industry ? ` · ${escapeHtml(ev.industry)}` : ''}`
    : '<em>settore n.d.</em>';

  const safeIr = safeUrl(ev.website);
  const irLink = safeIr
    ? `<a href="${escapeHtml(safeIr)}" target="_blank" rel="noopener">IR ↗</a>`
    : '';

  const fiscal = ev.fiscalDateEnding ? `Fiscal: ${ev.fiscalDateEnding}` : '';

  // Storico ultime 4 trimestrali (prese da state.data)
  const history = (state.data[ev.symbol]?.earnings || [])
    .filter(e => e.date && parseYmd(e.date) <= new Date())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  const historyHtml = history.length === 0 ? '' : `
    <details>
      <summary>Storico ultime 4 trimestrali</summary>
      <div class="history-list">
        <table>
          <thead><tr><th>Data</th><th>EPS</th><th>Stim.</th><th>Surprise</th></tr></thead>
          <tbody>
            ${history.map(h => {
              const sa = surprisePct(num(h.eps), num(h.epsEstimated));
              const cls = sa == null ? '' : (sa >= 0 ? 'pos' : 'neg');
              return `<tr>
                <td>${escapeHtml(h.date)}</td>
                <td>${fmtNum(h.eps)}</td>
                <td>${fmtNum(h.epsEstimated)}</td>
                <td class="${cls}">${sa == null ? '—' : sa.toFixed(1) + '%'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </details>
  `;

  card.innerHTML = `
    <div class="ticker-block">
      <div class="symbol">${escapeHtml(ev.symbol)}</div>
      <div class="date">${formatDateIT(ev.dateObj)}</div>
      ${timeTag}
    </div>
    <div class="info-block">
      <div class="name">${escapeHtml(ev.companyName)}</div>
      <div class="meta">
        <span>${sectorLine}</span>
        ${ev.exchange ? `<span>${escapeHtml(ev.exchange)}</span>` : ''}
        ${ev.currency ? `<span>${escapeHtml(ev.currency)}</span>` : ''}
        ${fiscal ? `<span>${escapeHtml(fiscal)}</span>` : ''}
        ${irLink}
      </div>
      ${historyHtml}
    </div>
    <div class="metrics-block">
      ${epsLine}
      ${revLine}
    </div>
  `;
  return card;
}

function renderMetric(label, actual, est, surprise, currency, isLargeNumber = false) {
  const fmt = isLargeNumber ? fmtBig : fmtNum;
  if (actual == null && est == null) return '';
  const a = actual != null ? fmt(actual) : '—';
  const e = est != null ? fmt(est) : '—';
  let s = '';
  if (surprise != null) {
    const cls = surprise >= 0 ? 'pos' : 'neg';
    s = `<span class="metric-surprise ${cls}">${surprise >= 0 ? '+' : ''}${surprise.toFixed(1)}%</span>`;
  }
  return `
    <div class="metric-row">
      <span class="metric-label">${label}:</span>
      <span class="metric-value">${a}</span>
      <span class="metric-label">stim. ${e}</span>
      ${s}
    </div>
  `;
}

function fmtNum(v) {
  if (v == null || isNaN(+v)) return '—';
  return (+v).toFixed(2);
}
function fmtBig(v) {
  if (v == null || isNaN(+v)) return '—';
  v = +v;
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'k';
  return v.toFixed(0);
}

/* ---------------------------------------------------------
   MODAL DETTAGLIO GIORNO
   --------------------------------------------------------- */
function openDayModal(date, events) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  title.textContent = formatDateLongIT(date);
  body.innerHTML = '';
  for (const ev of events) {
    body.appendChild(buildEarningsCard(ev));
  }
  overlay.classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

/* ---------------------------------------------------------
   ICS EXPORT (RFC 5545)
   --------------------------------------------------------- */
function buildIcs(events) {
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Calendario Trimestrali//IT');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:Trimestrali Portafoglio');
  lines.push('X-WR-TIMEZONE:Europe/Rome');

  const dtstamp = icsUtcStamp(new Date());

  for (const ev of events) {
    if (!ev.dateObj) continue;
    const market = marketForSymbol(ev.symbol);
    let startTime, endTime;
    if (ev.timeCode === 'bmo') {
      startTime = market.bmo;
      endTime = addHourTo(market.bmo, 1);
    } else if (ev.timeCode === 'amc') {
      startTime = market.amc;
      endTime = addHourTo(market.amc, 1);
    } else {
      startTime = '12:00';
      endTime = '13:00';
    }

    const uid = `${ev.symbol}-${ev.date}-${ev.timeCode}@calendariotrimestrali`;
    const summary = `[${ev.symbol}] Trimestrale - ${ev.companyName}`;
    const descParts = [];
    if (ev.timeCode !== 'unknown') descParts.push(`Orario: ${ev.timeCode.toUpperCase()}`);
    if (ev.epsEstimated != null) descParts.push(`EPS stimato: ${ev.epsEstimated.toFixed(2)}`);
    if (ev.eps != null) descParts.push(`EPS riportato: ${ev.eps.toFixed(2)}`);
    if (ev.epsSurprise != null) descParts.push(`Surprise EPS: ${ev.epsSurprise >= 0 ? '+' : ''}${ev.epsSurprise.toFixed(1)}%`);
    if (ev.revenueEstimated != null) descParts.push(`Fatturato stimato: ${fmtBig(ev.revenueEstimated)}`);
    if (ev.revenue != null) descParts.push(`Fatturato riportato: ${fmtBig(ev.revenue)}`);
    if (ev.sector) descParts.push(`Settore: ${ev.sector}`);
    if (ev.exchange) descParts.push(`Mercato: ${ev.exchange}`);
    if (ev.fiscalDateEnding) descParts.push(`Fiscal: ${ev.fiscalDateEnding}`);
    const description = descParts.join('\\n');

    const tzid = market.tz;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    // TZID di IANA: i client moderni (Google/Outlook/Apple) lo riconoscono.
    lines.push(`DTSTART;TZID=${tzid}:${ev.date.replace(/-/g, '')}T${startTime.replace(':', '')}00`);
    lines.push(`DTEND;TZID=${tzid}:${ev.date.replace(/-/g, '')}T${endTime.replace(':', '')}00`);
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    const icsUrl = safeUrl(ev.website);
    if (icsUrl) lines.push(`URL:${icsEscape(icsUrl)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  // Folding linee oltre 75 ottetti (regola RFC 5545) — pratico, semplice
  const folded = lines.map(foldIcsLine).join('\r\n');
  return folded + '\r\n';
}
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
function icsUtcStamp(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function foldIcsLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}
function addHourTo(hhmm, hours) {
  const [h, m] = hhmm.split(':').map(Number);
  let nh = h + hours;
  if (nh >= 24) nh = 23;
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function marketForSymbol(symbol) {
  const idx = symbol.lastIndexOf('.');
  const suffix = idx >= 0 ? symbol.slice(idx + 1).toUpperCase() : '';
  return MARKET_BY_SUFFIX[suffix] || MARKET_BY_SUFFIX[''];
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------------------------------------------------------
   PRESET DATE
   --------------------------------------------------------- */
function applyPreset(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let from = null, to = null;
  if (preset === 'week') {
    from = startOfWeek(today);
    to = new Date(from); to.setDate(to.getDate() + 6);
  } else if (preset === '4weeks') {
    from = today;
    to = new Date(today); to.setDate(to.getDate() + 28);
  } else if (preset === 'quarter') {
    from = today;
    to = new Date(today); to.setMonth(to.getMonth() + 3);
  } else if (preset === 'all') {
    from = null; to = null;
  }
  state.filters.dateFrom = from;
  state.filters.dateTo = to;
  document.getElementById('date-from').value = from ? ymd(from) : '';
  document.getElementById('date-to').value = to ? ymd(to) : '';

  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.preset === preset));
  render();
}

/* ---------------------------------------------------------
   STATUS / LOADING
   --------------------------------------------------------- */
function showLoading(text) {
  const el = document.getElementById('loading');
  el.classList.remove('hidden');
  document.getElementById('loading-text').textContent = text || 'Caricamento…';
}
function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}
function setApiStatus(text, kind) {
  const el = document.getElementById('api-key-status');
  el.textContent = text || '';
  el.className = `status ${kind || ''}`;
}

/* ---------------------------------------------------------
   THEME
   --------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  Storage.set(STORAGE_KEYS.theme, theme);
}
function initTheme() {
  let saved = Storage.get(STORAGE_KEYS.theme);
  if (!saved) {
    saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(saved);
}

/* ---------------------------------------------------------
   ESCAPE HTML / URL
   --------------------------------------------------------- */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function safeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/* ---------------------------------------------------------
   INIT
   --------------------------------------------------------- */
function init() {
  // Carica stato persistito
  state.apiKey = Storage.get(STORAGE_KEYS.apiKey, '') || '';
  state.portfolio = Storage.get(STORAGE_KEYS.portfolio, []) || [];
  state.view = Storage.get(STORAGE_KEYS.view, 'calendar') || 'calendar';
  state.data = loadCache();

  // Mese corrente
  const now = new Date();
  state.calMonth = { year: now.getFullYear(), month: now.getMonth() };

  initTheme();

  // API key
  document.getElementById('api-key-input').value = state.apiKey;
  if (!state.apiKey && !Storage.get(STORAGE_KEYS.bannerSeen)) {
    document.getElementById('welcome-banner').classList.remove('hidden');
  }

  // View toggle
  setView(state.view);

  // Filtri default: prossime 4 settimane
  applyPreset('4weeks');

  bindEvents();
  render();
}

function setView(view) {
  state.view = view;
  Storage.set(STORAGE_KEYS.view, view);
  document.getElementById('view-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('view-list').classList.toggle('active', view === 'list');
  document.getElementById('view-calendar').setAttribute('aria-selected', view === 'calendar');
  document.getElementById('view-list').setAttribute('aria-selected', view === 'list');
}

function bindEvents() {
  // ---- HEADER ----
  document.getElementById('view-calendar').addEventListener('click', () => { setView('calendar'); render(); });
  document.getElementById('view-list').addEventListener('click', () => { setView('list'); render(); });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });

  // ---- BANNER ----
  document.querySelector('#welcome-banner .banner-close').addEventListener('click', () => {
    document.getElementById('welcome-banner').classList.add('hidden');
    Storage.set(STORAGE_KEYS.bannerSeen, true);
  });

  // ---- API KEY ----
  document.getElementById('api-key-save').addEventListener('click', () => {
    const v = document.getElementById('api-key-input').value.trim();
    if (!v) { setApiStatus('Inserisci una API key', 'err'); return; }
    state.apiKey = v;
    Storage.set(STORAGE_KEYS.apiKey, v);
    setApiStatus('API key salvata. Clicca "Verifica" per testarla.', 'ok');
  });
  document.getElementById('api-key-test').addEventListener('click', async () => {
    const v = document.getElementById('api-key-input').value.trim() || state.apiKey;
    if (!v) { setApiStatus('Nessuna API key inserita', 'err'); return; }
    setApiStatus('Verifica in corso…', '');
    try {
      const ok = await validateApiKey(v);
      if (ok) {
        state.apiKey = v;
        Storage.set(STORAGE_KEYS.apiKey, v);
        setApiStatus('✓ API key valida', 'ok');
      } else {
        setApiStatus('✗ Risposta inattesa', 'err');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Errore');
      setApiStatus(`✗ ${msg}`, err.kind === 'quota' ? 'warn' : 'err');
    }
  });
  document.getElementById('api-key-clear').addEventListener('click', () => {
    state.apiKey = '';
    Storage.remove(STORAGE_KEYS.apiKey);
    document.getElementById('api-key-input').value = '';
    setApiStatus('API key cancellata', '');
  });

  // ---- TABS ----
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.dataset.pane === tab);
      });
    });
  });

  // ---- PORTAFOGLIO ----
  document.getElementById('add-tickers').addEventListener('click', () => {
    const ta = document.getElementById('ticker-input');
    const symbols = parseTickerInput(ta.value);
    if (symbols.length === 0) return;
    const added = addTickers(symbols);
    ta.value = '';
    renderPortfolio();
    if (added > 0 && state.apiKey) {
      refreshData().catch(handleError);
    }
  });

  document.getElementById('csv-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const symbols = parseCsv(text);
      if (symbols.length === 0) {
        alert('Nessun ticker trovato nel CSV');
        return;
      }
      const added = addTickers(symbols);
      e.target.value = '';
      renderPortfolio();
      alert(`Aggiunti ${added} ticker su ${symbols.length} letti dal CSV.`);
      if (added > 0 && state.apiKey) refreshData().catch(handleError);
    } catch (err) {
      alert('Errore lettura CSV: ' + err.message);
    }
  });

  document.getElementById('portfolio-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove]');
    if (!btn) return;
    removeTicker(btn.dataset.remove);
    render();
  });

  document.getElementById('clear-portfolio').addEventListener('click', () => {
    if (!confirm('Svuotare il portafoglio?')) return;
    clearPortfolio();
    render();
  });

  document.getElementById('export-portfolio-csv').addEventListener('click', () => {
    if (state.portfolio.length === 0) { alert('Portafoglio vuoto'); return; }
    const lines = ['ticker'];
    for (const p of state.portfolio) lines.push(p.symbol);
    downloadFile('portafoglio.csv', lines.join('\n'), 'text/csv');
  });

  document.getElementById('refresh-data').addEventListener('click', () => {
    if (!state.apiKey) { setApiStatus('Inserisci prima la API key', 'err'); return; }
    if (state.portfolio.length === 0) { alert('Aggiungi almeno un ticker'); return; }
    refreshData({ force: true }).catch(handleError);
  });

  // ---- FILTRI ----
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => applyPreset(chip.dataset.preset));
  });
  document.getElementById('date-from').addEventListener('change', (e) => {
    state.filters.dateFrom = e.target.value ? parseYmd(e.target.value) : null;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    render();
  });
  document.getElementById('date-to').addEventListener('change', (e) => {
    state.filters.dateTo = e.target.value ? parseYmd(e.target.value) : null;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    render();
  });
  document.getElementById('filter-time').addEventListener('change', (e) => {
    state.filters.time = e.target.value;
    render();
  });
  document.getElementById('filter-sector').addEventListener('change', (e) => {
    state.filters.sectors = Array.from(e.target.selectedOptions).map(o => o.value);
    render();
  });
  document.getElementById('filter-search').addEventListener('input', (e) => {
    state.filters.search = e.target.value.trim();
    render();
  });
  document.getElementById('reset-filters').addEventListener('click', () => {
    state.filters = { dateFrom: null, dateTo: null, time: 'all', sectors: [], search: '' };
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    document.getElementById('filter-time').value = 'all';
    document.getElementById('filter-search').value = '';
    document.querySelectorAll('#filter-sector option').forEach(o => o.selected = false);
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    render();
  });

  // ---- CALENDARIO NAV ----
  document.getElementById('cal-prev').addEventListener('click', () => {
    let { year, month } = state.calMonth;
    month--;
    if (month < 0) { month = 11; year--; }
    state.calMonth = { year, month };
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    let { year, month } = state.calMonth;
    month++;
    if (month > 11) { month = 0; year++; }
    state.calMonth = { year, month };
    renderCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    const now = new Date();
    state.calMonth = { year: now.getFullYear(), month: now.getMonth() };
    renderCalendar();
  });

  // ---- LISTA SORT ----
  document.getElementById('sort-order').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    renderList();
  });

  // ---- MODAL ----
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ---- EXPORT ICS ----
  document.getElementById('export-ics-filtered').addEventListener('click', () => {
    const events = applyFilters(buildEvents());
    if (events.length === 0) { alert('Nessuna trimestrale da esportare con i filtri attuali'); return; }
    const ics = buildIcs(events);
    downloadFile(`trimestrali-filtrate-${ymd(new Date())}.ics`, ics, 'text/calendar');
  });
  document.getElementById('export-ics-all').addEventListener('click', () => {
    const events = buildEvents();
    if (events.length === 0) { alert('Nessuna trimestrale da esportare'); return; }
    const ics = buildIcs(events);
    downloadFile(`trimestrali-portafoglio-${ymd(new Date())}.ics`, ics, 'text/calendar');
  });
}

async function refreshData(opts = {}) {
  try {
    await fetchPortfolioData(opts);
    render();
  } catch (err) {
    handleError(err);
    render(); // mostra ciò che abbiamo caricato
  }
}

function handleError(err) {
  hideLoading();
  if (err instanceof ApiError) {
    if (err.kind === 'auth') {
      setApiStatus('✗ ' + err.message, 'err');
      alert('Errore API key: ' + err.message + '\n\nVerifica la chiave e riprova.');
      return;
    }
    if (err.kind === 'quota') {
      setApiStatus('⚠ ' + err.message, 'warn');
      alert('Quota API esaurita. Riprova più tardi o passa a un piano superiore.');
      return;
    }
    alert('Errore: ' + err.message);
  } else {
    if (!navigator.onLine) {
      alert('Connessione assente. Sei offline?');
    } else {
      alert('Errore imprevisto: ' + (err?.message || 'sconosciuto'));
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
