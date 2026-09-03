"""
Valuacion por multiplos (P/E, P/S, EV/EBITDA, P/FCF, P/B) actual vs. promedio
historico + medias moviles semanales (21 / 50 / 200 ruedas), por ticker.

FUENTE UNICA: Yahoo Finance via yfinance. Gratis, sin API key, sin limite diario,
cobertura ~global (acciones US, ADR, CEDEARs, la mayoria de ARG via sufijo .BA).

Se descarto Financial Modeling Prep: su plan gratis tiene una lista blanca de
simbolos y solo respondia para ~15% de los tickers de la cartera.

COMO SE ARMA CADA DATO
----------------------
* Multiplo ACTUAL  -> directo de yf .info:
    P/E   = trailingPE
    P/S   = priceToSalesTrailing12Months
    P/B   = priceToBook
    EV/EBITDA = enterpriseToEbitda
    P/FCF = marketCap / freeCashflow   (freeCashflow de .info es TTM)
* Promedios 3Y / 5Y  -> se RECONSTRUYE el multiplo de cada ejercicio fiscal:
    para cada cierre de balance:  cap_bursatil_ese_dia = precio_ese_dia * acciones
    P/E = cap / net_income ; P/S = cap / revenue ; P/B = cap / equity ;
    P/FCF = cap / free_cash_flow ; EV/EBITDA = (cap + deuda - caja) / ebitda
  yfinance da ~4-5 años de estados contables anuales -> 3Y y 5Y salen; 10Y queda
  vacio (el panel lo muestra como "—").
* Medias moviles -> promedio del cierre semanal de las ultimas 21/50/200 semanas,
  de la misma serie de precios que ya se baja para reconstruir los multiplos.

Un multiplo negativo, cero o absurdo (>1000) se descarta (perdidas, dato faltante).

USO LOCAL
---------
    pip install yfinance pandas openpyxl --upgrade
    python .github/scripts/valuacion_multiplos.py            # toda la lista (tickers.txt)
    python .github/scripts/valuacion_multiplos.py AAPL GGAL  # solo esos (prueba)
"""

import os
import re
import sys
import json
import time
import math
import datetime

import logging

import pandas as pd
import yfinance as yf

# yfinance imprime cada 404 de un ticker que no existe (ej. "PAMP" antes de probar
# el ADR). Son esperados y ruidosos — los silenciamos.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TICKERS_FILE = os.path.join(HERE, "tickers.txt")
CACHE_FILE   = os.path.join(HERE, ".cache_valuacion_multiplos.json")
OUT_XLSX     = os.path.join(REPO, "data", "valuacion_multiplos.xlsx")

FRESH_DAYS = 6       # no re-consultar un ticker si su dato tiene menos de esto
THROTTLE   = 0.6     # s entre tickers (Yahoo tira 429 si se lo apura)
RETRIES    = 3

MULTS = ("PE", "PS", "EVEBITDA", "PFCF", "PB")

# rango razonable por multiplo (piso, techo). Fuera de esto el numero no sirve
# como ancla: dato puntual raro, FCF/EBITDA casi cero, o CEDEAR/moneda mal.
# Piso alto en P/E y P/FCF: nada real cotiza a menos de ~2x ganancias / flujo.
CAP = {
    "PE":       (2.0,  250),
    "PS":       (0.05, 90),
    "PB":       (0.05, 90),
    "PFCF":     (2.0,  180),
    "EVEBITDA": (1.0,  130),
}

# Tickers locales de Argentina/Brasil -> ADR o sufijo que Yahoo entiende.
ADR_MAP = {
    "GGAL": "GGAL", "YPFD": "YPF", "PAMP": "PAM", "BMA": "BMA", "LOMA": "LOMA",
    "CRES": "CRESY", "TECO2": "TEO", "CEPU": "CEPU", "EDN": "EDN", "SUPV": "SUPV",
    "BBAR": "BBAR", "TGSU2": "TGS", "TXAR": "TX", "MIRG": "MIRG", "AGRO": "AGRO",
    "BIOX": "BIOX", "GLOB": "GLOB", "MELI": "MELI", "VIST": "VIST",
    "PETR3": "PBR", "VALE3": "VALE", "ITUB4": "ITUB", "ABEV3": "ABEV",
    # CEDEARs con nombre propio en BYMA -> subyacente real (si no, quedaba el precio
    # en ARS del CEDEAR contra balances en USD = multiplos sin sentido)
    "DJNJ3": "JNJ", "DISN": "DIS", "XROX": "XRX", "NOKA": "NOK", "BNG": "BG",
    "ADGO": "AGRO", "MGLU3": "MGLU", "BBAS3": "BDORY",
}


# ---------------------------------------------------------------------------
def load_tickers():
    with open(TICKERS_FILE, encoding="utf-8") as f:
        raw = f.read().split()
    seen, order = set(), []
    for t in raw:
        m = re.match(r"^([A-Z0-9.]+)-REPETIDO-", t.upper())
        clean = (m.group(1) if m else t).strip().upper()
        if clean and clean not in seen:
            seen.add(clean)
            order.append(clean)
    return order


def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_cache(cache):
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=1)
    os.replace(tmp, CACHE_FILE)


def is_fresh(entry):
    if not entry or not entry.get("fetched"):
        return False
    try:
        d = datetime.date.fromisoformat(entry["fetched"])
    except Exception:
        return False
    return (datetime.date.today() - d).days < FRESH_DAYS


def clean_mult(x, rng=(0.1, 1000)):
    """Un multiplo solo sirve si cae dentro del rango razonable (piso, techo)."""
    lo, hi = rng
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or not (lo <= v < hi):
        return None
    return round(v, 2)


def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def avg(vals, n):
    xs = [v for v in vals[:n] if v is not None]
    if len(xs) < max(2, n - 2):     # exijo casi todos los años del horizonte
        return None
    return round(sum(xs) / len(xs), 2)


# ---------------------------------------------------------------------------
def row_label(df, *names):
    """Primera fila de un DataFrame de estados contables que matchee alguno de los nombres."""
    if df is None or df.empty:
        return None
    idx = {str(i).lower(): i for i in df.index}
    for n in names:
        key = n.lower()
        if key in idx:
            return idx[key]
    # match parcial
    for n in names:
        for k, orig in idx.items():
            if n.lower() in k:
                return orig
    return None


def series_for(df, *names):
    lbl = row_label(df, *names)
    return df.loc[lbl] if lbl is not None else None


def price_near(hist_close, when):
    """Cierre semanal mas cercano a la fecha 'when' (cierre de balance)."""
    if hist_close is None or hist_close.empty:
        return None
    try:
        ts = pd.Timestamp(when)
        if ts.tzinfo is None and hist_close.index.tz is not None:
            ts = ts.tz_localize(hist_close.index.tz)
        pos = hist_close.index.get_indexer([ts], method="nearest")[0]
        if pos < 0:
            return None
        return float(hist_close.iloc[pos])
    except Exception:
        return None


def yf_get(sym):
    """(info, income_stmt, balance_sheet, cashflow, weekly_close) o None."""
    last_err = None
    for attempt in range(RETRIES):
        try:
            t = yf.Ticker(sym)
            info = t.info or {}
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if not price:
                return None
            fin = t.income_stmt
            bs  = t.balance_sheet
            cf  = t.cashflow
            hist = t.history(period="7y", interval="1wk", auto_adjust=True)
            close = hist["Close"].dropna() if hist is not None and not hist.empty else None
            return info, fin, bs, cf, close
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if "not found" in msg or "404" in msg or "delisted" in msg:
                return None                      # ticker inexistente — no reintentar
            time.sleep(1.2 * (attempt + 1))
    print(f"    (yf error {sym}: {last_err})")
    return None


def build_entry(ticker):
    candidates = [ticker]
    if ticker in ADR_MAP and ADR_MAP[ticker] != ticker:
        candidates.append(ADR_MAP[ticker])
    candidates.append(ticker + ".BA")     # ultimo recurso: panel local de BYMA

    for sym in candidates:
        got = yf_get(sym)
        time.sleep(THROTTLE)
        if not got:
            continue
        info, fin, bs, cf, close = got

        price = num(info.get("currentPrice") or info.get("regularMarketPrice"))
        mcap  = num(info.get("marketCap"))
        fcf_ttm = num(info.get("freeCashflow"))

        actual = {
            "PE":  clean_mult(info.get("trailingPE"), CAP["PE"]),
            "PS":  clean_mult(info.get("priceToSalesTrailing12Months"), CAP["PS"]),
            "PB":  clean_mult(info.get("priceToBook"), CAP["PB"]),
            "EVEBITDA": clean_mult(info.get("enterpriseToEbitda"), CAP["EVEBITDA"]),
            "PFCF": None,   # se calcula abajo (info.freeCashflow es poco fiable)
        }

        # ---- reconstruccion por ejercicio fiscal ----
        # Metodo directo: multiplo_Y = cap_bursatil_ese_dia / metrica_del_ejercicio.
        # Solo se hace si los estados contables estan en la MISMA moneda que la
        # cotizacion (si no, ej. GGAL reporta en ARS y cotiza en USD por el ADR,
        # el ratio queda sin sentido -> se dejan solo los valores actuales de Yahoo).
        series = {k: [] for k in MULTS}
        fin_cur = (info.get("financialCurrency") or "").upper()
        px_cur  = (info.get("currency") or "").upper()
        same_currency = (not fin_cur) or (not px_cur) or (fin_cur == px_cur)

        rev   = series_for(fin, "Total Revenue", "Operating Revenue", "Revenue")
        ni    = series_for(fin, "Net Income", "Net Income Common Stockholders",
                           "Net Income Continuous Operations")
        ebitda = series_for(fin, "EBITDA", "Normalized EBITDA")
        ebit   = series_for(fin, "EBIT", "Operating Income")
        eq    = series_for(bs, "Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest")
        debt  = series_for(bs, "Total Debt", "Net Debt")
        cash  = series_for(bs, "Cash And Cash Equivalents",
                           "Cash Cash Equivalents And Short Term Investments")
        shares = series_for(bs, "Ordinary Shares Number", "Share Issued")
        fcf   = series_for(cf, "Free Cash Flow")
        ocf   = series_for(cf, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
        capex = series_for(cf, "Capital Expenditure")

        cols = list(fin.columns) if fin is not None and not fin.empty else []

        def col_val(s, col):
            if s is None or col not in s.index:
                return None
            return num(s.get(col))

        def fcf_val(col):
            f = col_val(fcf, col)
            if f is None:
                oc, cx = col_val(ocf, col), col_val(capex, col)
                f = (oc - abs(cx)) if (oc is not None and cx is not None) else None
            return f

        sh_now = num(info.get("sharesOutstanding"))
        # PFCF actual = cap_bursatil / FCF del ultimo ejercicio reportado
        if same_currency and mcap and cols:
            f0 = fcf_val(cols[0])
            if f0 and f0 > 0:
                actual["PFCF"] = clean_mult(mcap / f0, CAP["PFCF"])

        if same_currency:
            for col in cols[:5]:
                px_y = price_near(close, col)
                sh_y = col_val(shares, col) or sh_now
                if not px_y or not sh_y:
                    continue
                cap_y = px_y * sh_y
                metric = {
                    "PE": col_val(ni, col), "PS": col_val(rev, col), "PB": col_val(eq, col),
                    "PFCF": fcf_val(col),
                    "EVEBITDA": col_val(ebitda, col) or col_val(ebit, col),
                }
                d_, c_ = col_val(debt, col) or 0, col_val(cash, col) or 0
                for k in MULTS:
                    m = metric[k]
                    if m is None or m <= 0:
                        series[k].append(None)
                        continue
                    numer = (cap_y + d_ - c_) if k == "EVEBITDA" else cap_y
                    series[k].append(clean_mult(numer / m, CAP[k]))

        # CEDEAR sin mapear (precio ARS del CEDEAR, balances en otra moneda): los
        # valores "actual" de Yahoo para el .BA no sirven -> se descarta todo.
        if sym.endswith(".BA") and not same_currency:
            continue

        # si Yahoo no trae el multiplo actual pero la reconstruccion si, uso el ultimo ejercicio
        for k in MULTS:
            if actual[k] is None and series[k] and series[k][0] is not None:
                actual[k] = series[k][0]

        # medias moviles
        mm = {}
        if close is not None and len(close) >= 10:
            for lbl, w in (("MM21_sem", 21), ("MM50_sem", 50), ("MM200_sem", 200)):
                mm[lbl] = round(float(close.rolling(w).mean().iloc[-1]), 2) if len(close) >= w else None

        return {
            "ticker_usado": sym,
            "empresa": info.get("longName") or info.get("shortName") or "",
            "sector":  info.get("sector") or "",
            "moneda":  info.get("currency") or "",
            "precio":  price,
            "actual":  actual,
            "series":  series,
            "mm":      mm,
        }
    return None


# ---------------------------------------------------------------------------
COLS = ["Ticker", "Ticker_usado", "Empresa", "Sector", "Moneda", "Precio_actual"]
for k in MULTS:
    COLS += [f"{k}_actual", f"{k}_prom_3y", f"{k}_prom_5y", f"{k}_prom_10y"]
COLS += ["MM21_sem", "MM50_sem", "MM200_sem", "Estado", "Fuente", "Actualizado"]


def row_from_cache(ticker, e):
    r = {c: None for c in COLS}
    r["Ticker"] = ticker
    r["Fuente"] = "yfinance"
    if not e:
        r["Estado"] = "NO_ENCONTRADO"
        return r
    r["Ticker_usado"] = e.get("ticker_usado") or ticker
    r["Empresa"] = e.get("empresa")
    r["Sector"]  = e.get("sector")
    r["Moneda"]  = e.get("moneda")
    r["Precio_actual"] = e.get("precio")
    r["Actualizado"]   = e.get("fetched")
    series = e.get("series", {})
    actual = e.get("actual", {})
    any_mult = False
    for k in MULTS:
        vals = series.get(k, [])
        a = actual.get(k)
        p3, p5 = avg(vals, 3), avg(vals, 5)
        # backstop: un promedio que se despega >8x (o <1/8) del actual casi seguro
        # es error de dato (moneda mal etiquetada, unidades) -> se descarta
        if a:
            if p3 and not (0.12 <= p3 / a <= 8):
                p3 = None
            if p5 and not (0.12 <= p5 / a <= 8):
                p5 = None
        r[f"{k}_actual"]  = a
        r[f"{k}_prom_3y"] = p3
        r[f"{k}_prom_5y"] = p5
        r[f"{k}_prom_10y"] = None
        if a is not None or p5 is not None:
            any_mult = True
    mm = e.get("mm", {})
    r["MM21_sem"]  = mm.get("MM21_sem")
    r["MM50_sem"]  = mm.get("MM50_sem")
    r["MM200_sem"] = mm.get("MM200_sem")
    has_mm = any(mm.get(k) is not None for k in ("MM21_sem", "MM50_sem", "MM200_sem"))
    r["Estado"] = "OK" if any_mult else ("SIN_DATOS" if (has_mm or e.get("sector")) else "NO_ENCONTRADO")
    return r


def write_xlsx(cache, tickers):
    rows = [row_from_cache(t, cache[t]) for t in tickers if t in cache]
    if not rows:
        print("\n(cache vacio todavia — no se reescribe el .xlsx)")
        return
    df = pd.DataFrame(rows, columns=COLS)
    os.makedirs(os.path.dirname(OUT_XLSX), exist_ok=True)
    df.to_excel(OUT_XLSX, index=False, sheet_name="valuacion")
    ok = sum(1 for r in rows if r["Estado"] == "OK")
    print(f"\n{OUT_XLSX} -> {len(rows)} filas ({ok} con multiplos)")


def main():
    only = [a.strip().upper() for a in sys.argv[1:]]
    tickers = only or load_tickers()
    cache = load_cache()
    today = datetime.date.today().isoformat()

    pend = tickers if only else [t for t in tickers if not is_fresh(cache.get(t))]
    print(f"{len(tickers)} tickers · {len(pend)} a actualizar")

    for i, t in enumerate(pend, 1):
        print(f"[{i}/{len(pend)}] {t} ...", end=" ", flush=True)
        try:
            e = build_entry(t)
        except Exception as ex:
            e = None
            print(f"(error {ex})", end=" ")
        if e is None:
            cache[t] = {"ticker_usado": t, "empresa": "", "sector": "", "moneda": "",
                        "precio": None, "actual": {}, "series": {}, "mm": (cache.get(t) or {}).get("mm", {}),
                        "fetched": today}
            print("sin datos")
        else:
            e["fetched"] = today
            cache[t] = e
            n3 = sum(1 for k in MULTS if avg(e["series"].get(k, []), 3) is not None)
            print(f"({e['ticker_usado']}) {e.get('sector') or '?'} · {n3}/5 multiplos · "
                  f"{'mm' if e['mm'].get('MM50_sem') else 'sin-mm'}")
        if i % 12 == 0:
            save_cache(cache)

    save_cache(cache)
    write_xlsx(cache, tickers)


if __name__ == "__main__":
    main()
