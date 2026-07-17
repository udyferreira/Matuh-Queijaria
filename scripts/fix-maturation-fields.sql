-- =============================================================================
-- Script de referência: campos de maturação e saída da câmara
-- Criado após a migração que adicionou maturation_max_end_date e chamber2_exit_date
-- =============================================================================

-- 1. Verificar lotes concluídos e estado atual dos campos
SELECT
  id,
  recipe_id,
  status,
  completed_at::date              AS data_conclusao,
  chamber_2_entry_date::date      AS entrada_camara_2,
  maturation_end_date::date       AS fim_maturacao_minima,
  maturation_max_end_date::date   AS fim_maturacao_maxima,
  chamber2_exit_date::date        AS saida_camara_2
FROM production_batches
WHERE status = 'completed'
ORDER BY completed_at DESC;

-- 2. Backfill: calcular maturation_max_end_date para lotes que já têm
--    maturation_end_date mas ainda não têm o campo máximo preenchido.
--    Fórmula: Nete = started_at + 135 dias | Nina = started_at + 240 dias
UPDATE production_batches
SET maturation_max_end_date = CASE
  WHEN recipe_id = 'QUEIJO_NINA' THEN started_at + INTERVAL '240 days'
  ELSE                                started_at + INTERVAL '135 days'
END
WHERE status = 'completed'
  AND maturation_end_date IS NOT NULL
  AND maturation_max_end_date IS NULL;

-- (Resultado esperado: UPDATE N  — onde N é o nº de lotes concluídos existentes)

-- 3. Confirmar resultado
SELECT
  id,
  recipe_id,
  maturation_end_date::date     AS fim_minimo,
  maturation_max_end_date::date AS fim_maximo,
  chamber2_exit_date            AS saida_camara_2
FROM production_batches
WHERE status = 'completed'
ORDER BY completed_at DESC;

-- 4. chamber2_exit_date permanece NULL para todos os lotes antigos —
--    deve ser preenchido manualmente via interface de edição de lote.
