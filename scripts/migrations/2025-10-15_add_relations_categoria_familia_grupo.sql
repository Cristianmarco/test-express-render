-- Add categoria_id to familia (nullable for backward compatibility)
ALTER TABLE IF EXISTS familia
  ADD COLUMN IF NOT EXISTS categoria_id INT NULL;

-- Add familia_id to grupo (nullable for backward compatibility)
ALTER TABLE IF EXISTS grupo
  ADD COLUMN IF NOT EXISTS familia_id INT NULL;

-- Add simple FKs if target tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='categoria') THEN
    ALTER TABLE familia
      ADD CONSTRAINT familia_categoria_fk
      FOREIGN KEY (categoria_id) REFERENCES categoria(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='familia') THEN
    ALTER TABLE grupo
      ADD CONSTRAINT grupo_familia_fk
      FOREIGN KEY (familia_id) REFERENCES familia(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

