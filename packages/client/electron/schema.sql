-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceCode" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "displayName" TEXT,
    "boundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" DATETIME,
    "appVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "depts" TEXT NOT NULL DEFAULT 'OPTICAL',
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "memberId" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "birthday" DATETIME,
    "gender" TEXT,
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "memberId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "createdByStaffId" TEXT,
    "createdByStoreId" TEXT,
    "createdByDeviceId" TEXT
);

-- CreateTable
CREATE TABLE "PhoneHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "oldPhone" TEXT NOT NULL,
    "newPhone" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "storeId" TEXT,
    "reason" TEXT,
    CONSTRAINT "PhoneHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TierRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "clearEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clearPeriod" TEXT,
    "clearMonth" INTEGER,
    "clearDay" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" DATETIME,
    "registeredBy" TEXT NOT NULL,
    "registeredByName" TEXT NOT NULL,
    "registeredStoreId" TEXT NOT NULL,
    "registeredStoreName" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Member_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "beanBatchId" TEXT,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "operatorMemberId" TEXT,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "syncedAt" DATETIME,
    "origin" TEXT NOT NULL DEFAULT 'CLIENT',
    CONSTRAINT "Ledger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BeanBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "remaining" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "expiresAt" DATETIME,
    "source" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "BeanBatch_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT,
    "content" TEXT,
    "lensBrand" TEXT,
    "lensPrice" INTEGER,
    "frameBrand" TEXT,
    "framePrice" INTEGER,
    "totalAmount" INTEGER,
    "baseAmount" INTEGER NOT NULL DEFAULT 0,
    "reviewDate" DATETIME NOT NULL,
    "reviewerId" TEXT,
    "reviewerName" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "registeredBy" TEXT NOT NULL,
    "registeredByName" TEXT NOT NULL,
    "registeredStoreId" TEXT NOT NULL,
    "registeredStoreName" TEXT NOT NULL,
    "registeredDeviceId" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "voidedAt" DATETIME,
    "discardedAt" DATETIME,
    "revisesExamId" TEXT,
    CONSTRAINT "ExamRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "discountType" TEXT,
    "discountValue" INTEGER,
    "afterDiscount" INTEGER NOT NULL,
    "balanceDeduct" INTEGER NOT NULL DEFAULT 0,
    "beansDeduct" INTEGER NOT NULL DEFAULT 0,
    "beansDeductAmount" INTEGER NOT NULL DEFAULT 0,
    "cashPaid" INTEGER NOT NULL,
    "cashPaidEdited" BOOLEAN NOT NULL DEFAULT false,
    "editReason" TEXT,
    "beansAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "payForMemberId" TEXT,
    "payForMemberName" TEXT,
    "payForMemberCardNo" TEXT,
    "awardMemberId" TEXT,
    "awardMemberName" TEXT,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_examId_fkey" FOREIGN KEY ("examId") REFERENCES "ExamRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "cashPaid" INTEGER NOT NULL,
    "balanceAdded" INTEGER NOT NULL,
    "beansGifted" INTEGER NOT NULL DEFAULT 0,
    "pointsGifted" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recharge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "pages" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AnomalyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "memberName" TEXT,
    "memberCardNo" TEXT,
    "field" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "conflictLedgerIds" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "storeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolvedByName" TEXT,
    "resolveNote" TEXT
);

-- CreateTable
CREATE TABLE "RecycleBinEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entitySnapshot" TEXT NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedBy" TEXT NOT NULL,
    "deletedByName" TEXT NOT NULL,
    "sourceStoreId" TEXT,
    "sourceStoreName" TEXT
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT NOT NULL,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "storeId" TEXT,
    "deviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "lastCursor" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceCode_key" ON "Device"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_code_key" ON "Staff"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_memberId_key" ON "Staff"("memberId");

-- CreateIndex
CREATE INDEX "Staff_name_idx" ON "Staff"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_memberId_key" ON "Customer"("memberId");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_memberId_idx" ON "Customer"("memberId");

-- CreateIndex
CREATE INDEX "PhoneHistory_customerId_idx" ON "PhoneHistory"("customerId");

-- CreateIndex
CREATE INDEX "PhoneHistory_oldPhone_idx" ON "PhoneHistory"("oldPhone");

-- CreateIndex
CREATE UNIQUE INDEX "TierRule_level_key" ON "TierRule"("level");

-- CreateIndex
CREATE UNIQUE INDEX "Member_customerId_key" ON "Member"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_cardNo_key" ON "Member"("cardNo");

-- CreateIndex
CREATE INDEX "Member_cardNo_idx" ON "Member"("cardNo");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "Ledger_memberId_field_idx" ON "Ledger"("memberId", "field");

-- CreateIndex
CREATE INDEX "Ledger_createdAt_idx" ON "Ledger"("createdAt");

-- CreateIndex
CREATE INDEX "Ledger_syncStatus_idx" ON "Ledger"("syncStatus");

-- CreateIndex
CREATE INDEX "Ledger_beanBatchId_idx" ON "Ledger"("beanBatchId");

-- CreateIndex
CREATE INDEX "BeanBatch_memberId_expiresAt_idx" ON "BeanBatch"("memberId", "expiresAt");

-- CreateIndex
CREATE INDEX "ExamRecord_customerId_idx" ON "ExamRecord"("customerId");

-- CreateIndex
CREATE INDEX "ExamRecord_reviewStatus_idx" ON "ExamRecord"("reviewStatus");

-- CreateIndex
CREATE INDEX "ExamRecord_reviewDate_idx" ON "ExamRecord"("reviewDate");

-- CreateIndex
CREATE INDEX "ExamRecord_registeredStoreId_idx" ON "ExamRecord"("registeredStoreId");

-- CreateIndex
CREATE INDEX "ExamRecord_dept_idx" ON "ExamRecord"("dept");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_examId_key" ON "Payment"("examId");

-- CreateIndex
CREATE INDEX "Payment_examId_idx" ON "Payment"("examId");

-- CreateIndex
CREATE INDEX "Payment_payForMemberId_idx" ON "Payment"("payForMemberId");

-- CreateIndex
CREATE INDEX "Payment_awardMemberId_idx" ON "Payment"("awardMemberId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Recharge_memberId_idx" ON "Recharge"("memberId");

-- CreateIndex
CREATE INDEX "Recharge_createdAt_idx" ON "Recharge"("createdAt");

-- CreateIndex
CREATE INDEX "Recharge_storeId_idx" ON "Recharge"("storeId");

-- CreateIndex
CREATE INDEX "ExamTemplate_dept_idx" ON "ExamTemplate"("dept");

-- CreateIndex
CREATE INDEX "Brand_type_idx" ON "Brand"("type");

-- CreateIndex
CREATE INDEX "AnomalyRecord_status_idx" ON "AnomalyRecord"("status");

-- CreateIndex
CREATE INDEX "AnomalyRecord_memberId_idx" ON "AnomalyRecord"("memberId");

-- CreateIndex
CREATE INDEX "RecycleBinEntry_entityType_idx" ON "RecycleBinEntry"("entityType");

-- CreateIndex
CREATE INDEX "RecycleBinEntry_deletedAt_idx" ON "RecycleBinEntry"("deletedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_deviceId_tableName_key" ON "SyncCursor"("deviceId", "tableName");



-- Add columns (a0de7a5 missed these in initial schema.sql; needed for §2.2 versioning + offline mode)
-- Note: these are also added via ALTER TABLE in runMigrations for existing DBs;
-- here only affects fresh DBs created by applySchema.
CREATE INDEX IF NOT EXISTS "ExamRecord_revisesExamId_idx" ON "ExamRecord"("revisesExamId");
CREATE INDEX IF NOT EXISTS "ExamRecord_registeredBy_idx" ON "ExamRecord"("registeredBy");
CREATE INDEX IF NOT EXISTS "Member_registeredAt_idx" ON "Member"("registeredAt");
CREATE INDEX IF NOT EXISTS "Member_registeredStoreId_idx" ON "Member"("registeredStoreId");
CREATE INDEX IF NOT EXISTS "Customer_createdAt_idx" ON "Customer"("createdAt");


-- Add columns (a0de7a5 missed these in initial schema.sql; needed for §2.2 versioning + offline mode)
-- Note: these are also added via ALTER TABLE in runMigrations for existing DBs;
-- here only affects fresh DBs created by applySchema.
CREATE INDEX IF NOT EXISTS "ExamRecord_revisesExamId_idx" ON "ExamRecord"("revisesExamId");
CREATE INDEX IF NOT EXISTS "ExamRecord_registeredBy_idx" ON "ExamRecord"("registeredBy");
CREATE INDEX IF NOT EXISTS "Member_registeredAt_idx" ON "Member"("registeredAt");
CREATE INDEX IF NOT EXISTS "Member_registeredStoreId_idx" ON "Member"("registeredStoreId");
CREATE INDEX IF NOT EXISTS "Customer_createdAt_idx" ON "Customer"("createdAt");
