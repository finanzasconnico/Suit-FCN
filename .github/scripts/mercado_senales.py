"""
Señales de mercado para CEDEARs (version simple, a proposito):

  1) RS Rating 1-99 por ticker -> data/rs_cedears.json
     Fuerza relativa de los ultimos 12 meses, con el ultimo trimestre pesando doble. Misma formula
     que publica Ticker&Tape (ver https://tickerandtape.com/methodology/):
         score = 40% * ret 3m + 20% * ret 6m + 20% * ret 9m + 20% * ret 12m
     y despues se rankea en percentil entre todos los tickers del universo (99 = mas fuerte).
     Tambien arma un ranking por sector (promedio del score de sus miembros).
     Usa data/precios_historia.json (la misma historia diaria que ya refresca el job de Valuacion
     por Multiplos) -- no baja nada nuevo de Yahoo.

  2) Proximo balance (earnings) -> data/earnings.json
     Calendario publico de Nasdaq (api.nasdaq.com), dia por dia, para los proximos DIAS_ADELANTE
     dias; se queda con los tickers del universo. Sin datos de clientes.

Universo: data/valuacion_multiplos.xlsx (Moneda USD, no ETF = sin Sector). Los .BA cotizan en
pesos y mezclarian el tipo de cambio con la fuerza relativa, asi que no entran en el ranking.

Uso:  python .github/scripts/mercado_senales.py
"""
import json
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
XLSX = ROOT / "data" / "valuacion_multiplos.xlsx"
HIST = ROOT / "data" / "precios_historia.json"
OUT_RS = ROOT / "data" / "rs_cedears.json"
OUT_EARN = ROOT / "data" / "earnings.json"

DIAS_ADELANTE = 45
MIN_DIAS_HISTORIA = 260       # ~12 meses de ruedas: sin eso no hay RS


def universo():
    d = pd.read_excel(XLSX)
    d = d[d["Estado"].isin(["OK"])]
    out = {}
    for _, r in d.iterrows():
        t = str(r["Ticker"]).strip()
        sector = r["Sector"] if isinstance(r["Sector"], str) else ""
        out[t] = {
            "sector": sector,
            "moneda": str(r["Moneda"]),
            "simbolo": str(r["Ticker_usado"]).strip(),
            "empresa": str(r["Empresa"]),
        }
    return out


def cierre_en_o_antes(fechas, serie, fecha_obj):
    """Ultimo cierre no nulo en o antes de fecha_obj (ISO). None si no hay."""
    # fechas esta ordenada ascendente
    lo, hi = 0, len(fechas) - 1
    idx = -1
    while lo <= hi:
        m = (lo + hi) // 2
        if fechas[m] <= fecha_obj:
            idx = m
            lo = m + 1
        else:
            hi = m - 1
    while idx >= 0:
        if serie[idx] is not None:
            return serie[idx]
        idx -= 1
    return None


def calcular_rs(uni):
    h = json.loads(HIST.read_text(encoding="utf-8"))
    fechas = h["fechas"]
    px = h["px"]
    hoy = datetime.strptime(fechas[-1], "%Y-%m-%d").date()
    objetivos = {m: (hoy - timedelta(days=int(30.4375 * m))).isoformat() for m in (3, 6, 9, 12)}

    filas = {}
    for t, info in uni.items():
        if info["moneda"] != "USD" or not info["sector"]:     # solo acciones en USD (sin ETFs)
            continue
        s = px.get(t)
        if not s or sum(1 for v in s if v is not None) < MIN_DIAS_HISTORIA:
            continue
        ult = cierre_en_o_antes(fechas, s, fechas[-1])
        if not ult:
            continue
        rets = {}
        ok = True
        for m, f in objetivos.items():
            c = cierre_en_o_antes(fechas, s, f)
            if not c:
                ok = False
                break
            rets[m] = ult / c - 1
        if not ok:
            continue
        score = 0.4 * rets[3] + 0.2 * rets[6] + 0.2 * rets[9] + 0.2 * rets[12]
        filas[t] = {"score": score, "r3": rets[3], "r6": rets[6], "r12": rets[12], "sector": info["sector"]}

    # percentil 1-99 (99 = mas fuerte)
    orden = sorted(filas, key=lambda k: filas[k]["score"])
    n = len(orden)
    for i, t in enumerate(orden):
        filas[t]["rs"] = max(1, min(99, int(round(1 + 98 * i / (n - 1))))) if n > 1 else 50

    # ranking por sector
    por_sector = {}
    for t, f in filas.items():
        por_sector.setdefault(f["sector"], []).append(f)
    sectores = []
    for s, lst in por_sector.items():
        if len(lst) < 3:
            continue
        sectores.append({
            "sector": s,
            "n": len(lst),
            "rs": round(sum(x["rs"] for x in lst) / len(lst), 1),
            "r3": round(sum(x["r3"] for x in lst) / len(lst), 4),
            "r12": round(sum(x["r12"] for x in lst) / len(lst), 4),
        })
    sectores.sort(key=lambda x: -x["rs"])
    for i, s in enumerate(sectores, 1):
        s["rank"] = i

    return {
        "generado": date.today().isoformat(),
        "al": fechas[-1],
        "n": n,
        "formula": "40% ret 3m + 20% ret 6m + 20% ret 9m + 20% ret 12m, percentil 1-99 entre acciones USD del universo",
        "rs": {t: {"rs": f["rs"], "r3": round(f["r3"], 4), "r12": round(f["r12"], 4), "sector": f["sector"]}
               for t, f in filas.items()},
        "sectores": sectores,
    }


def _num(txt):
    try:
        return float(str(txt).replace("$", "").replace(",", "").strip())
    except Exception:
        return None


def calcular_earnings(uni):
    por_simbolo = {}
    for t, info in uni.items():
        por_simbolo.setdefault(info["simbolo"].upper(), []).append(t)
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.nasdaq.com",
        "Referer": "https://www.nasdaq.com/",
    })
    prox = {}
    hoy = date.today()
    fallidos = 0
    for i in range(DIAS_ADELANTE + 1):
        f = hoy + timedelta(days=i)
        if f.weekday() >= 5:
            continue
        rows = None
        for intento in range(3):
            try:
                r = s.get("https://api.nasdaq.com/api/calendar/earnings", params={"date": f.isoformat()}, timeout=20)
                rows = (r.json().get("data") or {}).get("rows") or []
                break
            except Exception:
                time.sleep(2)
        if rows is None:
            fallidos += 1
            continue
        for row in rows:
            sim = str(row.get("symbol", "")).upper()
            for t in por_simbolo.get(sim, []):
                if t in prox:
                    continue
                prox[t] = {
                    "fecha": f.isoformat(),
                    "hora": {"time-pre-market": "antes de apertura", "time-after-hours": "después del cierre"}.get(
                        row.get("time"), "sin hora confirmada"),
                    "eps_est": _num(row.get("epsForecast")),
                    "eps_prev": _num(row.get("lastYearEPS")),
                    "trim": row.get("fiscalQuarterEnding") or "",
                }
        time.sleep(0.4)
    return {"generado": hoy.isoformat(), "dias": DIAS_ADELANTE, "dias_fallidos": fallidos, "prox": prox}


def main():
    uni = universo()
    rs = calcular_rs(uni)
    OUT_RS.write_text(json.dumps(rs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"RS: {rs['n']} acciones rankeadas, {len(rs['sectores'])} sectores -> {OUT_RS.name}")

    earn = calcular_earnings(uni)
    # si Nasdaq fallo completo (todos los dias), no pisar el archivo anterior con uno vacio
    if earn["prox"] or not OUT_EARN.exists():
        OUT_EARN.write_text(json.dumps(earn, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Earnings: {len(earn['prox'])} tickers con balance en los proximos {DIAS_ADELANTE} dias "
          f"({earn['dias_fallidos']} dias sin respuesta) -> {OUT_EARN.name}")


if __name__ == "__main__":
    main()
