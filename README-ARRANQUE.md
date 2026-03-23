# Arranque En Otra PC

## Objetivo

Levantar el sistema en una PC nueva sin mezclar una copia vieja del proyecto con la versión actual.

## Recomendación

No reutilizar una carpeta vieja del proyecto.

Lo más seguro es:
1. renombrar o borrar la carpeta anterior
2. clonar el repo en una carpeta nueva
3. instalar dependencias
4. iniciar el sistema desde esa carpeta limpia

## Clonado limpio

```powershell
git clone https://github.com/Cristianmarco/test-express-render.git
cd test-express-render
```

## Instalar dependencias

```powershell
npm install
```

## Iniciar el sistema

Puerto normal:

```powershell
npm start
```

Si el puerto `3000` está ocupado:

```powershell
$env:PORT=9000
npm start
```

Si se usa `nodemon`:

```powershell
$env:PORT=9000
npx nodemon app.js
```

## URL correcta

Entrar por:

```text
http://localhost:PUERTO/
```

o:

```text
http://localhost:PUERTO/refactor
```

La app ahora redirige al entorno refactor como entrada principal.

## Si aparece la versión vieja

Revisar esto:

1. que estés parado en la carpeta correcta del repo actualizado
2. que no haya otro `node` o `nodemon` levantado desde una carpeta vieja
3. que no estés entrando a un puerto viejo
4. que el navegador no esté usando caché o cookies anteriores

Probar:

1. abrir en incógnito
2. borrar caché del navegador
3. borrar cookies del sitio

## Ver qué puerto está ocupado

```powershell
netstat -ano | findstr :3000
```

o por otro puerto:

```powershell
netstat -ano | findstr :9000
```

## Ver qué proceso usa ese puerto

```powershell
tasklist /FI "PID eq 1234"
```

## Matar un proceso viejo

```powershell
taskkill /PID 1234 /F
```

## Actualizar un repo ya clonado

Si la carpeta ya existe y está sana:

```powershell
git pull origin main
npm install
```

## Regla práctica

Siempre seguir este orden:

1. carpeta limpia
2. `git clone` o `git pull`
3. `npm install`
4. arrancar una sola instancia
5. entrar por `/` o `/refactor`
