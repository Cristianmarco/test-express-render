@echo off
rem Sube el catalogo de DERCLI 6 a la base (lo ejecuta la tarea programada "Catalogo DER")
cd /d "%~dp0.."
node scripts\sincronizar_der.js
