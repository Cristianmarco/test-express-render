# Cómo abrir este proyecto en otra PC

## 1. Instalar lo necesario
- **Node.js** (v18 o superior). En la PC original hay instalada v22.15.0.
- **Git**
- **VSCode** (opcional, pero recomendado)

## 2. Clonar el repositorio
Abrí una terminal (en VSCode: Terminal → New Terminal) y corré:

```bash
git clone https://github.com/Cristianmarco/test-express-render.git
cd test-express-render
```

Te va a pedir iniciar sesión con tu cuenta de GitHub, porque es un repo privado.

## 3. Instalar las dependencias

```bash
npm install
```

## 4. Configurar el archivo `.env`

Este archivo **no viene incluido en git** a propósito, porque tiene la conexión a la
base de datos real. El repo trae una plantilla (`.env.example`) que podés copiar:

```bash
cp .env.example .env
```

Y adentro de `.env` completá:

```
DATABASE_URL=postgresql://...
```

con la **misma cadena de conexión a Supabase** que ya tenés en el `.env` de la PC
original. Copiala vos mismo desde ahí (Explorador de archivos o `cat .env` en la
terminal) — no la compartas por chat ni la subas a ningún lado, es información
sensible.

> ⚠️ Importante: al usar el mismo `DATABASE_URL`, esta segunda PC va a trabajar
> contra la **misma base de datos real**, no una copia aparte. Cualquier cambio
> que hagas ahí impacta en los datos de producción.

## 5. (Opcional) `nodemon` para reinicio automático

En la PC original está instalado de forma global (no es una dependencia del
proyecto). Si querés usar `npm run dev` (reinicia el servidor solo al guardar
cambios), instalalo:

```bash
npm install -g nodemon
```

Si no lo instalás, no pasa nada: usás `npm start` en el paso siguiente en vez de
`npm run dev`, simplemente sin recarga automática.

## 6. Arrancar el servidor

```bash
npm start
```

o, con recarga automática (requiere nodemon instalado):

```bash
npm run dev
```

## 7. Entrar al sistema

Abrí el navegador en:

```
http://localhost:3000/refactor
```
