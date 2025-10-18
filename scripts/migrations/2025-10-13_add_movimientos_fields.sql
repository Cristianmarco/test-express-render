-- Agregar campos de auditoría y referencia a reparaciones en movimientos de stock
ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS reparacion_id TEXT;

