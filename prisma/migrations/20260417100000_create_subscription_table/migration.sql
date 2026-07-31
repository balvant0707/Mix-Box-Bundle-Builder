-- CreateTable
CREATE TABLE `subscription` (
  `id` VARCHAR(36) NOT NULL,
  `shop` VARCHAR(255) NOT NULL,
  `plan` VARCHAR(20) NOT NULL DEFAULT 'FREE',
  `status` VARCHAR(20) NOT NULL DEFAULT 'NONE',
  `subscriptionId` VARCHAR(255) NULL,
  `trialEndsAt` DATETIME(3) NULL,
  `currentPeriodEnd` DATETIME(3) NULL,
  `freeActivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `subscription_shop_key`(`shop`),
  INDEX `subscription_shop_idx`(`shop`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
