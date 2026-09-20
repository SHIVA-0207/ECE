/* ==========================================================================
   AI Dataset Binary Encoder — Application Logic
   No backend. Everything runs in the browser.
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   Global state
--------------------------------------------------------------------- */
const state = {
  headers: [],
  rows: [],          // array of row objects {field: value}
  fieldTypes: {},     // field -> 'numeric' | 'categorical'
  fileName: null,
  selectedFields: [],
  results: [],        // encoded output rows: {field, original, processed, binary, status, note}
  runHistory: [],      // [{time, count}] for the history chart
  currentPage: 1,
  pageSize: 8,
  charts: {}
};

const SCHEME_EXPLANATIONS = {
  binary: 'Treats the value as already 0/1-like data (e.g. yes/no, true/false) and passes it straight through as a single bit, validating it is exactly 0 or 1.',
  numeric: 'Converts a decimal number into its binary form using repeated division by 2, padded to the selected bit length.',
  categorical: 'Assigns each unique category a number based on first appearance, then converts that number into binary — e.g. Male → 0, Female → 1.',
  onehot: 'Gives every unique category its own bit position. Only one bit is "1" per value — e.g. with 3 categories, the 2nd category becomes 010.'
};

/* ---------------------------------------------------------------------
   Utility: toasts
--------------------------------------------------------------------- */
function toast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function showLoading(text = 'Processing…') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').hidden = false;
}
function hideLoading() {
  document.getElementById('loadingOverlay').hidden = true;
}

/* ---------------------------------------------------------------------
   Navigation
--------------------------------------------------------------------- */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (link) link.classList.add('active');
  document.getElementById('mainNav').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(link.dataset.page);
  });
});
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('mainNav').classList.toggle('open');
});

/* ---------------------------------------------------------------------
   CSV parsing (handles simple quoted fields + missing values)
--------------------------------------------------------------------- */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('The file is empty.');

  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] === undefined || cells[i] === '') ? null : cells[i]; });
    return row;
  });

  return { headers, rows };
}

function detectFieldType(field) {
  const values = state.rows.map(r => r[field]).filter(v => v !== null && v !== '');
  if (values.length === 0) return 'categorical';
  const numericCount = values.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
  return (numericCount / values.length) >= 0.8 ? 'numeric' : 'categorical';
}

/* ---------------------------------------------------------------------
   Loading a dataset into state + refreshing dependent UI
--------------------------------------------------------------------- */
function loadDataset(headers, rows, fileName) {
  state.headers = headers;
  state.rows = rows;
  state.fileName = fileName;
  state.fieldTypes = {};
  headers.forEach(h => { state.fieldTypes[h] = detectFieldType(h); });
  state.selectedFields = [...headers];
  state.results = [];
  state.runHistory = [];

  renderDatasetSummary();
  renderFieldCheckboxes();
  updateHomeStats();
  renderResultsTable();
  renderValidationSummary();
  toast(`Loaded "${fileName}" — ${rows.length} rows, ${headers.length} columns.`, 'success');
}

function renderDatasetSummary() {
  const summary = document.getElementById('datasetSummary');
  summary.hidden = false;
  document.getElementById('sumFileName').textContent = state.fileName || '—';
  document.getElementById('sumRows').textContent = state.rows.length;
  document.getElementById('sumCols').textContent = state.headers.length;

  const thead = document.querySelector('#previewTable thead');
  const tbody = document.querySelector('#previewTable tbody');
  thead.innerHTML = `<tr>${state.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  tbody.innerHTML = state.rows.slice(0, 8).map(row =>
    `<tr>${state.headers.map(h => `<td>${row[h] === null ? '<em>missing</em>' : escapeHtml(String(row[h]))}</td>`).join('')}</tr>`
  ).join('');
}

function renderFieldCheckboxes() {
  const box = document.getElementById('fieldCheckboxes');
  if (state.headers.length === 0) {
    box.innerHTML = '<p class="hint">Load a dataset first to see fields here.</p>';
    return;
  }
  box.innerHTML = state.headers.map(h => `
    <label>
      <input type="checkbox" value="${escapeHtml(h)}" ${state.selectedFields.includes(h) ? 'checked' : ''} class="field-check">
      ${escapeHtml(h)} <span class="hint">(${state.fieldTypes[h]})</span>
    </label>
  `).join('');
  box.querySelectorAll('.field-check').forEach(cb => {
    cb.addEventListener('change', () => {
      state.selectedFields = Array.from(box.querySelectorAll('.field-check:checked')).map(c => c.value);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------
   Binary conversion core
--------------------------------------------------------------------- */
function decimalToBinary(num, bitLength) {
  const steps = [];
  if (num === 0) {
    steps.push('0 is already the base case → binary 0');
  }
  let n = num;
  let bin = '';
  while (n > 0) {
    const remainder = n % 2;
    const quotient = Math.floor(n / 2);
    steps.push(`${n} ÷ 2 = ${quotient} remainder ${remainder}`);
    bin = remainder + bin;
    n = quotient;
  }
  if (bin === '') bin = '0';
  if (bitLength && bin.length < bitLength) {
    bin = bin.padStart(bitLength, '0');
  }
  return { binary: bin, steps, overflow: bitLength ? (bin.length > bitLength) : false };
}

function bitsNeeded(maxValue) {
  if (maxValue <= 0) return 1;
  return Math.max(1, Math.ceil(Math.log2(maxValue + 1)));
}

function resolveBitLength(setting, maxValueOrCount) {
  if (setting === 'auto') return bitsNeeded(maxValueOrCount);
  return parseInt(setting, 10);
}

/* ---------------------------------------------------------------------
   Field-level encoders
   Each returns array of {original, processed, binary, status, note}
--------------------------------------------------------------------- */
function encodeNumericField(field, values, bitLengthSetting, missingMode) {
  const numericVals = values.filter(v => v !== null && !isNaN(parseFloat(v))).map(v => parseFloat(v));
  const maxVal = numericVals.length ? Math.max(...numericVals.map(Math.abs)) : 0;
  const bitLength = resolveBitLength(bitLengthSetting, maxVal);

  return values.map(raw => {
    if (raw === null || raw === '') {
      if (missingMode === 'skip') return null;
      if (missingMode === 'flag') return { original: '(missing)', processed: '(missing)', binary: '—', status: 'Invalid', note: 'Missing value' };
      return { original: '(missing)', processed: 0, binary: '0'.repeat(bitLength), status: 'Warning', note: 'Missing value filled with 0' };
    }
    const num = parseFloat(raw);
    if (isNaN(num)) {
      return { original: raw, processed: raw, binary: '—', status: 'Invalid', note: 'Non-numeric value' };
    }
    if (num < 0) {
      return { original: raw, processed: num, binary: '—', status: 'Invalid', note: 'Negative numbers are not supported by unsigned binary' };
    }
    if (!Number.isInteger(num)) {
      return { original: raw, processed: num, binary: '—', status: 'Invalid', note: 'Non-integer value' };
    }
    const { binary, overflow } = decimalToBinary(num, bitLength);
    if (overflow) {
      return { original: raw, processed: num, binary, status: 'Invalid', note: `Exceeds selected bit length (${bitLength} bits)` };
    }
    return { original: raw, processed: num, binary, status: 'Valid', note: '' };
  }).filter(Boolean);
}

function encodeCategoricalField(field, values, bitLengthSetting, missingMode, mode) {
  const present = values.filter(v => v !== null && v !== '');
  const uniqueCats = [...new Set(present)];
  const bitLength = mode === 'onehot'
    ? uniqueCats.length
    : resolveBitLength(bitLengthSetting, uniqueCats.length - 1);

  const codeMap = {};
  uniqueCats.forEach((cat, idx) => { codeMap[cat] = idx; });

  return values.map(raw => {
    if (raw === null || raw === '') {
      if (missingMode === 'skip') return null;
      if (missingMode === 'flag') return { original: '(missing)', processed: '(missing)', binary: '—', status: 'Invalid', note: 'Missing value' };
      const zeros = '0'.repeat(bitLength || 1);
      return { original: '(missing)', processed: 0, binary: zeros, status: 'Warning', note: 'Missing value filled with 0' };
    }
    const idx = codeMap[raw];
    if (mode === 'onehot') {
      const bits = new Array(uniqueCats.length).fill('0');
      bits[idx] = '1';
      return { original: raw, processed: idx, binary: bits.join(''), status: 'Valid', note: `Category #${idx + 1} of ${uniqueCats.length}` };
    }
    const { binary, overflow } = decimalToBinary(idx, bitLength);
    if (overflow) {
      return { original: raw, processed: idx, binary, status: 'Invalid', note: `Exceeds selected bit length (${bitLength} bits)` };
    }
    return { original: raw, processed: idx, binary, status: 'Valid', note: '' };
  }).filter(Boolean);
}

function encodeBinaryPassthrough(field, values, missingMode) {
  return values.map(raw => {
    if (raw === null || raw === '') {
      if (missingMode === 'skip') return null;
      if (missingMode === 'flag') return { original: '(missing)', processed: '(missing)', binary: '—', status: 'Invalid', note: 'Missing value' };
      return { original: '(missing)', processed: 0, binary: '0', status: 'Warning', note: 'Missing value filled with 0' };
    }
    const normalized = String(raw).trim().toLowerCase();
    const truthy = ['1', 'true', 'yes', 'male', 'on'];
    const falsy = ['0', 'false', 'no', 'female', 'off'];
    if (truthy.includes(normalized)) return { original: raw, processed: 1, binary: '1', status: 'Valid', note: '' };
    if (falsy.includes(normalized)) return { original: raw, processed: 0, binary: '0', status: 'Valid', note: '' };
    return { original: raw, processed: raw, binary: '—', status: 'Invalid', note: 'Value is not a recognizable binary-like value (0/1, yes/no, true/false)' };
  }).filter(Boolean);
}

/* ---------------------------------------------------------------------
   Run the full encoding pipeline
--------------------------------------------------------------------- */
function runEncoding() {
  if (state.rows.length === 0) {
    toast('Load a dataset before running the encoder.', 'error');
    return;
  }
  if (state.selectedFields.length === 0) {
    toast('Select at least one field to encode.', 'error');
    return;
  }

  showLoading('Running encoding pipeline…');
  animatePipeline();

  setTimeout(() => {
    const scheme = document.getElementById('encodingScheme').value;
    const bitLengthSetting = document.getElementById('bitLength').value;
    const missingMode = document.getElementById('missingHandling').value;
    const order = document.getElementById('encodingOrder').value;

    let results = [];
    state.selectedFields.forEach(field => {
      let values = state.rows.map(r => r[field]);
      const isNumericField = state.fieldTypes[field] === 'numeric';
      let fieldResults;

      if (scheme === 'binary') {
        fieldResults = encodeBinaryPassthrough(field, values, missingMode);
      } else if (scheme === 'onehot') {
        fieldResults = encodeCategoricalField(field, values, bitLengthSetting, missingMode, 'onehot');
      } else if (scheme === 'categorical') {
        fieldResults = encodeCategoricalField(field, values, bitLengthSetting, missingMode, 'label');
      } else { // numeric
        fieldResults = isNumericField
          ? encodeNumericField(field, values, bitLengthSetting, missingMode)
          : encodeCategoricalField(field, values, bitLengthSetting, missingMode, 'label');
      }

      fieldResults.forEach(r => results.push({ field, ...r }));
    });

    if (order === 'asc') {
      results.sort((a, b) => String(a.original).localeCompare(String(b.original), undefined, { numeric: true }));
    } else if (order === 'desc') {
      results.sort((a, b) => String(b.original).localeCompare(String(a.original), undefined, { numeric: true }));
    }

    state.results = results;
    state.currentPage = 1;
    state.runHistory.push({ time: new Date().toLocaleTimeString(), count: results.length });
    if (state.runHistory.length > 8) state.runHistory.shift();

    updateHomeStats();
    renderResultsTable();
    renderValidationSummary();
    renderLeds(results);
    renderCharts();
    hideLoading();
    toast(`Encoding complete — ${results.length} values processed.`, 'success');
  }, 550);
}

/* ---------------------------------------------------------------------
   Pipeline animation (digital logic visualization)
--------------------------------------------------------------------- */
function animatePipeline() {
  const stages = document.querySelectorAll('.pipe-stage');
  const bit = document.getElementById('pipeBit');
  stages.forEach(s => s.classList.remove('active'));
  bit.classList.remove('moving');
  bit.style.left = '0px';

  let i = 0;
  const total = stages.length;
  const interval = setInterval(() => {
    stages.forEach(s => s.classList.remove('active'));
    if (i < total) {
      stages[i].classList.add('active');
      const pct = (i / (total - 1)) * 92;
      bit.classList.add('moving');
      bit.style.left = `${pct}%`;
      i++;
    } else {
      clearInterval(interval);
      setTimeout(() => bit.classList.remove('moving'), 300);
    }
  }, 320);
}

function renderLeds(results) {
  const row = document.getElementById('ledRow');
  if (results.length === 0) {
    row.innerHTML = '<p class="hint">Run the encoder to light up bits here.</p>';
    return;
  }
  const sampleBinary = results.find(r => r.binary && r.binary !== '—')?.binary || '0000';
  row.innerHTML = sampleBinary.split('').map(bit =>
    `<div class="led ${bit === '1' ? 'on' : 'off'}">${bit}</div>`
  ).join('');
}

/* ---------------------------------------------------------------------
   Single-value "try it" encoder
--------------------------------------------------------------------- */
document.getElementById('btnTryEncode').addEventListener('click', () => {
  const raw = document.getElementById('tryValue').value.trim();
  const resultBox = document.getElementById('tryResult');
  const stepsBox = document.getElementById('tryStepsBox');
  const stepsList = document.getElementById('tryStepsList');
  const stepsFinal = document.getElementById('tryStepsFinal');

  if (raw === '') {
    resultBox.innerHTML = '<span style="color:var(--danger)">Enter a value first.</span>';
    stepsBox.hidden = true;
    return;
  }

  const num = parseFloat(raw);
  if (!isNaN(num) && isFinite(num) && String(num) === raw.replace(/^\+/, '')) {
    if (num < 0) {
      resultBox.innerHTML = `<span class="mono">${escapeHtml(raw)}</span><span class="arrow">→</span><span style="color:var(--danger)">invalid (negative)</span>`;
      stepsBox.hidden = true;
      return;
    }
    if (!Number.isInteger(num)) {
      resultBox.innerHTML = `<span class="mono">${escapeHtml(raw)}</span><span class="arrow">→</span><span style="color:var(--danger)">invalid (non-integer)</span>`;
      stepsBox.hidden = true;
      return;
    }
    const bitLengthSetting = document.getElementById('bitLength').value;
    const bitLength = resolveBitLength(bitLengthSetting, num);
    const { binary, steps } = decimalToBinary(num, bitLength);
    resultBox.innerHTML = `<span class="mono">${num}</span><span class="arrow">→</span><span class="mono bin">${binary}</span>`;
    stepsList.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    stepsFinal.textContent = `Binary: ${binary}`;
    stepsBox.hidden = false;
  } else {
    // Treat as categorical single-value demo — map by simple char-sum style pseudo-code for illustration
    const demoMap = { male: '01', female: '10', other: '11', yes: '1', no: '0' };
    const key = raw.toLowerCase();
    const bin = demoMap[key] || decimalToBinary(raw.length % 8, 4).binary;
    resultBox.innerHTML = `<span class="mono">${escapeHtml(raw)}</span><span class="arrow">→</span><span class="mono bin">${bin}</span>`;
    stepsList.innerHTML = demoMap[key]
      ? `<li>"${escapeHtml(raw)}" matched a known category → assigned code ${bin}</li>`
      : `<li>"${escapeHtml(raw)}" is an unlisted category → derived a demo code from its length</li>`;
    stepsFinal.textContent = `Binary: ${bin} (run the full encoder for dataset-consistent categorical codes)`;
    stepsBox.hidden = false;
  }
});

/* ---------------------------------------------------------------------
   Results table: search / filter / sort / pagination
--------------------------------------------------------------------- */
function getFilteredResults() {
  const search = document.getElementById('tableSearch').value.toLowerCase();
  const filter = document.getElementById('tableFilter').value;
  const sort = document.getElementById('tableSort').value;

  let data = state.results.filter(r => {
    const matchesSearch = !search ||
      String(r.original).toLowerCase().includes(search) ||
      r.field.toLowerCase().includes(search) ||
      String(r.binary).toLowerCase().includes(search);
    const matchesFilter = filter === 'all' || r.status === filter;
    return matchesSearch && matchesFilter;
  });

  if (sort === 'field') data = [...data].sort((a, b) => a.field.localeCompare(b.field));
  if (sort === 'original') data = [...data].sort((a, b) => String(a.original).localeCompare(String(b.original), undefined, { numeric: true }));
  if (sort === 'status') data = [...data].sort((a, b) => a.status.localeCompare(b.status));

  return data;
}

function renderResultsTable() {
  const body = document.getElementById('resultsBody');
  const data = getFilteredResults();

  if (data.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty-row">${state.results.length === 0 ? 'No encoded data yet — run the encoder above.' : 'No rows match your search/filter.'}</td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(data.length / state.pageSize));
  state.currentPage = Math.min(state.currentPage, totalPages);
  const start = (state.currentPage - 1) * state.pageSize;
  const pageData = data.slice(start, start + state.pageSize);

  body.innerHTML = pageData.map(r => `
    <tr>
      <td>${escapeHtml(r.field)}</td>
      <td>${escapeHtml(String(r.original))}</td>
      <td>${escapeHtml(String(r.processed))}</td>
      <td class="mono">${escapeHtml(String(r.binary))}</td>
      <td><span class="badge ${r.status}">${r.status === 'Valid' ? '✓' : r.status === 'Warning' ? '⚠' : '✕'} ${r.status}</span></td>
    </tr>
  `).join('');

  const pag = document.getElementById('pagination');
  let btns = '';
  for (let p = 1; p <= totalPages; p++) {
    btns += `<button class="${p === state.currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  pag.innerHTML = btns;
  pag.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { state.currentPage = parseInt(b.dataset.page, 10); renderResultsTable(); });
  });
}

['tableSearch', 'tableFilter', 'tableSort'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => { state.currentPage = 1; renderResultsTable(); });
});

/* ---------------------------------------------------------------------
   Validation summary + issue log
--------------------------------------------------------------------- */
function renderValidationSummary() {
  const valid = state.results.filter(r => r.status === 'Valid').length;
  const warn = state.results.filter(r => r.status === 'Warning').length;
  const invalid = state.results.filter(r => r.status === 'Invalid').length;

  document.getElementById('valValid').textContent = valid;
  document.getElementById('valWarn').textContent = warn;
  document.getElementById('valError').textContent = invalid;

  // Duplicate encoding check (same field, same binary, different original) for categorical-style results
  const seen = {};
  const dupIssues = [];
  state.results.forEach(r => {
    const key = `${r.field}::${r.binary}`;
    if (r.binary === '—') return;
    if (!seen[key]) seen[key] = new Set();
    seen[key].add(String(r.original));
  });
  Object.entries(seen).forEach(([key, origSet]) => {
    if (origSet.size > 1) {
      const [field, binary] = key.split('::');
      dupIssues.push({ field, value: [...origSet].join(', '), issue: `Duplicate binary code "${binary}" shared by multiple distinct values`, severity: 'Warning' });
    }
  });

  const issueRows = state.results
    .filter(r => r.status !== 'Valid')
    .map(r => ({ field: r.field, value: r.original, issue: r.note || 'Unspecified issue', severity: r.status }))
    .concat(dupIssues);

  const issueBody = document.getElementById('issueBody');
  if (issueRows.length === 0) {
    issueBody.innerHTML = `<tr><td colspan="4" class="empty-row">${state.results.length === 0 ? 'No issues yet — run the encoder to validate.' : 'No issues found — all encoded values are valid.'}</td></tr>`;
  } else {
    issueBody.innerHTML = issueRows.map(i => `
      <tr>
        <td>${escapeHtml(i.field)}</td>
        <td>${escapeHtml(String(i.value))}</td>
        <td>${escapeHtml(i.issue)}</td>
        <td><span class="badge ${i.severity}">${i.severity}</span></td>
      </tr>
    `).join('');
  }
}

/* ---------------------------------------------------------------------
   Home stats
--------------------------------------------------------------------- */
function updateHomeStats() {
  document.getElementById('statRecords').textContent = state.rows.length;
  document.getElementById('statFields').textContent = state.selectedFields.length;
  document.getElementById('statBinaryValues').textContent = state.results.filter(r => r.binary !== '—').length;
  const invalid = state.results.filter(r => r.status === 'Invalid').length;
  const statusEl = document.getElementById('statValidation');
  if (state.results.length === 0) {
    statusEl.textContent = '—';
  } else if (invalid === 0) {
    statusEl.textContent = 'Clean';
    statusEl.style.color = 'var(--success)';
  } else {
    statusEl.textContent = `${invalid} issue${invalid > 1 ? 's' : ''}`;
    statusEl.style.color = 'var(--danger)';
  }
}

/* ---------------------------------------------------------------------
   Charts
--------------------------------------------------------------------- */
function renderCharts() {
  const ctxByField = document.getElementById('chartByField');
  const ctxValidity = document.getElementById('chartValidity');
  const ctxBitDist = document.getElementById('chartBitDist');
  const ctxHistory = document.getElementById('chartHistory');
  if (!window.Chart) return;

  Object.values(state.charts).forEach(c => c && c.destroy());

  const gridColor = 'rgba(124,147,179,0.15)';
  const textColor = '#7C93B3';
  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;

  const fieldCounts = {};
  state.results.forEach(r => { fieldCounts[r.field] = (fieldCounts[r.field] || 0) + 1; });

  state.charts.byField = new Chart(ctxByField, {
    type: 'bar',
    data: {
      labels: Object.keys(fieldCounts),
      datasets: [{ label: 'Encoded records', data: Object.values(fieldCounts), backgroundColor: '#33E6FF' }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  const validCount = state.results.filter(r => r.status === 'Valid').length;
  const warnCount = state.results.filter(r => r.status === 'Warning').length;
  const invalidCount = state.results.filter(r => r.status === 'Invalid').length;

  state.charts.validity = new Chart(ctxValidity, {
    type: 'doughnut',
    data: {
      labels: ['Valid', 'Warning', 'Invalid'],
      datasets: [{ data: [validCount, warnCount, invalidCount], backgroundColor: ['#2EE6A6', '#FFC933', '#FF4D6D'] }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  let zeros = 0, ones = 0;
  state.results.forEach(r => {
    if (r.binary && r.binary !== '—') {
      for (const ch of r.binary) { if (ch === '0') zeros++; else if (ch === '1') ones++; }
    }
  });

  state.charts.bitDist = new Chart(ctxBitDist, {
    type: 'pie',
    data: { labels: ['0 bits', '1 bits'], datasets: [{ data: [zeros, ones], backgroundColor: ['#3B82F6', '#33E6FF'] }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  state.charts.history = new Chart(ctxHistory, {
    type: 'line',
    data: {
      labels: state.runHistory.map(h => h.time),
      datasets: [{ label: 'Records processed', data: state.runHistory.map(h => h.count), borderColor: '#33E6FF', backgroundColor: 'rgba(51,230,255,0.15)', tension: 0.3, fill: true }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

/* ---------------------------------------------------------------------
   Export
--------------------------------------------------------------------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (state.results.length === 0) { toast('Run the encoder before exporting.', 'error'); return; }
  const header = 'Field,Original Value,Processed Value,Binary Output,Status\n';
  const rows = state.results.map(r => `${r.field},"${r.original}","${r.processed}",${r.binary},${r.status}`).join('\n');
  downloadFile('encoded-dataset.csv', header + rows, 'text/csv');
  toast('Downloaded encoded-dataset.csv', 'success');
});

document.getElementById('btnExportJson').addEventListener('click', () => {
  if (state.results.length === 0) { toast('Run the encoder before exporting.', 'error'); return; }
  downloadFile('encoded-dataset.json', JSON.stringify(state.results, null, 2), 'application/json');
  toast('Downloaded encoded-dataset.json', 'success');
});

document.getElementById('btnResetDataset').addEventListener('click', () => {
  state.headers = []; state.rows = []; state.fieldTypes = {}; state.fileName = null;
  state.selectedFields = []; state.results = []; state.runHistory = [];
  document.getElementById('datasetSummary').hidden = true;
  document.getElementById('resultsBody').innerHTML = '<tr><td colspan="5" class="empty-row">No encoded data yet — run the encoder above.</td></tr>';
  document.getElementById('pagination').innerHTML = '';
  document.getElementById('ledRow').innerHTML = '<p class="hint">Run the encoder to light up bits here.</p>';
  renderFieldCheckboxes();
  updateHomeStats();
  renderValidationSummary();
  toast('Dataset reset.', 'warning');
});

document.getElementById('btnClearDataset').addEventListener('click', () => {
  document.getElementById('btnResetDataset').click();
});

/* ---------------------------------------------------------------------
   Dataset upload: drag & drop, browse, manual entry, sample
--------------------------------------------------------------------- */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener('click', () => fileInput.click());
document.getElementById('btnBrowse').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    toast('Please upload a .csv file.', 'error');
    return;
  }
  showLoading('Reading CSV file…');
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const { headers, rows } = parseCSV(e.target.result);
      loadDataset(headers, rows, file.name);
    } catch (err) {
      toast(`Could not parse file: ${err.message}`, 'error');
    } finally {
      hideLoading();
    }
  };
  reader.onerror = () => { toast('Failed to read the file.', 'error'); hideLoading(); };
  reader.readAsText(file);
}

document.getElementById('btnManualEntry').addEventListener('click', () => {
  const panel = document.getElementById('manualEntryPanel');
  panel.hidden = !panel.hidden;
});

document.getElementById('btnParseManual').addEventListener('click', () => {
  const text = document.getElementById('manualInput').value.trim();
  if (!text) { toast('Type some data first.', 'error'); return; }
  try {
    const { headers, rows } = parseCSV(text);
    loadDataset(headers, rows, 'manual-entry.csv');
    document.getElementById('manualEntryPanel').hidden = true;
  } catch (err) {
    toast(`Could not parse input: ${err.message}`, 'error');
  }
});

const SAMPLE_CSV = `Age,Gender,Score,Category
21,Male,85,A
34,Female,42,B
19,Female,90,A
45,Male,,C
10,Male,15,B
31,Female,78,A
25,Other,60,C
15,Male,,B
40,Female,99,A
22,Male,55,C`;

document.getElementById('btnSampleData').addEventListener('click', () => {
  showLoading('Loading sample dataset…');
  setTimeout(() => {
    const { headers, rows } = parseCSV(SAMPLE_CSV);
    loadDataset(headers, rows, 'sample-data.csv');
    hideLoading();
  }, 350);
});

document.getElementById('btnStartEncoding').addEventListener('click', () => {
  if (state.rows.length === 0) {
    toast('Loading the sample dataset so you can start encoding…', 'warning');
    document.getElementById('btnSampleData').click();
  }
  showPage('encoder');
});
document.getElementById('btnUploadDataset').addEventListener('click', () => showPage('dataset'));
document.getElementById('btnRunEncoding').addEventListener('click', runEncoding);

/* ---------------------------------------------------------------------
   Scheme explanation text
--------------------------------------------------------------------- */
function updateSchemeExplain() {
  const scheme = document.getElementById('encodingScheme').value;
  document.getElementById('schemeExplain').textContent = SCHEME_EXPLANATIONS[scheme];
}
document.getElementById('encodingScheme').addEventListener('change', updateSchemeExplain);
updateSchemeExplain();

/* ---------------------------------------------------------------------
   Test cases (10 normal + 5 edge/fault)
--------------------------------------------------------------------- */
const TEST_CASES = [
  { input: 0, bits: 4, expected: '0000' },
  { input: 1, bits: 4, expected: '0001' },
  { input: 2, bits: 4, expected: '0010' },
  { input: 5, bits: 4, expected: '0101' },
  { input: 10, bits: 4, expected: '1010' },
  { input: 15, bits: 4, expected: '1111' },
  { input: 21, bits: 8, expected: '00010101' },
  { input: 25, bits: 8, expected: '00011001' },
  { input: 30, bits: 8, expected: '00011110' },
  { input: 31, bits: 8, expected: '00011111' },
  // Edge / fault cases
  { input: null, bits: 4, expected: 'Missing value' },
  { input: '', bits: 4, expected: 'Empty input' },
  { input: -5, bits: 4, expected: 'Invalid (negative)' },
  { input: 'abc', bits: 4, expected: 'Invalid (non-numeric)' },
  { input: 999, bits: 4, expected: 'Invalid (exceeds bit length)' }
];

function runTestCase(tc) {
  const { input, bits } = tc;
  if (input === null) return 'Missing value';
  if (input === '') return 'Empty input';
  if (typeof input === 'number' && input < 0) return 'Invalid (negative)';
  if (typeof input === 'string' && isNaN(parseFloat(input))) return 'Invalid (non-numeric)';
  const num = parseFloat(input);
  const { binary, overflow } = decimalToBinary(num, bits);
  if (overflow) return 'Invalid (exceeds bit length)';
  return binary;
}

document.getElementById('btnRunTests').addEventListener('click', () => {
  showLoading('Running test suite…');
  setTimeout(() => {
    const body = document.getElementById('testBody');
    body.innerHTML = TEST_CASES.map((tc, idx) => {
      const actual = runTestCase(tc);
      const pass = actual === tc.expected;
      const inputDisplay = tc.input === null ? '(missing)' : tc.input === '' ? '(empty)' : String(tc.input);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="mono">${escapeHtml(inputDisplay)} <span class="hint">(${tc.bits}-bit)</span></td>
          <td class="mono">${escapeHtml(tc.expected)}</td>
          <td class="mono">${escapeHtml(actual)}</td>
          <td><span class="badge ${pass ? 'Valid' : 'Invalid'}">${pass ? '✓ Pass' : '✕ Fail'}</span></td>
        </tr>
      `;
    }).join('');
    hideLoading();
    const passCount = TEST_CASES.filter(tc => runTestCase(tc) === tc.expected).length;
    toast(`Test suite complete — ${passCount}/${TEST_CASES.length} passed.`, passCount === TEST_CASES.length ? 'success' : 'warning');
  }, 400);
});

/* ---------------------------------------------------------------------
   Hero bit preview animation (decorative, purely visual)
--------------------------------------------------------------------- */
function initHeroBits() {
  const row = document.getElementById('heroBitRow');
  const bits = Array.from({ length: 8 }, () => Math.round(Math.random()));
  row.innerHTML = bits.map(b => `<span class="${b ? 'on' : ''}">${b}</span>`).join('');
  setInterval(() => {
    const spans = row.querySelectorAll('span');
    spans.forEach(s => {
      const on = Math.random() > 0.5;
      s.textContent = on ? '1' : '0';
      s.classList.toggle('on', on);
    });
  }, 1400);
}

function initBitRain() {
  const container = document.getElementById('bitRain');
  const count = window.innerWidth < 700 ? 14 : 28;
  let html = '';
  for (let i = 0; i < count; i++) {
    const left = Math.random() * 100;
    const duration = 8 + Math.random() * 10;
    const delay = Math.random() * 10;
    const bit = Math.round(Math.random());
    html += `<span style="left:${left}%; animation-duration:${duration}s; animation-delay:${delay}s;">${bit}</span>`;
  }
  container.innerHTML = html;
}

/* ---------------------------------------------------------------------
   Init
--------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  initHeroBits();
  initBitRain();
  updateHomeStats();
  renderValidationSummary();
});
