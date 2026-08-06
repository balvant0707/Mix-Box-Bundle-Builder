-- Reconstructed migration: the original migration.sql was created but never
-- filled in / committed, and was never applied to the live database (no row
-- exists in _prisma_migrations). Per its name, this migration was meant to
-- drop the legacy "simple box" and "specific combo box" tables that predated
-- today's SimpleBoxPage/MultipleBoxPage schema. Verified against the live
-- database: neither table exists there today, so these IF EXISTS drops are
-- safe no-ops on every environment (already-migrated or freshly created).
DROP TABLE IF EXISTS `simple_box`;
DROP TABLE IF EXISTS `specific_combo_box`;
