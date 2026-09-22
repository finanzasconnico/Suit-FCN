"""
Actualizacion DIARIA y liviana de precio + tecnico (Nico, 23/09/2026).

Por que existe: la corrida completa (valuacion_multiplos.py) corre 1 vez por semana. Entre un
lunes y el siguiente el precio de cada activo se mueve, y con eso se desactualizan la Tendencia
y sobre todo el Rebote tecnico -- justo los dos ejes que mas pesan en el horizonte "Corto plazo"
del puntaje (ver Valuacion_Multiplos_FCN.html). Este script corre TODOS LOS DIAS HABILES y SOLO
re-baja precio + medias moviles + retornos de yfinance -- 3 llamadas por ticker (info + historico
semanal + historico diario) en vez de las 7 de la corrida completa (sin income_stmt/balance_sheet/
cashflow/splits, que son las llamadas caras y las que hacen falta para reconstruir los promedios
de 3/5/10 años). Esos promedios y los datos de negocio (Rev_CAGR, NI_pos, etc.) quedan tal cual
del ultimo lunes -- son los ejes lentos, no hace falta pedirselos a Yahoo todos los dias, y así
el job es liviano y rapido.

Corre en el runner de GitHub Actions (la nube de GitHub), no en tu compu -- se ejecuta igual esté
tu computadora prendida, apagada, o el navegador cerrado. Ver .github/workflows/
valuacion_multiplos_diario.yml.

Reusa las funciones y constantes de valuacion_multiplos.py (mismo cache, mismo .xlsx, misma
formula de cada media/retorno) para que nunca queden dos implementaciones que se puedan
desincronizar -- si mañana cambia una formula ahí, esta corrida la hereda sola.

Limitacion conocida: PFCF_actual (precio / flujo de caja libre) necesita el estado de flujo de
caja, que este script no pide -- queda con el valor de la ultima corrida completa (el lunes).
Los otros 4 multiplos (PE, PS, PB, EV/EBITDA) SI se refrescan a diario porque salen directo de
info, sin pedir estados contables.

Uso: python .github/scripts/valuacion_multiplos_precio.py
"""
import datetime
import sys
import time

import yfinance as yf

from valuacion_multiplos import (
    CACHE_VER, CAP, MULTS, THROTTLE,
    clean_mult, load_cache, load_tickers, num, save_cache, write_xlsx,
)


def precio_liviano(sym):
    """(info, cierres_semanales, cierres_diarios) -- SIN income_stmt/balance_sheet/cashflow/splits."""
    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        if not (info.get("currentPrice") or info.get("regularMarketPrice")):
            return None
        hist = t.history(period="max", interval="1wk", auto_adjust=True)
        close = hist["Close"].dropna() if hist is not None and not hist.empty else None
        hist_d = t.history(period="2y", interval="1d", auto_adjust=True)
        close_d = hist_d["Close"].dropna() if hist_d is not None and not hist_d.empty else None
        return info, close, close_d
    except Exception:
        return None


def actualizar(e, sym):
    """Pisa e['precio'], e['actual'] (menos PFCF) y e['mm'] con datos de HOY. True si pudo."""
    got = precio_liviano(sym)
    if not got:
        return False
    info, close, close_d = got
    price = num(info.get("currentPrice") or info.get("regularMarketPrice"))
    if not price:
        return False

    e["precio"] = price
    actual = e.setdefault("actual", {})
    actual["PE"] = clean_mult(info.get("trailingPE"), CAP["PE"])
    actual["PS"] = clean_mult(info.get("priceToSalesTrailing12Months"), CAP["PS"])
    actual["PB"] = clean_mult(info.get("priceToBook"), CAP["PB"])
    actual["EVEBITDA"] = clean_mult(info.get("enterpriseToEbitda"), CAP["EVEBITDA"])
    # PFCF actual: no se refresca acá (ver limitación en el docstring) -- se deja el de la
    # última corrida completa, salvo que nunca se haya podido calcular, en cuyo caso se
    # completa con el primer valor de la serie histórica (misma regla que build_entry).
    if actual.get("PFCF") is None:
        serie_pfcf = (e.get("series") or {}).get("PFCF") or []
        if serie_pfcf and serie_pfcf[0] is not None:
            actual["PFCF"] = serie_pfcf[0]

    # medias móviles + momentum -- MISMAS fórmulas que build_entry (valuacion_multiplos.py)
    mm = e.setdefault("mm", {})
    if close is not None and len(close) >= 10:
        for lbl, w in (("MM21_sem", 21), ("MM50_sem", 50), ("MM200_sem", 200)):
            if len(close) >= w:
                mm[lbl] = round(float(close.rolling(w).mean().iloc[-1]), 2)
        last = float(close.iloc[-1])

        def ret(weeks_back):
            if len(close) <= weeks_back:
                return None
            past = float(close.iloc[-1 - weeks_back])
            return round(last / past - 1, 4) if past > 0 else None

        mm["Ret_3m"] = ret(13)
        mm["Ret_6m"] = ret(26)
        mm["Ret_12m"] = ret(52)

        win = close.iloc[-52:] if len(close) >= 52 else close
        hi = float(win.max())
        hi_info = num(info.get("fiftyTwoWeekHigh"))
        if hi_info and hi_info > hi:
            hi = hi_info
        mm["Dist_max_52s"] = round(price / hi - 1, 4) if hi > 0 else None

        lo = float(win.min())
        lo_info = num(info.get("fiftyTwoWeekLow"))
        if lo_info and lo_info < lo:
            lo = lo_info
        mm["Max_52s"] = round(hi, 2)
        mm["Min_52s"] = round(lo, 2)

        if len(close) >= 20:
            mm["MM20_sem"] = round(float(close.rolling(20).mean().iloc[-1]), 2)

        try:
            close_m = close.copy()
            if close_m.index.tz is not None:
                close_m.index = close_m.index.tz_localize(None)
            close_m = close_m.resample("ME").last().dropna()
            if len(close_m) >= 20:
                mm["MM20_mes"] = round(float(close_m.rolling(20).mean().iloc[-1]), 2)
            if len(close_m) >= 50:
                mm["MM50_mes"] = round(float(close_m.rolling(50).mean().iloc[-1]), 2)
        except Exception:
            pass

    if close_d is not None and len(close_d) >= 200:
        mm["MM200_dia"] = round(float(close_d.rolling(200).mean().iloc[-1]), 2)

    # si Yahoo no trae el múltiplo actual (PE/PS/PB/EVEBITDA) pero hay serie histórica, se
    # usa el último ejercicio conocido -- misma regla de respaldo que build_entry.
    series = e.get("series") or {}
    for k in MULTS:
        if actual.get(k) is None and series.get(k) and series[k][0] is not None:
            actual[k] = series[k][0]
    return True


def main():
    # sys.argv[1:] = probar con una lista chica de tickers a mano, ej:
    #   python .github/scripts/valuacion_multiplos_precio.py AAPL MSFT GGAL
    only = [a.strip().upper() for a in sys.argv[1:]]
    tickers = load_tickers()
    cache = load_cache()
    hoy = datetime.date.today().isoformat()

    # solo los que ya tienen una entrada buena de la corrida completa (con esta versión de
    # caché y un precio conocido) -- sin eso no hay sector/serie histórica para completar la
    # fila, y build_entry (la corrida completa semanal) ya se encarga de esos casos.
    universo = only or tickers
    objetivo = [t for t in universo if cache.get(t) and cache[t].get("v") == CACHE_VER and cache[t].get("precio") is not None]
    print(f"{len(objetivo)}/{len(tickers)} tickers con base -> refresco precio/técnico de hoy ({hoy})")

    ok = 0
    for i, t in enumerate(objetivo, 1):
        e = cache[t]
        sym = e.get("ticker_usado") or t
        try:
            if actualizar(e, sym):
                e["fetched_precio"] = hoy
                ok += 1
                print(f"[{i}/{len(objetivo)}] {t} ({sym}) OK — {e['precio']}")
            else:
                print(f"[{i}/{len(objetivo)}] {t} ({sym}) sin precio nuevo, queda el anterior")
        except Exception as ex:
            print(f"[{i}/{len(objetivo)}] {t} ({sym}) error: {ex}")
        time.sleep(THROTTLE)
        if i % 25 == 0:
            save_cache(cache)

    save_cache(cache)
    write_xlsx(cache, tickers)
    print(f"\n{ok}/{len(objetivo)} actualizados hoy {hoy}")


if __name__ == "__main__":
    main()
