-- Re-adds bundleImage* columns to SimpleBoxPage/MultipleBoxPage, dropped in
-- 20260806000000_schema_cleanup_drop_dead_tables because they had zero code
-- references at the time. Turned out to be a real, wired-up-in-the-UI-but-
-- never-actually-persisted feature (the admin edit forms have a "Bundle
-- Image" uploader that silently discarded the file before this fix) rather
-- than dead weight — restoring them alongside the save/load code fix.
ALTER TABLE `multiple_box_page` ADD COLUMN `bundleImageData` MEDIUMBLOB NULL,
    ADD COLUMN `bundleImageFileName` VARCHAR(255) NULL,
    ADD COLUMN `bundleImageMimeType` VARCHAR(100) NULL,
    ADD COLUMN `bundleImageUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `simple_box_page` ADD COLUMN `bundleImageData` MEDIUMBLOB NULL,
    ADD COLUMN `bundleImageFileName` VARCHAR(255) NULL,
    ADD COLUMN `bundleImageMimeType` VARCHAR(100) NULL,
    ADD COLUMN `bundleImageUrl` VARCHAR(500) NULL;
