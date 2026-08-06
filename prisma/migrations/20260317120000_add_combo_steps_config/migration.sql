-- Reconstructed migration: the original migration.sql was never committed to
-- version control, though it was applied to the live database (recorded in
-- _prisma_migrations). Verified against the live schema: `combo_box` has a
-- nullable `combo_steps_config` LONGTEXT column, which this file recreates.
ALTER TABLE `combo_box` ADD COLUMN `combo_steps_config` LONGTEXT NULL;
