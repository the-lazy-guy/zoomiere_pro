@echo off
title Uninstall ZoomPro
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.zoompro.panel"
if exist "%DEST%" rmdir /s /q "%DEST%"
if exist "%APPDATA%\Adobe\CEP\extensions\com.vinicius.zoompro" rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.vinicius.zoompro"
echo ZoomPro removed. Restart Premiere Pro.
pause
