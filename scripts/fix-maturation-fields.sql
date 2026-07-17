-- =============================================================================
-- Script de referência: campos de maturação e saída da câmara
-- Adicionados na migração: maturation_max_end_date, chamber2_exit_date
-- =============================================================================
-- ATENÇÃO: este script é somente-leitura por padrão.
-- As colunas foram criadas pelo agente via ALTER TABLE (ver seção 3).
-- O UPDATE de backfill na seção 4 é OPCIONAL e marcado explicitamente.
-- =============================================================================


-- 1. INSPEÇÃO: verificar todos os lotes concluídos e estado dos novos campos
SELECT
  id,
  recipe_id,
  status,
  completed_at::date              AS data_conclusao,
  chamber_2_entry_date::date      AS entrada_camara_2,
  maturation_end_date::date       AS fim_maturacao_minima,
  maturation_max_end_date::date   AS fim_maturacao_maxima,  -- NULL para lotes antigos
  chamber2_exit_date::date        AS saida_camara_2         -- NULL para todos (preenchido manualmente)
FROM production_batches
WHERE status = 'completed'
ORDER BY completed_at DESC;


-- 2. CONFIRMAÇÃO: novos campos são NULL para lotes antigos (sem migração automática obrigatória)
SELECT
  COUNT(*)                                      AS total_concluidos,
  COUNT(*) FILTER (WHERE maturation_max_end_date IS NULL) AS sem_fim_maximo,
  COUNT(*) FILTER (WHERE chamber2_exit_date IS NULL)      AS sem_saida_camara
FROM production_batches
WHERE status = 'completed';
-- Resultado esperado antes do backfill: sem_fim_maximo = total_concluidos


-- 3. FALLBACK: comandos ALTER TABLE caso o agente não tenha aplicado as colunas
--    (executar APENAS se a consulta acima falhar com "column does not exist")
-- ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS maturation_max_end_date TIMESTAMP;
-- ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS chamber2_exit_date TIMESTAMP;


-- 4. OPCIONAL — BACKFILL MANUAL de maturation_max_end_date para lotes antigos
--    (descomentar e executar somente se desejado; chamber2_exit_date fica NULL
--     e deve ser preenchido via interface de edição de lote)
--
-- UPDATE production_batches
-- SET maturation_max_end_date = CASE
--   WHEN recipe_id = 'QUEIJO_NINA' THEN started_at + INTERVAL '240 days'
--   ELSE                                started_at + INTERVAL '135 days'
-- END
-- WHERE status = 'completed'
--   AND maturation_end_date IS NOT NULL
--   AND maturation_max_end_date IS NULL;
