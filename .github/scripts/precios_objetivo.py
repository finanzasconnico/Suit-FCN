"""
Precio actual + precio objetivo (analyst target price) para la lista de tickers en
tickers.txt (misma carpeta), usando Yahoo Finance (via yfinance).

Copia adaptada para correr en GitHub Actions (ver .github/workflows/precios_objetivo.yml) del
script original en "Bot precio objetivo/precios_objetivo.py" (esa carpeta queda gitignored a
propósito porque tiene otras cosas personales al lado — esta es la única versión versionada).
Para cambiar la lista de tickers, editar tickers.txt, no este archivo.

Diferencias con el original, pensadas para correr en CI en vez de en una PC:
- Lee los tickers de tickers.txt en vez de tenerlos hardcodeados acá.
- Escribe el resultado directo en data/precios_objetivo.xlsx (raíz del repo), que es lo que
  ya consume el resto de la Suite (fetchStaticFallback / STATIC_PUBLISH_KEYS).
- La caché de progreso (CACHE_FILE) vive en esta misma carpeta y NO se commitea — en un runner
  de GitHub Actions cada corrida empieza en una VM nueva, así que se resetea sola en cada
  corrida programada (evita el problema de reusar precios objetivo desactualizados de la
  corrida del mes pasado). Sigue sirviendo para retomar si Yahoo corta a mitad de ESTA corrida.

NOTAS IMPORTANTES (heredadas del script original)
---------------------------------------------------
- Yahoo Finance es una fuente NO oficial/no documentada para este uso (no hay API key, no hay
  contrato de soporte). Sirve bien como parámetro de referencia, pero para uso productivo/serio
  convendría una fuente paga (FMP, Finnhub, TipRanks, etc.).
- Muchos papeles 100% locales de Argentina (empresas chicas, sin ADR/CEDEAR) no tienen cobertura
  de analistas -> van a salir con precio actual pero sin precio objetivo, lo cual es normal.
- Para tickers cortos y ambiguos el script puede matchear por accidente una empresa de EE.UU. no
  relacionada. Si algo se ve raro en "Empresa", revisar a mano.
- Riesgo específico de correr esto en GitHub Actions (no existía corriendo desde una PC): Yahoo
  a veces rate-limitea/bloquea más agresivo a IPs de datacenter que a IPs residenciales. Si el
  workflow empieza a fallar sistemáticamente con NO_ENCONTRADO en todo, es la primera sospecha.
"""

import re
import time
import json
from pathlib import Path

import pandas as pd
import yfinance as yf

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]  # .github/scripts -> .github -> raíz del repo

TICKERS_FILE = SCRIPT_DIR / "tickers.txt"
CACHE_FILE = SCRIPT_DIR / ".cache_precios_objetivo.json"  # no se commitea, ver .gitignore
OUTPUT_XLSX = REPO_ROOT / "data" / "precios_objetivo.xlsx"

# Orden de mercados a probar por ticker: "" = como está (USA/global),
# ".BA" = Argentina/BYMA, ".SA" = Brasil/B3
SUFFIXES_TO_TRY = ["", ".BA", ".SA"]

FIELDS = [
    "longName", "shortName", "exchange", "quoteType", "currency",
    "currentPrice", "regularMarketPrice",
    "targetMeanPrice", "targetMedianPrice", "targetHighPrice", "targetLowPrice",
    "numberOfAnalystOpinions", "recommendationKey",
]


def clean_ticker(raw: str):
    """Devuelve (ticker_limpio, nota) sacando sufijos de exportación tipo
    '-Repetido-1-51618-0-1' y '.E' (CEDEAR duplicado del mismo subyacente)."""
    nota = ""
    t = raw.strip().upper()

    m = re.match(r"^([A-Z0-9]+)-REPETIDO-.*$", t)
    if m:
        t = m.group(1)
        nota = "duplicado de exportación, tratado como " + t

    if t.endswith(".E"):
        base = t[:-2]
        nota = (nota + "; " if nota else "") + f"CEDEAR .E, mismo precio/objetivo que {base}"
        t = base

    return t, nota


def load_tickers():
    raw = TICKERS_FILE.read_text(encoding="utf-8")
    return raw.split()


def load_cache():
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return {}


def save_cache(cache):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def fetch_one(ticker_clean, cache):
    """Prueba sufijos en SUFFIXES_TO_TRY hasta encontrar datos. Devuelve dict
    con los campos de FIELDS + 'ticker_usado', o None si no encontró nada."""
    for suf in SUFFIXES_TO_TRY:
        candidate = ticker_clean + suf
        if candidate in cache:
            data = cache[candidate]
        else:
            try:
                info = yf.Ticker(candidate).info
            except Exception:
                info = {}
            data = {k: info.get(k) for k in FIELDS} if info else {}
            cache[candidate] = data
            time.sleep(0.4)  # throttle para no gatillar rate-limit de Yahoo

        price = data.get("currentPrice") or data.get("regularMarketPrice")
        if price:
            data["ticker_usado"] = candidate
            return data
    return None


def main():
    cache = load_cache()
    raw_tickers = load_tickers()

    # Limpiar y deduplicar preservando orden + guardando notas
    seen = {}
    order = []
    for raw in raw_tickers:
        t, nota = clean_ticker(raw)
        if t not in seen:
            seen[t] = {"originales": [raw], "nota": nota}
            order.append(t)
        else:
            seen[t]["originales"].append(raw)

    rows = []
    total = len(order)
    encontrados = 0
    for i, t in enumerate(order, 1):
        print(f"[{i}/{total}] {t} ...", end=" ", flush=True)
        result = fetch_one(t, cache)
        save_cache(cache)  # guardar progreso por si hay que cortar y retomar

        originales = ", ".join(seen[t]["originales"])
        nota = seen[t]["nota"]

        if result is None:
            print("NO ENCONTRADO")
            rows.append({
                "Ticker_original": originales,
                "Ticker_usado": "-",
                "Empresa": "",
                "Precio_actual": None,
                "Moneda": "",
                "Precio_objetivo_promedio": None,
                "Precio_objetivo_minimo": None,
                "Precio_objetivo_maximo": None,
                "N_analistas": None,
                "Recomendacion": "",
                "Estado": "NO_ENCONTRADO",
                "Nota": nota,
            })
            continue

        encontrados += 1
        price = result.get("currentPrice") or result.get("regularMarketPrice")
        print(f"OK ({result.get('ticker_usado')}) precio={price}")

        rows.append({
            "Ticker_original": originales,
            "Ticker_usado": result.get("ticker_usado"),
            "Empresa": result.get("longName") or result.get("shortName") or "",
            "Precio_actual": price,
            "Moneda": result.get("currency"),
            "Precio_objetivo_promedio": result.get("targetMeanPrice") or result.get("targetMedianPrice"),
            "Precio_objetivo_minimo": result.get("targetLowPrice"),
            "Precio_objetivo_maximo": result.get("targetHighPrice"),
            "N_analistas": result.get("numberOfAnalystOpinions"),
            "Recomendacion": result.get("recommendationKey"),
            "Estado": "OK" if result.get("targetMeanPrice") or result.get("targetMedianPrice") else "OK_SIN_TARGET",
            "Nota": nota,
        })

    df = pd.DataFrame(rows)
    OUTPUT_XLSX.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(OUTPUT_XLSX, index=False)
    print(f"\nListo. {encontrados}/{total} encontrados. Guardado en {OUTPUT_XLSX} ({len(df)} filas).")

    # Señal explícita para el workflow: si Yahoo bloqueó todo (0 encontrados con 100+ tickers
    # pedidos), cortar con error en vez de commitear un Excel vacío que rompería el dashboard.
    if total > 50 and encontrados == 0:
        raise SystemExit(
            "0 tickers encontrados de {} — probablemente Yahoo está bloqueando/rate-limiteando "
            "la IP de este runner. No se commitea un archivo vacío.".format(total)
        )


if __name__ == "__main__":
    main()
