@echo off
REM Regenera el grafo de conocimiento de la Suite (skill /graphify).
REM Correlo despues de tocar el JS de cualquier herramienta .html.
REM Todo local, sin API key, sin costo. Salida en graphify-out\ (raiz del repo)
REM a proposito: es la ruta por defecto que busca /graphify en cualquier chat
REM de Claude Code abierto en este repo (no hace falta pasarle --graph).

cd /d "%~dp0"

echo [1/3] Extrayendo los ^<script^> de cada .html a graphify-src\...
python .github\scripts\graphify_extraer_scripts.py || goto :err

echo.
echo [2/3] Construyendo el grafo (AST, tree-sitter)...
python -m graphify graphify-src --out . --no-label || goto :err

echo.
echo [3/3] Clustering + reporte + visualizacion...
python -m graphify cluster-only . --no-label || goto :err

echo.
echo OK. Abri:  graphify-out\graph.html
echo Reporte:   graphify-out\GRAPH_REPORT.md
echo.
echo (Opcional) Para ponerle nombre a las comunidades, re-logueate el CLI
echo   claude   y despues corre:   python -m graphify label .
goto :eof

:err
echo.
echo ERROR en la regeneracion del grafo (ver arriba).
exit /b 1
