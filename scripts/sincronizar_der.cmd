@echo off
rem Tarea programada "Catalogo DER" (todos los dias):
rem   1. sube el catalogo de DERCLI 6 a la base
rem   2. revisa los precios de los productos vinculados a proveedores
rem No cerrar la ventana mientras corre: se corta el proceso.
cd /d "%~dp0.."
node scripts\sincronizar_der.js
node scripts\actualizar_precios.js
