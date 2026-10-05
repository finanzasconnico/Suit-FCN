"""
Superinvestors: que tienen, compraron y vendieron los fondos famosos (formulario 13F de la SEC).

Escribe data/superinvestors.json para Superinvestors_FCN.html. Sin datos de clientes.

Fuentes (todas publicas y gratis):
  - SEC EDGAR  (data.sec.gov / www.sec.gov): ultimas 2 presentaciones 13F-HR de cada fondo. Piden un
    User-Agent identificado y maximo 10 pedidos por segundo -> pausa de 0,15 s entre pedidos.
  - OpenFIGI (api.openfigi.com): el 13F trae CUSIP, no ticker. Sin API key: 25 pedidos/min de 10
    CUSIP cada uno. El resultado se guarda en data/cusip_ticker.json, asi la proxima corrida solo
    consulta los CUSIP nuevos.

Que se calcula (por fondo, trimestre actual vs. anterior):
  peso de cada posicion, nueva / aumento / reduccion / vendida (por cantidad de acciones),
  y a nivel agregado: mas poseidas, mayores compras, mayores ventas, nuevas posiciones.
Ojo: el 13F sale hasta 45 dias despues del cierre del trimestre y solo incluye acciones/ETF de
EE.UU. (no bonos, ni posiciones cortas, ni el resto de la cartera). Es una foto atrasada.

Solo se re-descarga un fondo si su ultima presentacion cambio (se guarda el accession number).

Uso:  python .github/scripts/superinvestors.py
"""
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "superinvestors.json"
CACHE_CUSIP = ROOT / "data" / "cusip_ticker.json"
CACHE_FONDOS = ROOT / ".github" / "scripts" / ".cache_superinvestors.json"   # posiciones crudas (no se publican en data/)
XLSX = ROOT / "data" / "valuacion_multiplos.xlsx"

UA = {"User-Agent": "FinanzasconNico contacto@finanzasconnico.com", "Accept-Encoding": "gzip, deflate"}
TOP_N = 40          # posiciones guardadas por fondo
MAPEAR_TOP = 60     # CUSIP a resolver a ticker por fondo (union de trimestre actual y anterior)

# (id, fondo, gestor, CIK) -- CIK verificados contra el nombre que devuelve la SEC
FONDOS = [
    ("berkshire", "Berkshire Hathaway", "Warren Buffett", 1067983),
    ("pershing", "Pershing Square", "Bill Ackman", 1336528),
    ("bridgewater", "Bridgewater Associates", "Ray Dalio", 1350694),
    ("tiger", "Tiger Global", "Chase Coleman", 1167483),
    ("coatue", "Coatue Management", "Philippe Laffont", 1135730),
    ("viking", "Viking Global", "Andreas Halvorsen", 1103804),
    ("lonepine", "Lone Pine Capital", "Stephen Mandel", 1061165),
    ("ark", "ARK Invest", "Cathie Wood", 1697748),
    ("elliott", "Elliott Management", "Paul Singer", 1791786),
    ("thirdpoint", "Third Point", "Dan Loeb", 1040273),
    ("appaloosa", "Appaloosa", "David Tepper", 1656456),
    ("duquesne", "Duquesne Family Office", "Stanley Druckenmiller", 1536411),
    ("soros", "Soros Fund Management", "George Soros", 1029160),
    ("baupost", "Baupost Group", "Seth Klarman", 1061768),
    ("icahn", "Icahn Enterprises", "Carl Icahn", 921669),
    ("trian", "Trian Fund Management", "Nelson Peltz", 1345471),
    ("himalaya", "Himalaya Capital", "Li Lu", 1709323),
    ("harris", "Harris Associates (Oakmark)", "Bill Nygren", 813917),
    ("tci", "TCI Fund Management", "Chris Hohn", 1647251),
    ("d1", "D1 Capital Partners", "Dan Sundheim", 1747057),
    ("polen", "Polen Capital", "Polen growth team", 1034524),
    ("hh", "H&H International", "Duan Yongping", 1759760),
    ("gates", "Gates Foundation Trust", "Bill & Melinda Gates", 1166559),
    ("markel", "Markel Group", "Tom Gayner", 1096343),
    ("fundsmith", "Fundsmith", "Terry Smith", 1569205),
    ("akre", "Akre Capital", "Chuck Akre", 1112520),
    ("ruane", "Ruane, Cunniff & Goldfarb (Sequoia)", "Ruane Cunniff", 1720792),
    ("glenview", "Glenview Capital", "Larry Robbins", 1138995),
    ("altimeter", "Altimeter Capital", "Brad Gerstner", 1541617),
    ("maverick", "Maverick Capital", "Lee Ainslie", 934639),
]

_ultimo_pedido_sec = 0.0
S = requests.Session()
S.headers.update(UA)


def sec_get(url, **kw):
    global _ultimo_pedido_sec
    espera = 0.15 - (time.time() - _ultimo_pedido_sec)
    if espera > 0:
        time.sleep(espera)
    for intento in range(4):
        try:
            r = S.get(url, timeout=45, **kw)
            _ultimo_pedido_sec = time.time()
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(2 + intento * 3)
                continue
            r.raise_for_status()
            return r
        except requests.RequestException:
            time.sleep(2 + intento * 3)
    raise RuntimeError(f"no pude bajar {url}")


def ultimos_13f(cik):
    j = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json").json()
    f = j["filings"]["recent"]
    lista = []
    for i, forma in enumerate(f["form"]):
        if forma == "13F-HR":          # se ignoran las enmiendas (13F-HR/A): suelen ser parciales
            lista.append({"acc": f["accessionNumber"][i], "presentado": f["filingDate"][i], "periodo": f["reportDate"][i]})
    return j["name"], lista[:2]


def bajar_posiciones(cik, acc):
    """{cusip: {'n': nombre, 'v': valor USD, 'sh': acciones}} sumando lineas repetidas; sin opciones."""
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/"
    idx = sec_get(base + "index.json").json()
    xmls = [x["name"] for x in idx["directory"]["item"] if x["name"].lower().endswith(".xml") and "primary_doc" not in x["name"].lower()]
    if not xmls:
        raise RuntimeError("sin infotable")
    xmls.sort(key=lambda n: ("infotable" not in n.lower(), n))
    root = ET.fromstring(sec_get(base + xmls[0]).content)
    pos = {}
    for it in root.iter():
        if not it.tag.lower().endswith("infotable"):
            continue
        d = {c.tag.split("}")[-1]: (c.text or "").strip() for c in it}
        if d.get("putCall"):                        # opciones: fuera
            continue
        cusip = d.get("cusip", "").upper()
        if not cusip:
            continue
        sh_el = it.find("{*}shrsOrPrnAmt")
        sh = 0.0
        if sh_el is not None:
            tipo = (sh_el.findtext("{*}sshPrnamtType") or "").strip()
            if tipo == "SH":
                sh = float(sh_el.findtext("{*}sshPrnamt") or 0)
        try:
            val = float(d.get("value", "0"))
        except ValueError:
            val = 0.0
        p = pos.setdefault(cusip, {"n": d.get("nameOfIssuer", ""), "v": 0.0, "sh": 0.0})
        p["v"] += val
        p["sh"] += sh
    return pos


def cargar_json(path, defecto):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return defecto


def resolver_tickers(cusips, cache):
    """OpenFIGI en lotes de 10, ~25 pedidos/min sin API key. Guarda en cache {cusip: ticker|''}."""
    faltan = [c for c in cusips if c not in cache]
    for i in range(0, len(faltan), 10):
        lote = faltan[i:i + 10]
        body = [{"idType": "ID_CUSIP", "idValue": c} for c in lote]
        resp = None
        for intento in range(5):
            try:
                r = requests.post("https://api.openfigi.com/v3/mapping", json=body, timeout=30)
                if r.status_code == 429:
                    time.sleep(30)
                    continue
                r.raise_for_status()
                resp = r.json()
                break
            except requests.RequestException:
                time.sleep(5)
        if resp is None:
            continue
        for c, res in zip(lote, resp):
            datos = res.get("data") or []
            us = [x for x in datos if x.get("exchCode") == "US"] or datos
            cache[c] = (us[0].get("ticker") or "") if us else ""
        time.sleep(2.6)
        if (i // 10) % 10 == 9:
            CACHE_CUSIP.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    return cache


def norm_ticker(t):
    return re.sub(r"[^A-Z0-9]", "", (t or "").upper())


def main():
    previos = cargar_json(CACHE_FONDOS, {})     # id -> {"meta", "accession", "act", "ant"}
    cache = cargar_json(CACHE_CUSIP, {})

    cedears = set()
    if XLSX.exists():
        d = pd.read_excel(XLSX)
        cedears = {str(t).strip().upper() for t in d["Ticker"]}

    crudos = {}      # id -> {"meta":..., "act": pos, "ant": pos}
    for fid, fondo, gestor, cik in FONDOS:
        try:
            nombre_sec, filings = ultimos_13f(cik)
            if not filings:
                print(f"  {fondo}: sin 13F-HR, se omite")
                continue
            act = filings[0]
            ya = previos.get(fid)
            if ya and ya.get("accession") == act["acc"]:
                crudos[fid] = ya
                print(f"  {fondo}: sin cambios ({act['periodo']})")
                continue
            pos_act = bajar_posiciones(cik, act["acc"])
            pos_ant = bajar_posiciones(cik, filings[1]["acc"]) if len(filings) > 1 else {}
            crudos[fid] = {
                "accession": act["acc"],
                "meta": {"id": fid, "fondo": fondo, "gestor": gestor, "cik": cik, "accession": act["acc"],
                         "periodo": act["periodo"], "presentado": act["presentado"],
                         "periodo_ant": filings[1]["periodo"] if len(filings) > 1 else None},
                "act": pos_act, "ant": pos_ant,
            }
            print(f"  {fondo}: {len(pos_act)} posiciones ({act['periodo']})")
        except Exception as e:
            print(f"  {fondo}: ERROR {e}")
            if fid in previos:                       # mantener lo anterior en vez de perder el fondo
                crudos[fid] = previos[fid]
    if not crudos:
        sys.exit("No se pudo bajar ningun fondo")

    # CUSIP a resolver: top por valor de cada fondo (actual y anterior)
    necesarios = set()
    for c in crudos.values():
        for pos in (c["act"], c["ant"]):
            top = sorted(pos.items(), key=lambda kv: -kv[1]["v"])[:MAPEAR_TOP]
            necesarios.update(k for k, _ in top)
    cache = resolver_tickers(sorted(necesarios), cache)
    CACHE_CUSIP.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")

    inversores = []
    agg = {}   # ticker -> {"n","fondos","valor","compra","venta","nuevas"}
    for fid, c in crudos.items():
        act, ant = c["act"], c["ant"]
        total = sum(p["v"] for p in act.values()) or 1.0
        filas = []
        resumen = {"nuevas": 0, "aumentos": 0, "reducciones": 0, "vendidas": 0}
        vendidas = []
        for cusip, p in sorted(act.items(), key=lambda kv: -kv[1]["v"]):
            a = ant.get(cusip)
            if a is None:
                estado, dsh = "nueva", None
            elif p["sh"] > a["sh"] * 1.005:
                estado, dsh = "aumento", (p["sh"] / a["sh"] - 1) if a["sh"] else None
            elif p["sh"] < a["sh"] * 0.995:
                estado, dsh = "reduccion", (p["sh"] / a["sh"] - 1) if a["sh"] else None
            else:
                estado, dsh = "igual", 0.0
            resumen_key = {"nueva": "nuevas", "aumento": "aumentos", "reduccion": "reducciones"}.get(estado)
            if resumen_key:
                resumen[resumen_key] += 1
            tk = norm_ticker(cache.get(cusip, ""))
            px = p["v"] / p["sh"] if p["sh"] else 0
            delta_val = (p["sh"] - (a["sh"] if a else 0)) * px if px else 0
            if tk:
                g = agg.setdefault(tk, {"t": tk, "n": p["n"], "fondos": 0, "valor": 0.0, "compra": 0.0, "venta": 0.0, "nuevas": 0})
                g["fondos"] += 1
                g["valor"] += p["v"]
                if delta_val > 0:
                    g["compra"] += delta_val
                elif delta_val < 0:
                    g["venta"] += -delta_val
                if estado == "nueva":
                    g["nuevas"] += 1
            if len(filas) < TOP_N:
                filas.append({"t": tk or "", "n": p["n"], "v": round(p["v"]), "p": round(100 * p["v"] / total, 2),
                              "e": estado, "d": None if dsh is None else round(dsh, 3),
                              "c": 1 if tk in cedears else 0})
        for cusip, a in sorted(ant.items(), key=lambda kv: -kv[1]["v"]):
            if cusip not in act:
                resumen["vendidas"] += 1
                if len(vendidas) < 10:
                    vendidas.append({"t": norm_ticker(cache.get(cusip, "")), "n": a["n"], "v": round(a["v"])})
                tk = norm_ticker(cache.get(cusip, ""))
                if tk:
                    g = agg.setdefault(tk, {"t": tk, "n": a["n"], "fondos": 0, "valor": 0.0, "compra": 0.0, "venta": 0.0, "nuevas": 0})
                    g["venta"] += a["v"]
        inv = dict(c["meta"])
        inv.update({"valor": round(total), "n_pos": len(act), **resumen, "pos": filas, "vendidas_top": vendidas})
        inversores.append(inv)
    inversores.sort(key=lambda x: -x["valor"])

    def lista(clave, minimo=0, n=25):
        r = [g for g in agg.values() if g[clave] > minimo]
        r.sort(key=lambda g: -g[clave])
        return [{"t": g["t"], "n": g["n"], "fondos": g["fondos"], "valor": round(g["valor"]),
                 "compra": round(g["compra"]), "venta": round(g["venta"]), "nuevas": g["nuevas"],
                 "cedear": g["t"] in cedears} for g in r[:n]]

    salida = {
        "generado": date.today().isoformat(),
        "n_inversores": len(inversores),
        "valor_total": sum(i["valor"] for i in inversores),
        "mas_poseidas": lista("fondos", 0, 30),
        "mayores_compras": lista("compra"),
        "mayores_ventas": lista("venta"),
        "mas_nuevas": lista("nuevas"),
        "inversores": inversores,
    }
    CACHE_FONDOS.write_text(json.dumps(crudos, separators=(",", ":")), encoding="utf-8")
    # si no cambio nada salvo la fecha de generacion, no se reescribe (evita un commit diario vacio)
    anterior = cargar_json(OUT, {})
    if {k: v for k, v in anterior.items() if k != "generado"} == {k: v for k, v in salida.items() if k != "generado"}:
        print("Sin novedades: data/superinvestors.json queda igual")
        return
    OUT.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK {len(inversores)} fondos -> {OUT.name} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
