-- Agrega columnas faltantes para clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS web TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contacto TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'externo';

