@echo off
REM ===========================================================================
REM  MAPFINDER - Demarrage sous Windows
REM  Aucune installation complexe : un simple serveur local suffit.
REM  Les recherches, cartes et photographies necessitent Internet.
REM ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title MAPFINDER - serveur local
cd /d "%~dp0"

echo.
echo  ============================================================
echo    MAPFINDER - Recherche et geolocalisation de batiments
echo  ============================================================
echo.

REM --- 1. Python disponible ? (le plus courant, aucune installation requise en general)
where python >nul 2>&1
if %ERRORLEVEL%==0 goto run_python

where py >nul 2>&1
if %ERRORLEVEL%==0 (
    set "PYCMD=py -3"
    goto run_python_with
)

REM --- 2. Node.js disponible ?
where node >nul 2>&1
if %ERRORLEVEL%==0 goto run_node

REM --- 3. PowerShell seul : mini serveur HTTP embarque
goto run_powershell

:run_python
set "PYCMD=python"
:run_python_with
echo  Serveur : %PYCMD% (Python detecte)
echo  Adresse : http://localhost:8000
echo.
echo  Fermez cette fenetre pour arreter le serveur.
echo.
start "" "http://localhost:8000/"
%PYCMD% serve.py --port 8000 --no-browser
if errorlevel 1 (
    echo.
    echo  Le port 8000 est peut-etre deja utilise. Nouvelle tentative sur le port 8080...
    %PYCMD% serve.py --port 8080 --no-browser
)
goto end

:run_node
echo  Serveur : Node.js detecte (serveur minimal integre)
echo  Adresse : http://localhost:8000
echo.
echo  Fermez cette fenetre pour arreter le serveur.
echo.
start "" "http://localhost:8000/"
node server.js
goto end

:run_powershell
echo  Ni Python ni Node.js n'ont ete trouves : utilisation de PowerShell.
echo  Adresse : http://localhost:8000
echo.
echo  Fermez cette fenetre pour arreter le serveur.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
goto end

:end
echo.
echo  Serveur arrete.
pause
