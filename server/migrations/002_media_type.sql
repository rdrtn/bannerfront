-- Fase 1: tipo de mídia do projeto (divulgação ou avulsa). Define o padrão do nome do ZIP.
ALTER TABLE projects
  ADD COLUMN media text NOT NULL DEFAULT 'avulsa' CHECK (media IN ('divulgacao', 'avulsa'));
