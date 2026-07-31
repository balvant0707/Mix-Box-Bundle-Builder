SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'combo_box'
    AND COLUMN_NAME = 'bundlePriceType'
);

SET @statement = IF(
  @column_exists = 0,
  'ALTER TABLE `combo_box` ADD COLUMN `bundlePriceType` VARCHAR(10) NOT NULL DEFAULT ''manual''',
  'SELECT 1'
);

PREPARE stmt FROM @statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
