// Proxy liviano a la API pública (no oficial) de gráficos de Yahoo Finance.
// Existe porque el navegador no puede pegarle directo a query1.finance.yahoo.com (CORS) y
// Analisis_Fundamental_FCN.html lo usa como fallback cuando no se sube un archivo de precio.
// Sin dependencias: usa fetch nativo del runtime de Vercel.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const ticker = (req.query.ticker || '').trim();
  if (!ticker) {
    res.status(400).json({ error: 'falta el parametro ticker' });
    return;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=20y&interval=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) {
      res.status(502).json({ error: `Yahoo respondio ${r.status}` });
      return;
    }
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result || !result.timestamp) {
      res.status(404).json({ error: 'sin datos para ese ticker' });
      return;
    }
    const ts = result.timestamp;
    const close = result.indicators?.quote?.[0]?.close || [];
    const series = [];
    for (let i = 0; i < ts.length; i++) {
      if (close[i] == null) continue;
      const d = new Date(ts[i] * 1000);
      series.push({ date: d.toISOString().slice(0, 10), close: close[i] });
    }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ticker, currency: result.meta?.currency || null, series });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
