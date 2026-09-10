"""
Fundamentales historicos oficiales desde SEC EDGAR (companyfacts XBRL).

Gratis, sin API key, sin limite. Cubre lo que se presenta ante la SEC de EE.UU.:
* 10-K  -> acciones US y algunos ADR que reportan como domesticos (MELI).
* 20-F  -> ADR de emisores extranjeros (TX, VIST, GLOB, YPF, PBR, VALE, BABA...),
           solo si presentan las cifras en US-GAAP (los que van en IFRS no entran).
Los .BA puros y varios ADR chicos no estan -> para esos el bot sigue con solo lo
que da yfinance (4-5 años).

Se usa para EXTENDER la reconstruccion de multiplos historicos de ~5 a 15-19 años
y llenar la columna de 10y (hoy vacia). yfinance sigue aportando precios, medias
moviles y el multiplo "actual".

    from edgar_fundamentals import edgar_annuals
    fy = edgar_annuals("AAPL")     # {2016: {rev, ni, eps, eq, ocf, capex, opinc, da,
                                   #         debt, cash, end}, 2017: {...}, ...}  o None

Cache local en .cache_edgar/ (un JSON por CIK, se re-baja si tiene > EDGAR_FRESH_DAYS).
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import date

# Contacto obligatorio en el User-Agent (regla de la SEC). Si no, devuelve 403.
UA = {"User-Agent": "FinanzasconNico Suite research nicostrijland@gmail.com"}

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache_edgar")
EDGAR_FRESH_DAYS = 20
THROTTLE = 0.25          # la SEC pide <= 10 req/s; vamos muy por debajo

# El company_tickers.json apunta a veces a una entidad "shell" creada en una
# reorganizacion, sin historia. CIK real de esos casos:
CIK_OVERRIDE = {
    "XOM": "0000034088",     # ExxonMobil (el default apunta a la holding de 2024)
}

# concepto interno -> tags XBRL candidatos, en orden de preferencia. Se buscan en
# los namespaces us-gaap (10-K, y 20-F que reportan en US-GAAP) e ifrs-full (20-F
# de emisores extranjeros: TX, VIST, GLOB...). Se MERGEA entre tags: un mismo año
# puede venir en "Revenues" (viejo) o "RevenueFromContract..." (post ASC-606, 2018+).
_FORMS = ("10-K", "20-F")

_DUR = {   # magnitudes de flujo (todo el ejercicio)
    "rev":   ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
              "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
              "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense",
              "Revenue", "RevenueFromContractsWithCustomers"],                       # ifrs
    "ni":    ["NetIncomeLoss", "ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
    "eps":   ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted",
              "IncomeLossFromContinuingOperationsPerDilutedShare",
              "DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare"],  # ifrs
    # fallback de acciones cuando la empresa usa un tag propio para el EPS (ej. Visa):
    "wsh":   ["WeightedAverageNumberOfDilutedSharesOutstanding",
              "WeightedAverageNumberOfSharesOutstandingBasic",
              "WeightedAverageShares", "WeightedAverageNumberOfSharesOutstandingDiluted"],
    "ocf":   ["NetCashProvidedByUsedInOperatingActivities",
              "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
              "CashFlowsFromUsedInOperatingActivities"],                             # ifrs
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
              "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",  # ifrs
              "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets"],
    "opinc": ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],           # ifrs
    "da":    ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
              "DepreciationAndAmortization",
              "DepreciationAndAmortisationExpense",                                  # ifrs
              "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss"],
}
_INST = {  # magnitudes de stock (a la fecha de cierre del balance)
    "eq":   ["StockholdersEquity",
             "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
             "EquityAttributableToOwnersOfParent", "Equity"],                        # ifrs
    "cash": ["CashAndCashEquivalentsAtCarryingValue",
             "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
             "CashAndCashEquivalents"],                                             # ifrs
    "debt": ["LongTermDebtAndCapitalLeaseObligations", "LongTermDebt", "LongTermDebtNoncurrent",
             "DebtLongtermAndShorttermCombinedAmount",
             "NoncurrentBorrowings", "Borrowings"],                                 # ifrs
}
_NS = ("us-gaap", "ifrs-full", "dei")


def _fetch(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


_TICKER_CIK = None

def _cik_of(ticker):
    global _TICKER_CIK
    t = ticker.upper()
    if t in CIK_OVERRIDE:
        return CIK_OVERRIDE[t]
    if _TICKER_CIK is None:
        m = _fetch("https://www.sec.gov/files/company_tickers.json") or {}
        _TICKER_CIK = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in m.values()}
    return _TICKER_CIK.get(t)


def _iso(s):
    return date.fromisoformat(s)


def _fy_of(end_date):
    """Ejercicio fiscal al que pertenece un cierre: si cierra en H2 es de ese año,
    si cierra ene-may (fiscal desfasado, ej. AAPL/MSFT/WMT) cuenta como el año anterior."""
    d = _iso(end_date)
    return d.year if d.month >= 6 else d.year - 1


def _nodes_for(facts, tag):
    """Todos los nodos (uno por namespace) que tienen ese tag."""
    return [facts[ns][tag] for ns in _NS if ns in facts and tag in facts[ns]]


def _ok_form(x):
    return str(x.get("form", "")).startswith(_FORMS)


def _merge_dur(facts, tags, earliest=False):
    """{fy: (val, end_date)} de una magnitud de flujo, tomando solo balances anuales
    (10-K / 20-F) y periodos de ~1 año. earliest=True -> valor tal como se reporto
    originalmente (para EPS, que la SEC re-expresa por splits en balances posteriores)."""
    out = {}
    for tag in tags:
        for node in _nodes_for(facts, tag):
            for rows in node.get("units", {}).values():
                for x in rows:
                    if not _ok_form(x):
                        continue
                    s, e = x.get("start"), x.get("end")
                    if not s or not e:
                        continue
                    try:
                        days = (_iso(e) - _iso(s)).days
                    except Exception:
                        continue
                    if not (350 <= days <= 380):
                        continue
                    fy = _fy_of(e)
                    filed = x.get("filed", "")
                    cur = out.get(fy)
                    take = cur is None or (filed < cur[1] if earliest else filed > cur[1])
                    if take:
                        out[fy] = (x["val"], filed, e)
    return {k: (v[0], v[2]) for k, v in out.items()}


def _merge_inst(facts, tags):
    """{fy: (val, end_date)} de una magnitud de stock (ultimo balance del ejercicio)."""
    out = {}
    for tag in tags:
        for node in _nodes_for(facts, tag):
            for rows in node.get("units", {}).values():
                for x in rows:
                    if not _ok_form(x):
                        continue
                    e = x.get("end")
                    if not e:
                        continue
                    fy = _fy_of(e)
                    filed = x.get("filed", "")
                    cur = out.get(fy)
                    if cur is None or filed > cur[1]:
                        out[fy] = (x["val"], filed, e)
    return {k: (v[0], v[2]) for k, v in out.items()}


def _companyfacts(ticker):
    cik = _cik_of(ticker)
    if not cik:
        return None
    os.makedirs(CACHE_DIR, exist_ok=True)
    cf = os.path.join(CACHE_DIR, f"CIK{cik}.json")
    if os.path.exists(cf):
        try:
            with open(cf, encoding="utf-8") as f:
                blob = json.load(f)
            d = date.fromisoformat(blob.get("_fetched", "2000-01-01"))
            if (date.today() - d).days < EDGAR_FRESH_DAYS:
                return blob["data"]
        except Exception:
            pass
    time.sleep(THROTTLE)
    data = _fetch(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    if data is None:
        return None
    try:
        with open(cf, "w", encoding="utf-8") as f:
            json.dump({"_fetched": date.today().isoformat(), "data": data}, f)
    except Exception:
        pass
    return data


def edgar_annuals(ticker):
    """{fy: {rev, ni, eps, eq, ocf, capex, opinc, da, debt, cash, end}} o None.
    fy = año fiscal (int). 'end' = fecha ISO del cierre de ese ejercicio."""
    f = _companyfacts(ticker)
    if not f:
        return None
    facts = f.get("facts", {})
    g = {c: _merge_dur(facts, tags, earliest=(c in ("eps", "wsh"))) for c, tags in _DUR.items()}
    g.update({c: _merge_inst(facts, tags) for c, tags in _INST.items()})

    years = sorted(set(g["rev"]) | set(g["ni"]) | set(g["eq"]))
    if not years:
        return None
    out = {}
    for fy in years:
        row = {}
        for c in ("rev", "ni", "eps", "wsh", "ocf", "capex", "opinc", "da", "eq", "cash", "debt"):
            row[c] = g[c].get(fy, (None, None))[0]
        end = None
        for c in ("ni", "rev", "eq"):
            v = g[c].get(fy)
            if v:
                end = v[1]
                break
        row["end"] = end
        out[fy] = row
    return out


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def edgar_multiple_series(ticker, px_of, splitfac_of, cap):
    """Reconstruye el multiplo de cada ejercicio fiscal con fundamentales de EDGAR
    y precios (via callbacks).

        px_of(iso_date)      -> cierre ajustado mas cercano a esa fecha, o None
        splitfac_of(iso_date)-> producto de splits POSTERIORES a esa fecha (>=1.0)
        cap                  -> dict {"PE":(lo,hi), ...} para descartar valores absurdos

    Devuelve {"PE": {2016: 12.4, 2017: ...}, "PS": {...}, "PB", "PFCF", "EVEBITDA"}
    con hasta ~18 años. {} si EDGAR no cubre el ticker.

    Gate de confiabilidad: las acciones del año se derivan de NI/EPS; si un año da
    un multiplo > 4x la mediana de su serie (EPS en otra unidad, dato raro) ese año
    se descarta. Si quedan < 4 años utiles para P/E, se devuelve {} (mejor yfinance).
    """
    ann = edgar_annuals(ticker)
    if not ann:
        return {}

    # acciones de cada año = NI/EPS, ajustadas por splits al basis de hoy.
    # Si en un año el EPS vino en otra unidad (varios ADR IFRS tienen EPS por ADS
    # o en moneda local), esa "cantidad de acciones" se dispara -> se descarta el año.
    sh = {}
    for fy, d in ann.items():
        ni, eps, end = d.get("ni"), d.get("eps"), d.get("end")
        if not end:
            continue
        if ni and eps:
            s = (ni / eps) * splitfac_of(end)
        elif d.get("wsh"):                       # empresa con tag propio de EPS (Visa)
            s = d["wsh"] * splitfac_of(end)
        else:
            continue
        if s > 0:
            sh[fy] = s
    if len(sh) < 4:
        return {}
    med_sh = _median(list(sh.values()))
    sh = {fy: s for fy, s in sh.items() if med_sh and 0.35 * med_sh <= s <= 2.8 * med_sh}
    if len(sh) < 4:
        return {}

    raw = {k: {} for k in ("PE", "PS", "PB", "PFCF", "EVEBITDA")}
    for fy, d in sorted(ann.items()):
        if fy not in sh:
            continue
        end = d.get("end")
        px = px_of(end)
        ni = d.get("ni")
        if not px:
            continue
        shares = sh[fy]
        cap_y = px * shares
        rev, eq = d.get("rev"), d.get("eq")
        ocf, cx = d.get("ocf"), d.get("capex")
        fcf = (ocf - abs(cx)) if (ocf is not None and cx is not None) else None
        op, da = d.get("opinc"), d.get("da")
        ebitda = (op + da) if (op is not None and da is not None) else None
        debt = d.get("debt") or 0
        cash = d.get("cash") or 0

        vals = {
            "PE": cap_y / ni if (ni and ni > 0) else None,
            "PS": cap_y / rev if (rev and rev > 0) else None,
            "PB": cap_y / eq if (eq and eq > 0) else None,
            "PFCF": cap_y / fcf if (fcf and fcf > 0) else None,
            "EVEBITDA": (cap_y + debt - cash) / ebitda if (ebitda and ebitda > 0) else None,
        }
        for k, v in vals.items():
            if v is None:
                continue
            lo, hi = cap.get(k, (0.1, 1000))
            if lo <= v < hi:
                raw[k][fy] = round(v, 2)

    if len(raw.get("PE", {})) < 4:
        return {}
    return raw


if __name__ == "__main__":
    import sys
    for t in sys.argv[1:] or ["AAPL", "KO", "GOOGL"]:
        a = edgar_annuals(t)
        if not a:
            print(f"{t}: sin datos EDGAR")
            continue
        ys = sorted(a)
        print(f"\n{t}: {len(ys)} años ({ys[0]}-{ys[-1]})")
        for fy in ys[-6:]:
            d = a[fy]
            print(f"  FY{fy} end={d['end']} rev={d['rev'] and round(d['rev']/1e9,1)}B "
                  f"ni={d['ni'] and round(d['ni']/1e9,1)}B eps={d['eps']} eq={d['eq'] and round(d['eq']/1e9,1)}B")
