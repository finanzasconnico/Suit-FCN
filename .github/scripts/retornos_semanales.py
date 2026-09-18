"""
Retornos semanales por ticker (ultimos ~3 años) para la pestaña "Correlación" de
Valuacion_Multiplos_FCN.html.

Lee la lista de tickers (y su simbolo de Yahoo, columna Ticker_usado) de
data/valuacion_multiplos.xlsx -- el mismo universo que el resto del panel -- y escribe
data/retornos_semanales.json. NO tiene datos de clientes: se puede publicar igual que
los otros archivos de data/.

Por que retornos y no la matriz de correlaciones ya calculada: con los retornos el
panel puede calcular la correlacion de CUALQUIER cartera (la de un cliente, o una que
se arma a mano en el momento) sin volver a pedirle nada a Yahoo, y ponderar por peso.

Formato (compacto, ~300 KB):
  {"generado": "2026-09-18", "fechas": ["2023-09-18", ...],
   "ret": {"AAPL": [120, -45, null, ...], ...}}
  retorno = variacion semanal del cierre AJUSTADO (incluye dividendos), en puntos basicos
  (120 = +1,20%). null = no hubo dato esa semana. `fechas` y cada serie tienen el mismo largo.

Los .BA (acciones argentinas) cotizan en pesos: su correlacion con activos en dolares
mezcla el efecto del tipo de cambio. El panel los marca.

Uso:  python .github/scripts/retornos_semanales.py
"""
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[2]
XLSX = ROOT / "data" / "valuacion_multiplos.xlsx"
OUT = ROOT / "data" / "retornos_semanales.json"

PERIODO = "3y"        # ~156 semanas: ventana estandar para correlaciones de cartera
LOTE = 40             # tickers por descarga
MIN_SEMANAS = 52      # con menos de 1 año de retornos la correlacion no es confiable -> se omite


def cierres(simbolos):
    """DataFrame semanal (indice = fecha, columnas = simbolo) de cierres ajustados."""
    df = yf.download(simbolos, period=PERIODO, interval="1wk", auto_adjust=True,
                     group_by="column", threads=True, progress=False)
    if df is None or df.empty:
        return pd.DataFrame()
    c = df["Close"] if "Close" in df.columns.get_level_values(0) else df
    if isinstance(c, pd.Series):
        c = c.to_frame(simbolos[0])
    return c


def main():
    if not XLSX.exists():
        sys.exit(f"No existe {XLSX}")
    d = pd.read_excel(XLSX)
    d = d[d["Estado"].isin(["OK", "SIN_DATOS"])]
    pares = [(str(r["Ticker"]).strip(), str(r["Ticker_usado"]).strip())
             for _, r in d.iterrows() if str(r["Ticker_usado"]).strip() not in ("", "nan")]
    # un mismo simbolo de Yahoo puede servir a mas de un ticker del panel (ej. ADGO y AGRO -> AGRO)
    simbolo_a_tickers = {}
    for t, s in pares:
        if t not in simbolo_a_tickers.setdefault(s, []):
            simbolo_a_tickers[s].append(t)
    simbolos = list(simbolo_a_tickers)
    print(f"{len(simbolos)} simbolos")

    partes = []
    for i in range(0, len(simbolos), LOTE):
        lote = simbolos[i:i + LOTE]
        c = cierres(lote)
        if c.empty:   # un reintento por lote antes de resignarse
            c = cierres(lote)
        if not c.empty:
            partes.append(c)
        print(f"  lote {i // LOTE + 1}/{(len(simbolos) + LOTE - 1) // LOTE}: {0 if c.empty else c.shape[1]} series")
    if not partes:
        sys.exit("Yahoo no devolvio nada")

    # las descargas en lote pierden simbolos sueltos en silencio (pasaba con JNJ, PBR, EA...): se
    # piden de a uno los que quedaron sin datos
    logrados = set()
    for c in partes:
        logrados |= {col for col in c.columns if c[col].notna().sum() > 0}
    faltan = [x for x in simbolos if x not in logrados]
    if faltan:
        print(f"  reintento individual de {len(faltan)} simbolos: {', '.join(faltan[:20])}{'...' if len(faltan) > 20 else ''}")
        for x in faltan:
            c = cierres([x])
            if not c.empty and c.iloc[:, 0].notna().sum() > 0:
                c.columns = [x]
                partes.append(c)

    px = pd.concat(partes, axis=1, sort=True)
    px = px.loc[:, ~px.columns.duplicated()]
    # semanas en que casi nadie cotiza (feriados largos, semana en curso incompleta) ensucian todo
    px = px[px.notna().sum(axis=1) >= max(5, int(px.shape[1] * 0.3))]
    ret = px.pct_change(fill_method=None).iloc[1:]
    # el ultimo dato es la semana en curso (incompleta): se descarta para no contaminar con una barra parcial
    # (la barra semanal lleva la fecha del lunes: hasta el lunes siguiente esta incompleta)
    if len(ret) and (date.today() - ret.index[-1].date()).days < 7:
        ret = ret.iloc[:-1]

    fechas = [x.strftime("%Y-%m-%d") for x in ret.index]
    out = {}
    for s in ret.columns:
        col = ret[s]
        if col.notna().sum() < MIN_SEMANAS:
            continue
        # outliers absurdos (splits mal ajustados, datos rotos): un +-60% semanal en un papel liquido
        # casi siempre es un dato roto y arrastra toda la correlacion
        col = col.where(col.abs() <= 0.6)
        serie = [None if pd.isna(v) else int(round(v * 10000)) for v in col]
        for t in simbolo_a_tickers.get(s, [s]):
            out[t] = serie

    OUT.write_text(json.dumps({"generado": date.today().isoformat(), "fechas": fechas, "ret": out},
                              separators=(",", ":")), encoding="utf-8")
    print(f"OK: {len(out)} tickers x {len(fechas)} semanas -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
