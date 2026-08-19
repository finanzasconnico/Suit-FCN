@echo off
cd /d "%~dp0"
echo.
echo  === Sincronizando FCN Suite ===
echo.
echo 1. Guardando cambios en Git...
git add -A
git commit -m "Actualizacion %date% %time%"
git push
echo.
echo 2. Publicando en Netlify...
netlify deploy --dir . --prod
echo.
echo  === Listo — cambios en GitHub y en la web ===
echo.
pause
