@echo off
cd /d "%~dp0"
echo.
echo  === Sincronizando FCN Suite ===
echo.
echo 1. Guardando cambios en Git...
git add -A
git commit -m "Actualizacion %date% %time%"
echo.
echo    Trayendo lo que subieron los bots (precios, senales)...
git pull --rebase
if errorlevel 1 (
  echo.
  echo  !! No se pudo combinar con lo que hay en GitHub - hay un conflicto.
  echo  !! No se subio nada. Avisale a Claude para que lo resuelva.
  git rebase --abort
  echo.
  pause
  exit /b 1
)
git push
if errorlevel 1 (
  echo.
  echo  !! El push fallo - no se subio nada. Avisale a Claude.
  echo.
  pause
  exit /b 1
)
echo.
echo 2. Publicando en Netlify...
netlify deploy --dir . --prod
echo.
echo  === Listo — cambios en GitHub y en la web ===
echo.
pause
