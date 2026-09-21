// Estados contables anuales (hasta ~15 años) desde SEC EDGAR "companyfacts" (XBRL): gratis, sin API key.
// Solo cubre emisores que presentan 10-K / 20-F ante la SEC de EE.UU. y reportan en USD.
// Lo usa Analisis_Fundamental_FCN.html para completar lo que falte en los archivos subidos.
// Lógica de tags portada de .github/scripts/edgar_fundamentals.py (mismo criterio de ejercicio fiscal).

const UA = { 'User-Agent': 'FinanzasconNico Suite research nicostrijland@gmail.com' };
const CIK_OVERRIDE = { XOM: '0000034088' };
const FORMS = ['10-K', '20-F', '40-F'];
const NS = ['us-gaap', 'ifrs-full'];

const DUR = {
  ventas: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax',
           'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense', 'Revenue', 'RevenueFromContractsWithCustomers'],
  gp: ['GrossProfit'],
  ni: ['NetIncomeLoss', 'ProfitLoss', 'ProfitLossAttributableToOwnersOfParent'],
  opinc: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization',
       'DepreciationAndAmortisationExpense'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
        'CashFlowsFromUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets',
          'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
};
const EPS = ['EarningsPerShareBasic', 'EarningsPerShareBasicAndDiluted', 'BasicEarningsLossPerShare', 'BasicAndDilutedEarningsLossPerShare'];
const INST = {
  assets: ['Assets'],
  liab: ['Liabilities'],
  ca: ['AssetsCurrent', 'CurrentAssets'],
  cl: ['LiabilitiesCurrent', 'CurrentLiabilities'],
  eq: ['StockholdersEquity', 'EquityAttributableToOwnersOfParent', 'Equity'],
  eqTot: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'Equity'],
  debtComb: ['DebtLongtermAndShorttermCombinedAmount'],
  ltd: ['LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
  ltdNc: ['LongTermDebtNoncurrent', 'NoncurrentBorrowings'],
  ltdCur: ['LongTermDebtCurrent', 'CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings'],
  stb: ['ShortTermBorrowings', 'CommercialPaper'],
};

async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} en ${url}`);
  return r.json();
}

let TICKER_MAP = null;
async function cikOf(ticker) {
  const t = ticker.toUpperCase();
  if (!TICKER_MAP) {
    const m = await getJson('https://www.sec.gov/files/company_tickers.json', UA);
    TICKER_MAP = {};
    for (const v of Object.values(m)) TICKER_MAP[v.ticker.toUpperCase()] = { cik: String(v.cik_str).padStart(10, '0'), name: v.title };
  }
  const hit = TICKER_MAP[t] || TICKER_MAP[t.replace('.', '-')];
  if (!hit) return null;
  return { cik: CIK_OVERRIDE[t] || hit.cik, name: hit.name };
}

const fyOf = end => { const d = new Date(end + 'T00:00:00Z'); return d.getUTCMonth() + 1 >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const okForm = x => FORMS.some(f => String(x.form || '').startsWith(f));

// filas USD (o USD/shares) de un tag, de cualquier namespace
function rowsOf(facts, tag, perShare) {
  const out = [];
  for (const ns of NS) {
    const node = facts[ns] && facts[ns][tag];
    if (!node || !node.units) continue;
    const unit = perShare ? 'USD/shares' : 'USD';
    if (node.units[unit]) out.push(...node.units[unit]);
  }
  return out;
}

// {fy: {v, end}} de flujos anuales; earliest=true -> tal como se reportó originalmente (EPS)
function mergeDur(facts, tags, { earliest = false, perShare = false } = {}) {
  const out = {};
  for (const tag of tags) {
    for (const x of rowsOf(facts, tag, perShare)) {
      if (!okForm(x) || !x.start || !x.end) continue;
      const d = days(x.start, x.end);
      if (d < 350 || d > 380) continue;
      const fy = fyOf(x.end), cur = out[fy], filed = x.filed || '';
      if (!cur || (earliest ? filed < cur.filed : filed > cur.filed)) out[fy] = { v: x.val, filed, end: x.end };
    }
  }
  return out;
}
function mergeInst(facts, tags) {
  const out = {};
  for (const tag of tags) {
    for (const x of rowsOf(facts, tag, false)) {
      if (!okForm(x) || !x.end) continue;
      const fy = fyOf(x.end), cur = out[fy], filed = x.filed || '';
      if (!cur || filed > cur.filed) out[fy] = { v: x.val, filed, end: x.end };
    }
  }
  return out;
}

async function splitsOf(ticker) {
  try {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=max&interval=3mo&events=split`,
                            { 'User-Agent': 'Mozilla/5.0' });
    const sp = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].events && j.chart.result[0].events.splits;
    if (!sp) return [];
    return Object.values(sp).map(s => ({ date: s.date, ratio: s.numerator / s.denominator })).filter(s => s.ratio > 0);
  } catch (e) { return null; }
}

function construirSeries(facts, splits) {
  const g = {};
  for (const [k, tags] of Object.entries(DUR)) g[k] = mergeDur(facts, tags);
  g.eps = mergeDur(facts, EPS, { earliest: true, perShare: true });
  for (const [k, tags] of Object.entries(INST)) g[k] = mergeInst(facts, tags);

  const years = new Set();
  for (const k of ['ventas', 'ni', 'assets', 'eq']) Object.keys(g[k]).forEach(y => years.add(+y));
  const series = { ventas: {}, beneficio_bruto: {}, beneficio_neto: {}, ebitda: {}, bpa: {}, activo_corriente: {}, pasivo_corriente: {},
                   activos_totales: {}, pasivo_total: {}, patrimonio_neto: {}, deuda_total: {}, fcf: {} };
  const val = (k, y) => g[k][y] ? g[k][y].v : null;

  for (const y of [...years].sort((a, b) => a - b)) {
    const put = (key, v) => { if (v != null && isFinite(v)) series[key][y] = v; };
    put('ventas', val('ventas', y));
    put('beneficio_bruto', val('gp', y));
    put('beneficio_neto', val('ni', y));
    if (val('opinc', y) != null && val('da', y) != null) put('ebitda', val('opinc', y) + val('da', y));
    const e = g.eps[y];
    if (e) {
      let adj = 1;
      if (splits) for (const s of splits) if (s.date * 1000 > new Date(e.end).getTime()) adj *= s.ratio;
      put('bpa', e.v / adj);
    }
    put('activo_corriente', val('ca', y));
    put('pasivo_corriente', val('cl', y));
    put('activos_totales', val('assets', y));
    const liab = val('liab', y) != null ? val('liab', y)
      : (val('assets', y) != null && val('eqTot', y) != null ? val('assets', y) - val('eqTot', y) : null);
    put('pasivo_total', liab);
    put('patrimonio_neto', val('eq', y) != null ? val('eq', y) : val('eqTot', y));
    let debt = val('debtComb', y);
    if (debt == null) {
      const lt = val('ltd', y) != null ? val('ltd', y) : (val('ltdNc', y) != null ? val('ltdNc', y) + (val('ltdCur', y) || 0) : null);
      if (lt != null) debt = lt + (val('stb', y) || 0);
    }
    put('deuda_total', debt);
    if (val('ocf', y) != null && val('capex', y) != null) put('fcf', val('ocf', y) - Math.abs(val('capex', y)));
  }
  return series;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  const ticker = String((req.query && req.query.ticker) || '').trim();
  if (!ticker) { res.status(400).json({ error: 'falta el parametro ticker' }); return; }
  try {
    const hit = await cikOf(ticker);
    if (!hit) { res.status(404).json({ error: `"${ticker}" no figura en la SEC (solo emisores de EE.UU. con 10-K/20-F)` }); return; }
    const cf = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${hit.cik}.json`, UA);
    const splits = await splitsOf(ticker);
    const series = construirSeries(cf.facts || {}, splits);
    const n = Object.values(series).reduce((a, o) => a + Object.keys(o).length, 0);
    if (!n) { res.status(404).json({ error: 'la SEC no trae estados anuales en USD para ese ticker' }); return; }
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ticker: ticker.toUpperCase(), name: cf.entityName || hit.name, currency: 'USD', splitsAplicados: splits !== null, series });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
