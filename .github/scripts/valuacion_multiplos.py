"""
Valuacion por multiplos (P/E, P/S, EV/EBITDA, P/FCF, P/B) actual vs. promedio
historico + medias moviles semanales (21/50/200 ruedas), por ticker.

Fuente de multiplos: Financial Modeling Prep (FMP) — endpoints "stable".
  - stable/profile     -> sector, nombre, moneda
  - stable/ratios      -> serie anual de ratios (free tier: maximo 5 años, SOLO empresas US)
El "multiplo actual" = ratio del ultimo ejercicio fiscal reportado. NO se usa el endpoint
ratios-ttm de FMP: en el free tier devuelve numeros claramente mal para varias empresas
(ej. GOOGL P/E TTM = 16.7 cuando el real ronda 24). El ratio anual es internamente consistente
con la serie historica que promediamos, asi que la comparacion "actual vs promedio" queda
apples-to-apples. Contrapartida: el "actual" puede tener hasta ~12 meses de atraso.

FMP free tier NO cubre ratios de emisores extranjeros (YPF, TEO y varios ADR latam): esos
quedan en Estado=SIN_DATOS (el panel muestra "—"). Igual les calculamos las medias moviles
por Yahoo, asi que la pestaña Tecnico funciona para todos.

Fuente de medias moviles: Yahoo Finance via yfinance (no cuenta contra el limite de FMP).

LIMITE FMP FREE = 250 requests/dia. Con ~319 tickers y 2-3 calls c/u no entra en una
corrida: el script cachea y retoma (igual que precios_objetivo.py). Corre por cron DIARIO,
procesa lo que falta o esta viejo, y corta a MAX_FMP_CALLS por corrida. En ~3 dias queda
completo y despues se mantiene con top-ups chicos. Con un key pago se puede subir el cron a
semanal y sacar el tope (ver MAX_FMP_CALLS).

USO LOCAL (para probar):
    set FMP_API_KEY=xxxxx           (Windows)  /  export FMP_API_KEY=xxxxx  (bash)
    pip install requests yfinance pandas openpyxl --upgrade
    python .github/scripts/valuacion_multiplos.py            # todos los tickers
    python .github/scripts/valuacion_multiplos.py AAPL MSFT  # solo esos (prueba)

El key NUNCA va en un archivo del repo — se pasa por variable de entorno / GitHub Secret.
"""

import os
import re
import sys
import json
import time
import datetime

import requests

try:
    import yfinance as yf
except Exception:
    yf = None

import pandas as pd

# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TICKERS_FILE = os.path.join(HERE, "tickers.txt")
CACHE_FILE   = os.path.join(HERE, ".cache_valuacion_multiplos.json")
OUT_XLSX     = os.path.join(REPO, "data", "valuacion_multiplos.xlsx")

FMP_KEY   = os.environ.get("FMP_API_KEY", "").strip()
FMP_BASE  = "https://financialmodelingprep.com/stable"

FRESH_DAYS      = 6      # no re-consultar FMP si el dato tiene menos de esto
MM_FRESH_DAYS   = 5      # no re-calcular medias moviles si tienen menos de esto
MAX_FMP_CALLS   = 230    # tope por corrida para no pasar el limite diario del free tier
THROTTLE_FMP    = 0.25   # s entre calls a FMP
THROTTLE_YF     = 0.30   # s entre calls a Yahoo

# Tickers locales de Argentina/Brasil -> ADR/simbolo que FMP entiende.
ADR_MAP = {
    "GGAL": "GGAL", "YPFD": "YPF", "PAMP": "PAM", "BMA": "BMA", "LOMA": "LOMA",
    "CRES": "CRESY", "TECO2": "TEO", "CEPU": "CEPU", "EDN": "EDN", "SUPV": "SUPV",
    "BBAR": "BBAR", "TGSU2": "TGS", "TXAR": "TX", "TEO": "TEO", "MIRG": "MIRG",
    "BBD": "BBD", "PBR": "PBR", "ITUB": "ITUB", "ABEV": "ABEV", "GGB": "GGB",
    "SID": "SID", "VALE": "VALE", "UGP": "UGP", "PAGS": "PAGS", "STNE": "STNE",
    "PETR3": "PBR", "BBAS3": "BBAS3", "VALE3": "VALE", "ITUB4": "ITUB", "ABEV3": "ABEV",
    "BBD3": "BBD", "MGLU3": "MGLU3", "B3SA3": "B3SA3",
}

# multiplos que guardamos, y de que campo de FMP salen
RATIO_FIELDS = {
    "PE":       "priceToEarningsRatio",
    "PS":       "priceToSalesRatio",
    "EVEBITDA": "enterpriseValueMultiple",
    "PFCF":     "priceToFreeCashFlowRatio",
    "PB":       "priceToBookRatio",
}


# ---------------------------------------------------------------------------
def load_tickers():
    with open(TICKERS_FILE, encoding="utf-8") as f:
        raw = f.read().split()
    seen, order = set(), []
    for t in raw:
        # limpia sufijos de exportacion tipo "COIN-Repetido-1-51618-0-1"
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


MAX_FMP_TRIES = 4       # tras estos intentos fallidos, se da por SIN_DATOS y no se reintenta

def _days_since(iso):
    try:
        return (datetime.date.today() - datetime.date.fromisoformat(iso)).days
    except Exception:
        return 10**6

def is_fresh(entry):
    """No volver a pegarle a FMP si: (a) ya tenemos multiplos buenos y son recientes, o
    (b) fallo MAX_FMP_TRIES veces (no esta en el free tier) y el ultimo intento es < 30 dias.
    Un fallo por rate-limit (sin incrementar tries) SIEMPRE se reintenta al dia siguiente."""
    if not entry:
        return False
    if entry.get("fmp_ok"):
        return _days_since(entry.get("fetched", "")) < FRESH_DAYS
    if entry.get("fmp_tries", 0) >= MAX_FMP_TRIES:
        return _days_since(entry.get("fetched", "")) < 30
    return False

def mm_is_fresh(entry):
    return bool(entry) and entry.get("mm") and _days_since(entry.get("mm_fetched", "")) < MM_FRESH_DAYS


def clean_mult(x):
    """Un multiplo solo sirve si es un numero positivo y razonable.
    Negativos (perdidas), ceros (dato faltante) y outliers gigantes se descartan
    — en el Excel de referencia NFLX traia P/FCF = 0 / -2022 y ensuciaba todo."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not (0 < v < 1000):
        return None
    return round(v, 2)


def _actual_a_precio_hoy(price, row0, series):
    """price / metrica_por_accion del ultimo ejercicio, para P/E, P/S, P/B, P/FCF.
    Para EV/EBITDA (que no escala lineal con el precio por la deuda) se aproxima
    escalando el multiplo del ejercicio por (precio_hoy / precio_implicito_fiscal)."""
    out = {k: None for k in RATIO_FIELDS}
    try:
        price = float(price)
    except (TypeError, ValueError):
        price = None
    if not price or not row0:
        # sin precio no se puede recalcular -> uso el ratio del ejercicio tal cual
        return {k: (series[k][0] if series.get(k) else None) for k in RATIO_FIELDS}

    per_share = {
        "PE":   row0.get("netIncomePerShare"),
        "PS":   row0.get("revenuePerShare"),
        "PB":   row0.get("bookValuePerShare"),
        "PFCF": row0.get("freeCashFlowPerShare"),
    }
    for k, mps in per_share.items():
        try:
            mps = float(mps)
        except (TypeError, ValueError):
            mps = None
        out[k] = clean_mult(price / mps) if mps and mps > 0 else None

    # EV/EBITDA: escalar el multiplo fiscal por el cambio de precio desde el cierre fiscal
    ev_fy = clean_mult(row0.get("enterpriseValueMultiple"))
    pe_fy = row0.get("priceToEarningsRatio")
    nips  = row0.get("netIncomePerShare")
    try:
        precio_fiscal = float(pe_fy) * float(nips)
    except (TypeError, ValueError):
        precio_fiscal = None
    if ev_fy and precio_fiscal and precio_fiscal > 0:
        out["EVEBITDA"] = clean_mult(ev_fy * price / precio_fiscal)
    else:
        out["EVEBITDA"] = ev_fy
    return out


def avg(vals, n):
    xs = [v for v in vals[:n] if v is not None]
    if len(xs) < max(2, n - 2):   # exigi casi todos los años del horizonte
        return None
    return round(sum(xs) / len(xs), 2)


# ---------------------------------------------------------------------------
class Budget:
    def __init__(self, limit):
        self.left = limit
    def spend(self):
        self.left -= 1
    def out(self):
        return self.left <= 0


def fmp_get(path, budget, **params):
    params["apikey"] = FMP_KEY
    budget.spend()
    try:
        r = requests.get(f"{FMP_BASE}/{path}", params=params, timeout=25)
        time.sleep(THROTTLE_FMP)
        if r.status_code == 429:
            print("  ! FMP 429 (rate limit) — corto la corrida")
            budget.left = 0
            return None
        if not r.ok:
            return None
        data = r.json()
        return data
    except Exception as e:
        print(f"  ! FMP error {path}: {e}")
        return None


def fetch_fmp(ticker, budget):
    """Devuelve dict parcial de cache para el ticker, o None si FMP no lo conoce.
    Si el profile matchea pero no hay serie de ratios (ADR extranjero en free tier,
    ETF, etc.) devuelve el dict igual, con series vacias -> Estado SIN_DATOS."""
    candidates = [ticker]
    if ticker in ADR_MAP and ADR_MAP[ticker] != ticker:
        candidates.append(ADR_MAP[ticker])

    for sym in candidates:
        prof = fmp_get("profile", budget, symbol=sym)
        if budget.out():
            return None
        if not prof or not isinstance(prof, list) or not prof:
            continue
        p = prof[0]

        ratios = fmp_get("ratios", budget, symbol=sym, period="annual", limit=5)
        if budget.out():
            return None
        series = {k: [] for k in RATIO_FIELDS}
        if isinstance(ratios, list):
            for row in ratios:
                for k, field in RATIO_FIELDS.items():
                    series[k].append(clean_mult(row.get(field)))

        # "actual" = multiplo con el PRECIO DE HOY (no el de cierre del ejercicio fiscal, que
        # es lo que trae el ratio anual de FMP y puede estar 6-14 meses atrasado). Se recalcula
        # precio_hoy / metrica_por_accion del ultimo ejercicio. Es como lo hace financecharts:
        # el promedio historico son ratios a precio de cada momento, el "actual" a precio de hoy.
        actual = _actual_a_precio_hoy(p.get("price"),
                                      ratios[0] if isinstance(ratios, list) and ratios else None,
                                      series)

        return {
            "ticker_usado": sym,
            "empresa": p.get("companyName") or "",
            "sector":  p.get("sector") or "",
            "moneda":  p.get("currency") or "",
            "precio":  p.get("price"),
            "actual":  actual,
            "series":  series,
        }
    return None


def fetch_mm(ticker, cached_used):
    """Medias moviles semanales 21/50/200 sobre cierres semanales de Yahoo."""
    if yf is None:
        return {}
    for sym in [cached_used, ticker]:
        if not sym:
            continue
        try:
            h = yf.Ticker(sym).history(period="5y", interval="1wk")
            time.sleep(THROTTLE_YF)
            close = h["Close"].dropna()
            if len(close) < 25:
                continue
            out = {}
            for label, win in (("MM21_sem", 21), ("MM50_sem", 50), ("MM200_sem", 200)):
                if len(close) >= win:
                    out[label] = round(float(close.rolling(win).mean().iloc[-1]), 2)
                else:
                    out[label] = None
            return out
        except Exception:
            continue
    return {}


# ---------------------------------------------------------------------------
COLS = ["Ticker", "Ticker_usado", "Empresa", "Sector", "Moneda", "Precio_actual"]
for k in ("PE", "PS", "EVEBITDA", "PFCF", "PB"):
    COLS += [f"{k}_actual", f"{k}_prom_3y", f"{k}_prom_5y", f"{k}_prom_10y"]
COLS += ["MM21_sem", "MM50_sem", "MM200_sem", "Estado", "Fuente", "Actualizado"]


def row_from_cache(ticker, e):
    r = {c: None for c in COLS}
    r["Ticker"] = ticker
    r["Fuente"] = "FMP"
    if not e:
        r["Estado"] = "NO_ENCONTRADO"
        return r
    r["Ticker_usado"] = e.get("ticker_usado") or ticker
    r["Empresa"] = e.get("empresa")
    r["Sector"] = e.get("sector")
    r["Moneda"] = e.get("moneda")
    r["Precio_actual"] = e.get("precio")
    r["Actualizado"] = e.get("fetched")
    series = e.get("series", {})
    actual = e.get("actual", {})
    any_data = False
    for k in ("PE", "PS", "EVEBITDA", "PFCF", "PB"):
        vals = series.get(k, [])
        r[f"{k}_actual"]  = actual.get(k)
        r[f"{k}_prom_3y"] = avg(vals, 3)
        r[f"{k}_prom_5y"] = avg(vals, 5)
        r[f"{k}_prom_10y"] = avg(vals, 10)   # free tier: casi siempre None (solo 5 años)
        if actual.get(k) is not None or r[f"{k}_prom_5y"] is not None:
            any_data = True
    mm = e.get("mm", {})
    r["MM21_sem"] = mm.get("MM21_sem")
    r["MM50_sem"] = mm.get("MM50_sem")
    r["MM200_sem"] = mm.get("MM200_sem")
    has_mm = any(mm.get(k) is not None for k in ("MM21_sem", "MM50_sem", "MM200_sem"))
    if any_data:
        r["Estado"] = "OK"
    elif has_mm or e.get("sector"):
        r["Estado"] = "SIN_DATOS"      # lo conocemos (sector / medias) pero sin multiplos
    else:
        r["Estado"] = "NO_ENCONTRADO"
    return r


def write_xlsx(cache, tickers):
    # solo los tickers ya procesados (estan en cache). Mientras el primer barrido no termine,
    # el archivo va creciendo 8 -> 130 -> 260 -> 319 en vez de mostrar cientos de filas vacias.
    rows = [row_from_cache(t, cache[t]) for t in tickers if t in cache]
    if not rows:
        print("\n(cache vacio todavia — no se reescribe el .xlsx)")
        return
    df = pd.DataFrame(rows, columns=COLS)
    os.makedirs(os.path.dirname(OUT_XLSX), exist_ok=True)
    df.to_excel(OUT_XLSX, index=False, sheet_name="valuacion")
    ok = sum(1 for r in rows if r["Estado"] == "OK")
    print(f"\n{OUT_XLSX} -> {len(rows)} filas ({ok} con datos)")


def main():
    if not FMP_KEY:
        print("ERROR: falta la variable de entorno FMP_API_KEY")
        sys.exit(1)

    only = [a.strip().upper() for a in sys.argv[1:]]
    tickers = only or load_tickers()
    cache = load_cache()
    today = datetime.date.today().isoformat()
    budget = Budget(MAX_FMP_CALLS if not only else 999)

    # ── FASE 1 · MULTIPLOS (FMP, con tope de calls por el free tier) ──────────
    pend_fmp = [t for t in tickers if not is_fresh(cache.get(t))]
    print(f"{len(tickers)} tickers · FASE 1 FMP: {len(pend_fmp)} pendientes · tope {budget.left} calls")
    done = 0
    for t in pend_fmp:
        if budget.out():
            print(f"  tope de calls alcanzado — el resto sigue mañana ({done} esta corrida)")
            break
        print(f"[FMP {done+1}/{len(pend_fmp)}] {t} ...", end=" ", flush=True)
        res = fetch_fmp(t, budget)
        if budget.out():
            # se acabaron los calls (tope o 429 de FMP) — NO escribo nada para este ticker,
            # asi manaña se reintenta limpio en vez de quedar marcado como "ya procesado"
            print("(corte por limite de FMP)")
            break
        old = cache.get(t) or {}
        if res is None:
            res = {"ticker_usado": t, "empresa": "", "sector": "", "moneda": "",
                   "precio": None, "actual": {}, "series": {}, "no_fmp": True}
        has_mult = any(res.get("series", {}).get(k) for k in RATIO_FIELDS)
        res["mm"] = old.get("mm", {})              # conservo las medias que ya tenga
        res["mm_fetched"] = old.get("mm_fetched")
        res["fetched"] = today
        res["fmp_ok"] = has_mult
        res["fmp_tries"] = old.get("fmp_tries", 0) + 1
        cache[t] = res
        tag = ("OK " + (res.get("sector") or "?")) if has_mult else \
              ("no-FMP" if res.get("no_fmp") else f"sin ratios (intento {res['fmp_tries']}/{MAX_FMP_TRIES})")
        print(f"({res['ticker_usado']}) {tag}")
        done += 1
        if done % 15 == 0:
            save_cache(cache)
    save_cache(cache)

    # ── FASE 2 · MEDIAS MOVILES (yfinance, gratis, SIN tope) ─────────────────
    # No depende del budget de FMP: aunque FMP se corte, el Tecnico queda completo.
    pend_mm = [t for t in tickers if not mm_is_fresh(cache.get(t))]
    print(f"\nFASE 2 medias moviles (Yahoo): {len(pend_mm)} pendientes")
    for i, t in enumerate(pend_mm, 1):
        e = cache.get(t)
        if not e:
            e = {"ticker_usado": t, "empresa": "", "sector": "", "moneda": "",
                 "precio": None, "actual": {}, "series": {}, "no_fmp": True}
            cache[t] = e
        mm = fetch_mm(t, e.get("ticker_usado"))
        if mm:
            e["mm"] = mm
            e["mm_fetched"] = today
        print(f"[MM {i}/{len(pend_mm)}] {t} {'ok' if mm.get('MM50_sem') else 'sin-datos'}")
        if i % 20 == 0:
            save_cache(cache)
    save_cache(cache)

    write_xlsx(cache, tickers)


if __name__ == "__main__":
    main()
