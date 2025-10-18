BEGIN;

-- Many-to-many: producto <> familia
CREATE TABLE IF NOT EXISTS producto_familia (
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  familia_id  INTEGER NOT NULL REFERENCES familia(id)   ON DELETE CASCADE,
  PRIMARY KEY (producto_id, familia_id)
);

-- Many-to-many: producto <> categoria
CREATE TABLE IF NOT EXISTS producto_categoria (
  producto_id  INTEGER NOT NULL REFERENCES productos(id)  ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categoria(id)  ON DELETE CASCADE,
  PRIMARY KEY (producto_id, categoria_id)
);

-- Backfill desde columnas existentes (si existen datos históricos)
INSERT INTO producto_familia (producto_id, familia_id)
SELECT id, familia_id FROM productos WHERE familia_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO producto_categoria (producto_id, categoria_id)
SELECT id, categoria_id FROM productos WHERE categoria_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;

