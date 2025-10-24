-- Agrega columna cliente_codigo a licitaciones y relaciona con clientes(codigo)
ALTER TABLE licitaciones
  ADD COLUMN IF NOT EXISTS cliente_codigo TEXT NULL;

-- Opcional: establecer FK si la tabla clientes existe y el motor lo permite
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'licitaciones_cliente_codigo_fkey'
  ) THEN
    ALTER TABLE licitaciones
      ADD CONSTRAINT licitaciones_cliente_codigo_fkey
      FOREIGN KEY (cliente_codigo)
      REFERENCES clientes(codigo)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END$$;

-- No se fuerza NOT NULL; la UI establecerá "DOTA" por defecto al crear.
