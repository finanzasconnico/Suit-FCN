@echo off
cd /d "%~dp0"
echo.
echo  Desplegando FCN Suite en Netlify...
echo.
netlify deploy --dir . --prod
echo.
pause
