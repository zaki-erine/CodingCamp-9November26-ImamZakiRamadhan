/* =============================================
   Expense & Budget Visualizer — app.js
   Core features:
     - Add / delete transactions (income & expense)
     - Balance summary (total balance, income, expense)
     - Spending-by-category donut chart (pure canvas)
     - LocalStorage persistence
   Optional challenges (3 of 5):
     1. Sort transactions by amount or category
     2. Highlight spending over a set limit
     3. Dark / light mode toggle
   ============================================= */

'use strict';

/* ── Category registry ───────────────────────────────────────────────────── */
const CATEGORY_META = {
  Food:          { icon: '🍔', color: '#f97316' },
  Transport:     { icon: '🚗', color: '#3b82f6' },
  Shopping:      { icon: '🛍️', color: '#a855f7' },
  Health:        { icon: '💊', color: '#10b981' },
  Entertainment: { icon: '🎮', color: '#ec4899' },
  Bills:         { icon: '📄', color: '#64748b' },
  Salary:        { icon: '💼', color: '#06b6d4' },
  Other:         { icon: '📦', color: '#6366f1' },
};

/* ── LocalStorage keys ───────────────────────────────────────────────────── */
const LS_TX    = 'bv_transactions';
const LS_THEME = 'bv_theme';
const LS_LIMIT = 'bv_limit';

/* ── App state ───────────────────────────────────────────────────────────── */
let transactions  = [];
let spendingLimit = 0;

/* ── DOM references ──────────────────────────────────────────────────────── */
const totalBalanceEl  = document.getElementById('totalBalance');
const totalIncomeEl   = document.getElementById('totalIncome');
const totalExpenseEl  = document.getElementById('totalExpense');
const transactionList = document.getElementById('transactionList');
const listEmpty       = document.getElementById('listEmpty');
const formError       = document.getElementById('formError');
const limitAlert      = document.getElementById('limitAlert');
const limitDisplay    = document.getElementById('limitDisplay');
const limitInput      = document.getElementById('spendingLimit');
const setLimitBtn     = document.getElementById('setLimitBtn');
const themeToggle     = document.getElementById('themeToggle');
const themeIcon       = document.getElementById('themeIcon');
const sortBySelect    = document.getElementById('sortBy');
const canvas          = document.getElementById('spendingChart');
const chartEmpty      = document.getElementById('chartEmpty');
const chartLegend     = document.getElementById('chartLegend');
const ctx             = canvas.getContext('2d');

/* ── Utility helpers ─────────────────────────────────────────────────────── */

/** Format a number as Indonesian Rupiah (absolute value). */
function formatRp(n) {
  return 'Rp ' + Math.abs(n).toLocaleString('id-ID');
}

/** Tiny unique id — good enough for client-side use. */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Today as YYYY-MM-DD. */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable date from an ISO string, e.g. "12 Nov 2026". */
function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** Escape user-supplied strings before inserting into innerHTML. */
function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

function saveTransactions() {
  localStorage.setItem(LS_TX, JSON.stringify(transactions));
}

function loadTransactions() {
  try {
    const raw = localStorage.getItem(LS_TX);
    transactions = raw ? JSON.parse(raw) : [];
  } catch {
    transactions = [];
  }
}

function saveLimit() {
  localStorage.setItem(LS_LIMIT, String(spendingLimit));
}

function loadLimit() {
  const raw = localStorage.getItem(LS_LIMIT);
  spendingLimit = raw ? parseFloat(raw) : 0;
  if (spendingLimit > 0) limitInput.value = spendingLimit;
}

/* ── Optional Challenge 3: Dark / light mode toggle ─────────────────────── */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(LS_THEME, theme);
}

function loadTheme() {
  applyTheme(localStorage.getItem(LS_THEME) || 'light');
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'light' : 'dark';
  applyTheme(next);
  setTimeout(drawChart, 50); // redraw canvas so centre text colour updates
});

/* ── Balance summary ─────────────────────────────────────────────────────── */

function computeSummary() {
  let income = 0;
  let expense = 0;

  transactions.forEach(tx => {
    if (tx.type === 'income')  income  += tx.amount;
    if (tx.type === 'expense') expense += tx.amount;
  });

  const balance = income - expense;

  totalIncomeEl.textContent  = '+ ' + formatRp(income);
  totalExpenseEl.textContent = '- ' + formatRp(expense);
  totalBalanceEl.textContent = formatRp(balance);
  totalBalanceEl.style.color = balance >= 0 ? '#6ee7b7' : '#fca5a5';

  /* Optional Challenge 2: show banner when total expenses exceed the limit */
  if (spendingLimit > 0 && expense > spendingLimit) {
    limitDisplay.textContent = formatRp(spendingLimit);
    limitAlert.classList.remove('hidden');
  } else {
    limitAlert.classList.add('hidden');
  }
}

/* ── Donut chart (pure canvas, no external library) ─────────────────────── */

function drawChart() {
  // Build expense totals per category
  const totals = {};
  transactions.forEach(tx => {
    if (tx.type === 'expense') {
      totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
    }
  });

  const categories = Object.keys(totals);

  if (categories.length === 0) {
    canvas.style.display = 'none';
    chartEmpty.classList.remove('hidden');
    chartLegend.innerHTML = '';
    return;
  }

  canvas.style.display = 'block';
  chartEmpty.classList.add('hidden');

  const W = canvas.width;
  const cx = W / 2;
  const cy = W / 2;
  const outerR = W * 0.38;
  const innerR = W * 0.22;
  const GAP    = 0.025; // radians gap between slices

  ctx.clearRect(0, 0, W, W);

  const total = categories.reduce((s, c) => s + totals[c], 0);
  let angle = -Math.PI / 2;

  categories.forEach(cat => {
    const sweep = (totals[cat] / total) * (2 * Math.PI - GAP * categories.length);
    const end   = angle + sweep;
    const color = (CATEGORY_META[cat] || CATEGORY_META.Other).color;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, end);
    ctx.arc(cx, cy, innerR, end, angle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    angle = end + GAP;
  });

  // Centre label
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.fillStyle    = dark ? '#f1f5f9' : '#1a1d2e';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(W * 0.09)}px -apple-system, sans-serif`;
  ctx.fillText(categories.length + (categories.length === 1 ? ' cat.' : ' cats'), cx, cy);

  // Legend
  chartLegend.innerHTML = '';
  categories.forEach(cat => {
    const pct  = ((totals[cat] / total) * 100).toFixed(1);
    const meta = CATEGORY_META[cat] || CATEGORY_META.Other;
    const div  = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML =
      `<span class="legend-dot" style="background:${meta.color}"></span>` +
      `<span>${meta.icon} ${esc(cat)} (${pct}%)</span>`;
    chartLegend.appendChild(div);
  });
}

/* ── Transaction list ────────────────────────────────────────────────────── */

/** Optional Challenge 1: return transactions sorted per the dropdown. */
function getSorted() {
  const copy = [...transactions];
  switch (sortBySelect.value) {
    case 'date-desc':   return copy.sort((a, b) => b.date.localeCompare(a.date));
    case 'date-asc':    return copy.sort((a, b) => a.date.localeCompare(b.date));
    case 'amount-desc': return copy.sort((a, b) => b.amount - a.amount);
    case 'amount-asc':  return copy.sort((a, b) => a.amount - b.amount);
    case 'category':    return copy.sort((a, b) => a.category.localeCompare(b.category));
    default:            return copy;
  }
}

/**
 * Optional Challenge 2: flag an individual expense that is "big" —
 * defined as >= 20 % of the monthly spending limit.
 */
function isBigSpend(tx) {
  return tx.type === 'expense' && spendingLimit > 0 && tx.amount >= spendingLimit * 0.2;
}

function renderTransactions() {
  const sorted = getSorted();
  transactionList.innerHTML = '';

  if (sorted.length === 0) {
    listEmpty.classList.remove('hidden');
    transactionList.appendChild(listEmpty);
    return;
  }

  sorted.forEach(tx => {
    const meta = CATEGORY_META[tx.category] || CATEGORY_META.Other;
    const big  = isBigSpend(tx);
    const li   = document.createElement('li');
    li.className = 'transaction-item' + (big ? ' over-limit' : '');
    li.dataset.id = tx.id;

    li.innerHTML =
      `<span class="tx-icon">${meta.icon}</span>
      <div class="tx-info">
        <div class="tx-description">${esc(tx.description)}</div>
        <div class="tx-meta">
          <span>${esc(tx.category)}</span>
          <span>${formatDate(tx.date)}</span>
        </div>
      </div>
      <div class="tx-amount-col">
        <span class="tx-amount ${tx.type}">
          ${tx.type === 'income' ? '+' : '−'} ${formatRp(tx.amount)}
        </span>
        ${big ? '<span class="over-limit-badge">⚠ big spend</span>' : ''}
      </div>
      <button class="tx-delete" aria-label="Delete transaction" data-id="${tx.id}">🗑</button>`;

    transactionList.appendChild(li);
  });
}

/* ── Full render cycle ───────────────────────────────────────────────────── */

function render() {
  computeSummary();
  renderTransactions();
  drawChart();
}

/* ── Add transaction ─────────────────────────────────────────────────────── */

document.getElementById('transactionForm').addEventListener('submit', e => {
  e.preventDefault();

  const description = document.getElementById('txDescription').value.trim();
  const amount      = parseFloat(document.getElementById('txAmount').value);
  const type        = document.getElementById('txType').value;
  const category    = document.getElementById('txCategory').value;
  const date        = document.getElementById('txDate').value;

  if (!description || isNaN(amount) || amount <= 0 || !date) {
    formError.classList.remove('hidden');
    return;
  }

  formError.classList.add('hidden');
  transactions.push({ id: uid(), description, amount, type, category, date });
  saveTransactions();
  render();

  // Clear only the fields that change per entry; keep date & category
  document.getElementById('txDescription').value = '';
  document.getElementById('txAmount').value      = '';
});

/* ── Delete transaction (event delegation) ───────────────────────────────── */

transactionList.addEventListener('click', e => {
  const btn = e.target.closest('.tx-delete');
  if (!btn) return;
  transactions = transactions.filter(tx => tx.id !== btn.dataset.id);
  saveTransactions();
  render();
});

/* ── Sort change ─────────────────────────────────────────────────────────── */

sortBySelect.addEventListener('change', renderTransactions);

/* ── Spending limit ──────────────────────────────────────────────────────── */

setLimitBtn.addEventListener('click', () => {
  const val = parseFloat(limitInput.value);
  if (!isNaN(val) && val >= 0) {
    spendingLimit = val;
    saveLimit();
    render();
  }
});

limitInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') setLimitBtn.click();
});

/* ── Boot ────────────────────────────────────────────────────────────────── */

(function init() {
  document.getElementById('txDate').value = todayISO();
  loadTheme();
  loadTransactions();
  loadLimit();
  render();
})();
