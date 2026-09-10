#!/usr/bin/env python3
"""
Extrae el JS embebido en los <script> de cada herramienta HTML de la Suite
hacia graphify-src/<nombre>.js, para que /graphify lo parsee con AST real
(tree-sitter no tiene gramatica de HTML, asi que sin este paso los .html
quedan como "documentos" y no como codigo).

- Solo toma <script> inline (sin atributo src=) y de tipo JS.
- Concatena todos los bloques de un HTML en un unico .js.
- Alinea la numeracion de lineas del primer bloque con la del HTML original
  (rellena con lineas en blanco), asi los L### del grafo aproximan al .html.
- Es idempotente: reescribe graphify-src/ entero en cada corrida.

Uso:  python .github/scripts/graphify_extraer_scripts.py
"""
from __future__ import annotations
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "graphify-src"

# Carpetas que no son produccion (viejas / dev) — no van al grafo.
# (los datos de clientes ya quedan afuera solos: usamos `git ls-files`, que
#  respeta el .gitignore, y ese bloquea inactivas/, intrade/, Reportes cltes/, etc.)
EXCLUDE_DIRS = {"_to_delete", "En desarrollo", "graphify-out", "graphify-src", "node_modules"}

SCRIPT_RE = re.compile(
    r"<script\b(?P<attrs>[^>]*)>(?P<body>.*?)</script\s*>",
    re.IGNORECASE | re.DOTALL,
)
SRC_ATTR_RE = re.compile(r"""\bsrc\s*=""", re.IGNORECASE)
TYPE_ATTR_RE = re.compile(r"""\btype\s*=\s*['"]?([^'">\s]+)""", re.IGNORECASE)
JS_TYPES = {"", "text/javascript", "application/javascript", "module", "text/babel"}


def iter_html_files():
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "-z", "*.html"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.split("\0")
    except (subprocess.CalledProcessError, FileNotFoundError):
        # sin git: fallback a rglob (menos seguro, avisa)
        print("  aviso: git no disponible, usando rglob (revisa que no entren datos de clientes)")
        tracked = [str(p.relative_to(REPO)) for p in REPO.rglob("*.html")]

    for rel in sorted(f for f in tracked if f):
        p = REPO / rel
        if set(p.relative_to(REPO).parts[:-1]) & EXCLUDE_DIRS:
            continue
        if p.exists():
            yield p


def extract(html_path: Path) -> str | None:
    text = html_path.read_text(encoding="utf-8", errors="replace")
    blocks: list[tuple[int, str]] = []  # (linea_inicio_en_html, codigo)
    for m in SCRIPT_RE.finditer(text):
        attrs = m.group("attrs") or ""
        if SRC_ATTR_RE.search(attrs):
            continue  # libreria externa
        tmatch = TYPE_ATTR_RE.search(attrs)
        stype = (tmatch.group(1).lower() if tmatch else "")
        if stype not in JS_TYPES:
            continue  # application/json, text/template, etc.
        body = m.group("body")
        if not body.strip():
            continue
        start_line = text.count("\n", 0, m.start("body")) + 1
        blocks.append((start_line, body))

    if not blocks:
        return None

    parts: list[str] = []
    first_line = blocks[0][0]
    # Alinear el primer bloque con su linea real en el .html
    if first_line > 1:
        parts.append("\n" * (first_line - 1))
    for i, (ln, code) in enumerate(blocks):
        if i > 0:
            parts.append(
                f"\n\n// ---- {html_path.name}: <script> #{i + 1} "
                f"(linea ~{ln} del HTML) ----\n"
            )
        parts.append(code.strip("\n"))
    return "".join(parts) + "\n"


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    written = 0
    for html in iter_html_files():
        js = extract(html)
        if js is None:
            continue
        rel = html.relative_to(REPO)
        slug = "__".join(rel.parts).removesuffix(".html").replace(" ", "_")
        (OUT / f"{slug}.js").write_text(js, encoding="utf-8")
        written += 1
        print(f"  {rel}  ->  graphify-src/{slug}.js")

    # Copiar tambien el JS suelto que ya es codigo de verdad
    for extra in ("fcn-byma.js",):
        src = REPO / extra
        if src.exists():
            shutil.copy2(src, OUT / extra)
            written += 1
            print(f"  {extra}  ->  graphify-src/{extra}")

    print(f"\n{written} archivo(s) en graphify-src/")
    print("Ahora: python -m graphify graphify-src")
    return 0


if __name__ == "__main__":
    sys.exit(main())
