/* ═══════════════════════════════════════════════════════════════
   VDO.AI Dynamic Floors Engine — app.js
   ═══════════════════════════════════════════════════════════════ */

'use strict';

let DATA       = null;
let chartRev   = null;
let chartMR    = null;
let chartImps  = null;

/* ─── Utility ──────────────────────────────────────────────────────── */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function setStatus(text, color) {
  document.getElementById('statusText').textContent = text;
  const dot = document.querySelector('.status-dot');
  dot.style.background = color || 'var(--green)';
  dot.style.boxShadow  = `0 0 8px ${color || 'var(--green)'}`;
}

function dlFile(content, filename, type) {
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmt$(n)   { return '$' + Number(n).toFixed(2); }
function fmtPct(n) { return (n > 0 ? '+' : '') + n + '%'; }
function fmtK(n)   { return n >= 1000 ? (n/1000).toFixed(1) + 'K' : String(n); }

/* ─── Drop-zone wiring ─────────────────────────────────────────────── */
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

/* ─── File handler ─────────────────────────────────────────────────── */
function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    toast('⚠  Please upload a CSV file');
    return;
  }
  setStatus('Analysing…', '#3B82F6');

  const fd = new FormData();
  fd.append('file', file);

  fetch('/api/analyse', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      DATA = data;
      setStatus('Live', 'var(--green)');
      renderDash();
      toast('✓  Analysis complete — ' + data.summary.total_segments + ' segments');
    })
    .catch(err => {
      setStatus('Error', 'var(--red)');
      toast('✗  ' + err.message);
      console.error(err);
    });
}

/* ─── Reset ────────────────────────────────────────────────────────── */
function resetApp() {
  DATA = null;
  document.getElementById('dash').style.display = 'none';
  document.getElementById('uploadView').style.display = 'flex';
  document.getElementById('resetBtn').style.display = 'none';
  document.getElementById('fileInput').value = '';
  setStatus('Ready', 'var(--green)');
  if (chartRev)  { chartRev.destroy();  chartRev  = null; }
  if (chartMR)   { chartMR.destroy();   chartMR   = null; }
  if (chartImps) { chartImps.destroy(); chartImps = null; }
}

/* ─── Tab switching ─────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'curves') setTimeout(renderCurves, 60);
}

/* ─── Render dashboard ──────────────────────────────────────────────── */
function renderDash() {
  document.getElementById('uploadView').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
  document.getElementById('resetBtn').style.display = 'flex';
  document.getElementById('recCount').textContent = DATA.recommendations.length;

  renderKPIs();
  renderDirChart();
  renderRiskChart();
  renderTop5();
  populateFilters();
  renderRecs();
  renderUPR();
  populateCurveSelect();
}

/* ─── KPIs ──────────────────────────────────────────────────────────── */
function renderKPIs() {
  const s    = DATA.summary;
  const lift = s.avg_lift;
  const liftColor = lift > 0 ? 'green' : lift < 0 ? 'red' : 'blue';

  const cards = [
    { label: 'Total Revenue',    val: '$' + s.total_revenue.toLocaleString(), sub: '30-day period',       color: 'green', glow: '#00FF94' },
    { label: 'Total Impressions',val: fmtK(s.total_impressions),              sub: 'matched ad exchanges', color: 'blue',  glow: '#3B82F6' },
    { label: 'Segments Analysed',val: s.total_segments,                       sub: s.unique_ad_units + ' unique ad units', color: '', glow: '#888' },
    { label: 'Avg Expected Lift',val: fmtPct(lift),                           sub: 'vs current floors',   color: liftColor, glow: lift > 0 ? '#00FF94' : lift < 0 ? '#EF4444' : '#3B82F6' },
    { label: 'google_mcm',       val: s.ssp_breakdown.google_mcm || 0,        sub: 'segments',            color: 'blue',  glow: '#3B82F6' },
    { label: 'google_mcm_apac',  val: s.ssp_breakdown.google_mcm_apac || 0,   sub: 'segments',            color: 'blue',  glow: '#3B82F6' },
  ];

  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-val ${c.color}">${c.val}</div>
      <div class="kpi-sub">${c.sub}</div>
      <div class="kpi-glow" style="background:radial-gradient(circle,${c.glow},transparent)"></div>
    </div>
  `).join('');
}

/* ─── Direction bar chart ────────────────────────────────────────────── */
function renderDirChart() {
  const s   = DATA.summary;
  const tot = s.total_segments;
  const rows = [
    { label: 'Increase', val: s.increase_count, color: '#00FF94' },
    { label: 'Maintain', val: s.maintain_count, color: '#3B82F6' },
    { label: 'Decrease', val: s.decrease_count, color: '#EF4444' },
  ];
  document.getElementById('dirChart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${tot ? Math.round(r.val/tot*100) : 0}%;background:${r.color}"></div>
      </div>
      <div class="bar-val">${r.val}</div>
    </div>
  `).join('');
}

/* ─── Risk bar chart ─────────────────────────────────────────────────── */
function renderRiskChart() {
  const rb  = DATA.summary.risk_breakdown;
  const max = Math.max(rb.High || 0, rb.Medium || 0, rb.Low || 0) || 1;
  const rows = [
    { label: 'High',   val: rb.High   || 0, color: '#EF4444' },
    { label: 'Medium', val: rb.Medium || 0, color: '#F59E0B' },
    { label: 'Low',    val: rb.Low    || 0, color: '#00FF94' },
  ];
  document.getElementById('riskChart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.round(r.val/max*100)}%;background:${r.color}"></div>
      </div>
      <div class="bar-val">${r.val}</div>
    </div>
  `).join('');
}

/* ─── Top-5 table ────────────────────────────────────────────────────── */
function renderTop5() {
  const top = DATA.recommendations.slice(0, 5);
  document.getElementById('top5Table').innerHTML = `
    <thead><tr>
      <th>Ad Unit</th><th>Country</th><th>Device</th>
      <th>Soft Floor</th><th>Exp. Lift</th><th>Direction</th><th>Risk</th>
    </tr></thead>
    <tbody>${top.map(r => `<tr>
      <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${r.ad_unit}">${r.ad_unit}</td>
      <td>${r.country}</td>
      <td>${r.device}</td>
      <td class="mono" style="color:var(--green)">${fmt$(r.soft_floor)}</td>
      <td class="${r.expected_lift_pct > 0 ? 'lift-pos' : r.expected_lift_pct < 0 ? 'lift-neg' : 'lift-neu'} mono">${fmtPct(r.expected_lift_pct)}</td>
      <td>${dirBadge(r.direction)}</td>
      <td>${riskBadge(r.risk_level)}</td>
    </tr>`).join('')}</tbody>`;
}

/* ─── Filters ────────────────────────────────────────────────────────── */
function populateFilters() {
  const recs    = DATA.recommendations;
  const devices = [...new Set(recs.map(r => r.device))].sort();
  const countries = [...new Set(recs.map(r => r.country))].sort();

  const fDev = document.getElementById('fDevice');
  fDev.innerHTML = '<option value="">All devices</option>' +
    devices.map(d => `<option value="${d}">${d}</option>`).join('');

  const fCnt = document.getElementById('fCountry');
  fCnt.innerHTML = '<option value="">All countries</option>' +
    countries.map(c => `<option value="${c}">${c}</option>`).join('');
}

/* ─── Recommendations table ──────────────────────────────────────────── */
function renderRecs() {
  const dir     = document.getElementById('fDir').value;
  const risk    = document.getElementById('fRisk').value;
  const ssp     = document.getElementById('fSSP').value;
  const device  = document.getElementById('fDevice').value;
  const country = document.getElementById('fCountry').value;

  const filtered = DATA.recommendations.filter(r =>
    (!dir     || r.direction  === dir)     &&
    (!risk    || r.risk_level === risk)    &&
    (!ssp     || r.ssp        === ssp)     &&
    (!device  || r.device     === device)  &&
    (!country || r.country    === country)
  );

  document.getElementById('recBody').innerHTML = filtered.map(r => `<tr>
    <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${r.ad_unit}">${r.ad_unit}</td>
    <td>${r.country}</td>
    <td>${r.device}</td>
    <td><span class="ssp-tag">${r.ssp}</span></td>
    <td class="mono">${fmt$(r.current_floor)}</td>
    <td class="mono" style="color:var(--green);font-weight:600">${fmt$(r.soft_floor)}</td>
    <td class="mono" style="color:var(--text3)">${fmt$(r.hard_floor)}</td>
    <td class="mono">${fmt$(r.mean_ecpm)}</td>
    <td class="mono">${fmtK(r.total_impressions)}</td>
    <td class="mono ${r.expected_lift_pct > 0 ? 'lift-pos' : r.expected_lift_pct < 0 ? 'lift-neg' : 'lift-neu'}">${fmtPct(r.expected_lift_pct)}</td>
    <td>${riskBadge(r.risk_level)}</td>
    <td>${dirBadge(r.direction)}</td>
  </tr>`).join('');

  document.getElementById('recFooter').textContent =
    `Showing ${filtered.length} of ${DATA.recommendations.length} segments`;
}

/* ─── UPR table ──────────────────────────────────────────────────────── */
function renderUPR() {
  // Exclude last row (totals) by checking if ad_unit looks like a summary
  const recs = DATA.recommendations.filter(r => r.ad_unit && r.ad_unit.trim() !== '');
  document.getElementById('uprBody').innerHTML = recs.map(r => `<tr>
    <td>${r.country}</td>
    <td>${r.device}</td>
    <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${r.ad_unit}">${r.ad_unit}</td>
    <td>${r.os || 'all'}</td>
    <td>${r.browser || 'all'}</td>
    <td><span class="ssp-tag">${r.ssp}</span></td>
    <td class="mono" style="color:var(--green);font-weight:600">${r.soft_floor.toFixed(2)}</td>
    <td class="mono" style="color:var(--text3)">${r.hard_floor.toFixed(2)}</td>
    <td>${dirBadge(r.direction)}</td>
  </tr>`).join('');
}

/* ─── UPR Downloads ──────────────────────────────────────────────────── */
function buildUPRcsv(useHard) {
  const header = 'country,device,ad unit,os,browser,ssp,floor';
  const rows = DATA.recommendations
    .filter(r => r.ad_unit && r.ad_unit.trim() !== '')
    .map(r => [
      r.country,
      r.device,
      r.ad_unit,
      r.os      || 'all',
      r.browser || 'all',
      r.ssp,
      useHard ? r.hard_floor.toFixed(2) : r.soft_floor.toFixed(2),
    ].join(','));
  return [header, ...rows].join('\n');
}

function downloadUPRSoft() {
  dlFile(buildUPRcsv(false), 'upr_soft_floors.csv', 'text/csv');
  toast('✓  Soft floors UPR downloaded');
}

function downloadUPRHard() {
  dlFile(buildUPRcsv(true), 'upr_hard_floors.csv', 'text/csv');
  toast('✓  Hard floors UPR downloaded');
}

/* ─── Recommendations CSV download ────────────────────────────────────── */
function downloadRecs() {
  const dir     = document.getElementById('fDir').value;
  const risk    = document.getElementById('fRisk').value;
  const ssp     = document.getElementById('fSSP').value;
  const device  = document.getElementById('fDevice').value;
  const country = document.getElementById('fCountry').value;

  const filtered = DATA.recommendations.filter(r =>
    (!dir     || r.direction  === dir)     &&
    (!risk    || r.risk_level === risk)    &&
    (!ssp     || r.ssp        === ssp)     &&
    (!device  || r.device     === device)  &&
    (!country || r.country    === country)
  );

  const header = 'ad_unit,country,device,ssp,os,browser,current_floor,soft_floor,hard_floor,mean_ecpm,total_impressions,total_revenue,expected_lift_pct,risk_level,direction';
  const rows = filtered.map(r =>
    [r.ad_unit, r.country, r.device, r.ssp, r.os || 'all', r.browser || 'all',
     r.current_floor, r.soft_floor, r.hard_floor, r.mean_ecpm,
     r.total_impressions, r.total_revenue, r.expected_lift_pct,
     r.risk_level, r.direction].join(',')
  );
  dlFile([header, ...rows].join('\n'), 'floor_recommendations.csv', 'text/csv');
  toast('✓  Recommendations exported');
}

/* ─── Revenue Curves ─────────────────────────────────────────────────── */
function populateCurveSelect() {
  const keys = Object.keys(DATA.curves || {});
  const sel  = document.getElementById('curveSeg');
  sel.innerHTML = keys.map(k => {
    const label = k.replace(/\|\|/g, ' · ');
    return `<option value="${k}">${label}</option>`;
  }).join('');
  if (keys.length) renderCurves();
}

function renderCurves() {
  const key   = document.getElementById('curveSeg').value;
  if (!key || !DATA.curves || !DATA.curves[key]) return;

  const curve = DATA.curves[key];
  const rec   = DATA.recommendations.find(r => {
    const k = `${r.ad_unit}||${r.country}||${r.device}||${r.ssp}||${r.os || 'all'}||${r.browser || 'all'}`;
    return k === key;
  });

  const labels   = curve.map(c => '$' + c.floor.toFixed(2));
  const revData  = curve.map(c => c.revenue);
  const mrData   = curve.map(c => c.match_rate);
  const impData  = curve.map(c => c.impressions);

  const sfLabel  = rec ? '$' + rec.soft_floor.toFixed(2) : null;
  const hfLabel  = rec ? '$' + rec.hard_floor.toFixed(2) : null;
  const sfIdx    = sfLabel ? labels.indexOf(sfLabel) : -1;

  const greenHi  = 'rgba(0,255,148,0.9)';
  const greenLo  = 'rgba(0,255,148,0.25)';
  const blueHi   = 'rgba(59,130,246,0.9)';
  const blueLo   = 'rgba(59,130,246,0.25)';
  const amberHi  = 'rgba(245,158,11,0.9)';
  const amberLo  = 'rgba(245,158,11,0.25)';

  const bgRev  = labels.map((_, i) => i === sfIdx ? greenHi : greenLo);
  const bgMR   = labels.map((_, i) => i === sfIdx ? blueHi  : blueLo);
  const bgImps = labels.map((_, i) => i === sfIdx ? amberHi : amberLo);

  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index' } },
    scales: {
      x: { ticks: { color: '#4A5568', font: { size: 10, family: "'JetBrains Mono'" }, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#4A5568', font: { size: 10, family: "'JetBrains Mono'" } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    },
  };

  if (chartRev)  { chartRev.destroy();  chartRev  = null; }
  if (chartMR)   { chartMR.destroy();   chartMR   = null; }
  if (chartImps) { chartImps.destroy(); chartImps = null; }

  chartRev = new Chart(document.getElementById('cRev'), {
    type: 'bar',
    data: { labels, datasets: [{ data: revData, backgroundColor: bgRev, borderRadius: 4, borderSkipped: false }] },
    options: {
      ...baseOpts,
      scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, ticks: { ...baseOpts.scales.y.ticks, callback: v => '$' + v.toFixed(2) } } },
    },
  });

  chartMR = new Chart(document.getElementById('cMR'), {
    type: 'bar',
    data: { labels, datasets: [{ data: mrData, backgroundColor: bgMR, borderRadius: 4, borderSkipped: false }] },
    options: {
      ...baseOpts,
      scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, ticks: { ...baseOpts.scales.y.ticks, callback: v => v + '%' } } },
    },
  });

  chartImps = new Chart(document.getElementById('cImps'), {
    type: 'bar',
    data: { labels, datasets: [{ data: impData, backgroundColor: bgImps, borderRadius: 4, borderSkipped: false }] },
    options: baseOpts,
  });

  // Segment info panel
  if (rec) {
    document.getElementById('segInfo').innerHTML = [
      { label: 'Current Floor', val: fmt$(rec.current_floor), color: 'var(--text)' },
      { label: 'Soft Floor',    val: fmt$(rec.soft_floor),    color: 'var(--green)' },
      { label: 'Hard Floor',    val: fmt$(rec.hard_floor),    color: '#F59E0B' },
      { label: 'Mean eCPM',     val: fmt$(rec.mean_ecpm),     color: 'var(--text)' },
      { label: 'Impressions',   val: fmtK(rec.total_impressions), color: '#3B82F6' },
      { label: 'Revenue',       val: fmt$(rec.total_revenue), color: 'var(--text)' },
      { label: 'Exp. Lift',     val: fmtPct(rec.expected_lift_pct), color: rec.expected_lift_pct > 0 ? 'var(--green)' : rec.expected_lift_pct < 0 ? 'var(--red)' : 'var(--text3)' },
      { label: 'Risk',          val: rec.risk_level,          color: rec.risk_level === 'High' ? 'var(--red)' : rec.risk_level === 'Medium' ? '#F59E0B' : 'var(--green)' },
    ].map(s => `
      <div class="seg-stat">
        <div class="seg-stat-label">${s.label}</div>
        <div class="seg-stat-val" style="color:${s.color}">${s.val}</div>
      </div>
    `).join('');
  }
}

/* ─── Badge helpers ──────────────────────────────────────────────────── */
function dirBadge(d) {
  const icon = d === 'increase' ? '↑' : d === 'decrease' ? '↓' : '→';
  return `<span class="dir-badge dir-${d}">${icon} ${d}</span>`;
}

function riskBadge(r) {
  return `<span class="risk-badge risk-${r}">${r}</span>`;
}
