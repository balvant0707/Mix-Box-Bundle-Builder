SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'combo_box'
    AND COLUMN_NAME = 'shopifyDiscountId'
);

SET @statement = IF(
  @column_exists = 0,
  'ALTER TABLE `combo_box` ADD COLUMN `shopifyDiscountId` VARCHAR(255) NULL',
  'SELECT 1'
);

PREPARE stmt FROM @statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
