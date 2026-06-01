const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyse', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = req.file.buffer.toString('utf8');
    const result = analyseCSV(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function parseLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

function extractFloor(s) {
  s = String(s || '');
  if (/no pricing rule|google opt/i.test(s) || !s.trim()) return 0;
  const m = s.match(/\$?([\d]+\.?[\d]*)/);
  return m ? parseFloat(m[1]) : 0;
}

function cleanAdUnit(s) {
  const parts = String(s).split('»');
  return parts[parts.length - 1].trim().replace(/\(\d+\)/g, '').trim();
}

function getSSP(raw) {
  return (raw.includes('ellipsis_dfp') && raw.includes('_pre_'))
    ? 'google_mcm_apac' : 'google_mcm';
}

function analyseCSV(text) {
  const lines = text.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('ad unit') && l.includes('impressions')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('Cannot find header row with "Ad unit" and "Impressions"');

  const headers = parseLine(lines[headerIdx]).map(h => h.toLowerCase());

  const col = (aliases) => {
    for (const a of aliases) {
      const idx = headers.findIndex(h => h.includes(a));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const iAU      = col(['ad unit']);
  const iPrice   = col(['pricing rule']);
  const iImps    = col(['ad exchange impressions', 'matched impressions', 'impressions']);
  const iRev     = col(['revenue']);
  const iEcpm    = col(['ecpm', 'average ecpm']);
  const iReq     = col(['ad requests', 'requests']);
  const iMR      = col(['match rate', 'fill rate']);
  const iCountry = col(['country']);
  const iDevice  = col(['device category', 'device']);
  const iOS      = col(['operating system', 'os']);
  const iBrowser = col(['browser']);

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseLine(lines[i]);
    if (v.length < 5) continue;
    const rawUnit = v[iAU] || '';
    const unit    = cleanAdUnit(rawUnit);
    if (!unit) continue;
    rows.push({
      raw_unit : rawUnit,
      ad_unit  : unit,
      ssp      : getSSP(rawUnit),
      floor    : extractFloor(v[iPrice] || ''),
      impressions : parseFloat((v[iImps] || '0').replace(/[$,%]/g,'')) || 0,
      revenue     : parseFloat((v[iRev]  || '0').replace(/[$,%]/g,'')) || 0,
      ecpm        : parseFloat((v[iEcpm] || '0').replace(/[$,%]/g,'')) || 0,
      match_rate  : parseFloat((v[iMR]   || '0').replace(/[$,%]/g,'')) || 0,
      country     : v[iCountry] || 'Unknown',
      device      : v[iDevice]  || 'Unknown',
      os          : iOS      >= 0 ? (v[iOS]      || 'all') : 'all',
      browser     : iBrowser >= 0 ? (v[iBrowser]  || 'all') : 'all',
    });
  }

  return runModel(rows);
}

function runModel(rows) {
  const groups = {};
  rows.forEach(r => {
    const k = `${r.ad_unit}||${r.country}||${r.device}||${r.ssp}||${r.os}||${r.browser}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const recs = []; const curves = {};
  let totalImps = 0, totalRev = 0;

  Object.entries(groups).forEach(([key, grp]) => {
    const ti = grp.reduce((a,r) => a + r.impressions, 0);
    const tr = grp.reduce((a,r) => a + r.revenue, 0);
    totalImps += ti; totalRev += tr;
    if (ti < 30) return;

    const fm = {};
    grp.forEach(r => {
      if (!fm[r.floor]) fm[r.floor] = { imps:0, rev:0, mrS:0, mrN:0 };
      fm[r.floor].imps += r.impressions;
      fm[r.floor].rev  += r.revenue;
      if (r.match_rate > 0) { fm[r.floor].mrS += r.match_rate; fm[r.floor].mrN++; }
    });
    const curve = Object.keys(fm).map(f => ({
      floor       : parseFloat(f),
      revenue     : Math.round(fm[f].rev  * 100) / 100,
      impressions : Math.round(fm[f].imps),
      match_rate  : fm[f].mrN > 0 ? Math.round(fm[f].mrS / fm[f].mrN * 100) / 100 : 0,
    })).sort((a,b) => a.floor - b.floor);
    curves[key] = curve;

    const n  = curve.length;
    const nz = grp.filter(r => r.floor > 0);
    let curFloor = 0;
    if (nz.length) {
      const fm2 = {};
      nz.forEach(r => { fm2[r.floor] = (fm2[r.floor]||0) + r.impressions; });
      curFloor = parseFloat(Object.keys(fm2).reduce((a,b) => fm2[a]>fm2[b]?a:b));
    }

    const me = ti > 0 ? tr / ti * 1000 : 0;

    // Hard floor: last floor before ≥20% match-rate drop
    let hf = null;
    if (n >= 2) {
      const base = curve[0].match_rate;
      if (base > 0) {
        for (let i = 0; i < curve.length; i++) {
          if ((base - curve[i].match_rate) / base >= 0.20) break;
          hf = curve[i].floor;
        }
      }
    }

    // Soft floor: max revenue candidate ≤ hard floor
    let sf;
    if (n >= 2) {
      const cands = hf ? curve.filter(c => c.floor <= hf) : curve;
      sf = (cands.length ? cands : curve).reduce((a,b) => b.revenue > a.revenue ? b : a).floor;
    } else {
      if (!curFloor) sf = parseFloat((me * 0.70).toFixed(2));
      else {
        const ratio = me / curFloor;
        if (ratio >= 1.5)      sf = parseFloat((curFloor * 1.10).toFixed(2));
        else if (ratio >= 1.2) sf = parseFloat((curFloor * 1.05).toFixed(2));
        else if (ratio < 0.8)  sf = parseFloat((curFloor * 0.90).toFixed(2));
        else                   sf = curFloor;
      }
    }
    if (curFloor > 0) {
      sf = Math.max(curFloor * 0.5, Math.min(curFloor * 1.5, sf));
      if (Math.abs(sf - curFloor) / curFloor <= 0.05) sf = curFloor;
    }
    sf = Math.round(sf * 100) / 100;
    if (!hf) hf = Math.round(sf * 1.20 * 100) / 100;

    // Risk
    let s = 0;
    if (ti < 200) s += 2; else if (ti < 1000) s += 1;
    const vol = me > 0 ? grp.reduce((a,r) => a + Math.pow(r.ecpm - me/1000, 2), 0) / grp.length : 0;
    const volN = me > 0 ? Math.sqrt(vol) / (me/1000) : 0;
    if (volN > 0.4) s += 2; else if (volN > 0.2) s += 1;
    if (n < 3) s += 1;
    const rk = s <= 1 ? 'Low' : s <= 3 ? 'Medium' : 'High';

    const curRec = curve.find(c => c.floor === curFloor);
    const sfRec  = curve.find(c => c.floor === sf);
    const curRev = curRec ? curRec.revenue : tr;
    const sfRev  = sfRec  ? sfRec.revenue  : curRev;
    const lift   = curRev > 0 ? Math.round((sfRev - curRev) / curRev * 10000) / 100 : 0;
    const dir    = sf > curFloor ? 'increase' : sf < curFloor ? 'decrease' : 'maintain';

    const parts    = key.split('||');
    const sampleR  = grp[0];

    recs.push({
      ad_unit          : parts[0],
      country          : parts[1],
      device           : parts[2],
      ssp              : parts[3],
      os               : parts[4],
      browser          : parts[5],
      current_floor    : curFloor,
      soft_floor       : sf,
      hard_floor       : Math.round(hf * 100) / 100,
      mean_ecpm        : Math.round(me * 100) / 100,
      total_impressions: Math.round(ti),
      total_revenue    : Math.round(tr * 100) / 100,
      expected_lift_pct: lift,
      risk_level       : rk,
      n_floor_obs      : n,
      direction        : dir,
    });
  });

  recs.sort((a,b) => b.expected_lift_pct - a.expected_lift_pct);

  const summary = {
    total_revenue    : Math.round(totalRev * 100) / 100,
    total_impressions: Math.round(totalImps),
    total_segments   : recs.length,
    increase_count   : recs.filter(r => r.direction === 'increase').length,
    decrease_count   : recs.filter(r => r.direction === 'decrease').length,
    maintain_count   : recs.filter(r => r.direction === 'maintain').length,
    avg_lift         : recs.length ? Math.round(recs.reduce((a,r) => a + r.expected_lift_pct, 0) / recs.length * 100) / 100 : 0,
    risk_breakdown   : {
      High  : recs.filter(r => r.risk_level === 'High').length,
      Medium: recs.filter(r => r.risk_level === 'Medium').length,
      Low   : recs.filter(r => r.risk_level === 'Low').length,
    },
    unique_ad_units  : [...new Set(recs.map(r => r.ad_unit))].length,
    ssp_breakdown    : {
      google_mcm     : recs.filter(r => r.ssp === 'google_mcm').length,
      google_mcm_apac: recs.filter(r => r.ssp === 'google_mcm_apac').length,
    },
  };

  return { summary, recommendations: recs, curves };
}

app.listen(PORT, () => {
  console.log(`\n🚀  VDO.AI Dynamic Floors Engine running at http://localhost:${PORT}\n`);
});
