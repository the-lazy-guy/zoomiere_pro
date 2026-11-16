@echo off
title Install ZoomPro
set "SRC=%~dp0extension"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.zoompro.panel"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo Could not find the "extension" folder next to this file.
  echo Unzip the whole download first, then run this installer again.
  pause
  exit /b 1
)

echo Installing ZoomPro to:
echo   %DEST%
echo.

rem Allow unsigned CEP panels (needed for panels not installed through Adobe Exchange)
for %%v in (9 10 11 12 13 14 15 16 17 18 19 20 21 22) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

rem Remove older installs
if exist "%APPDATA%\Adobe\CEP\extensions\com.vinicius.zoompro" rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.vinicius.zoompro"
if exist "%DEST%" rmdir /s /q "%DEST%"

mkdir "%DEST%"
xcopy "%SRC%" "%DEST%\" /e /i /y /q >nul

echo Done!
echo.
echo 1. Restart Premiere Pro.
echo 2. Open  Window ^> Extensions ^> ZoomPro
echo.
pause
