-- Generated via `prisma migrate diff --from-url <live db> --to-schema-datamodel prisma/schema.prisma`
-- (direct DB diff, bypassing the shadow-database replay, because historical
-- migration history has unrelated pre-existing drift on this database that a
-- shadow-DB replay cannot resolve without a destructive reset).
--
-- Drops: ComboBoxProduct, ComboStepImage models (dead — the storefront widget
-- never wrote to them; product selection is now resolved live from the
-- Simple/Multiple Box Page config instead), the orphaned `feedbackmsg` table
-- (no Prisma model, zero code references), shop.accessToken (duplicate of
-- Session.accessToken), shop.announcementEmailSentAt, ComboBox.scopeType /
-- scopeItemsJson (superseded, unused), and 8 unused bundleImage* columns on
-- SimpleBoxPage/MultipleBoxPage.
--
-- Adds: per-shop boxCode uniqueness (was globally unique across all shops),
-- a (shop, orderId, boxId) unique constraint on BundleOrder, and a
-- Session.shop index.

-- DropForeignKey
ALTER TABLE `combo_box_product` DROP FOREIGN KEY `combo_box_product_boxId_fkey`;

-- DropForeignKey
ALTER TABLE `combo_step_image` DROP FOREIGN KEY `combo_step_image_boxId_fkey`;

-- DropIndex
DROP INDEX `combo_box_boxCode_key` ON `combo_box`;

-- AlterTable
ALTER TABLE `combo_box` DROP COLUMN `scopeItemsJson`,
    DROP COLUMN `scopeType`;

-- AlterTable
ALTER TABLE `multiple_box_page` DROP COLUMN `bundleImageData`,
    DROP COLUMN `bundleImageFileName`,
    DROP COLUMN `bundleImageMimeType`,
    DROP COLUMN `bundleImageUrl`;

-- AlterTable
ALTER TABLE `shop` DROP COLUMN `accessToken`,
    DROP COLUMN `announcementEmailSentAt`;

-- AlterTable
ALTER TABLE `simple_box_page` DROP COLUMN `bundleImageData`,
    DROP COLUMN `bundleImageFileName`,
    DROP COLUMN `bundleImageMimeType`,
    DROP COLUMN `bundleImageUrl`;

-- DropTable
DROP TABLE `combo_box_product`;

-- DropTable
DROP TABLE `combo_step_image`;

-- DropTable
DROP TABLE `feedbackmsg`;

-- CreateIndex
CREATE UNIQUE INDEX `bundle_order_shop_orderId_boxId_key` ON `bundle_order`(`shop`, `orderId`, `boxId`);

-- CreateIndex
CREATE UNIQUE INDEX `combo_box_shop_boxCode_key` ON `combo_box`(`shop`, `boxCode`);

-- CreateIndex
CREATE INDEX `session_shop_idx` ON `session`(`shop`);

-- RedefineIndex
DROP INDEX `UninstallFeedback_shop_idx` ON `uninstallfeedback`;
CREATE INDEX `uninstallfeedback_shop_idx` ON `uninstallfeedback`(`shop`);
