
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.StoreScalarFieldEnum = {
  id: 'id',
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.DeviceScalarFieldEnum = {
  id: 'id',
  deviceCode: 'deviceCode',
  storeId: 'storeId',
  displayName: 'displayName',
  boundAt: 'boundAt',
  lastSyncAt: 'lastSyncAt',
  appVersion: 'appVersion',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StaffScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  depts: 'depts',
  isMember: 'isMember',
  memberId: 'memberId',
  phone: 'phone',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.CustomerScalarFieldEnum = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  address: 'address',
  birthday: 'birthday',
  gender: 'gender',
  isMember: 'isMember',
  memberId: 'memberId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt',
  createdByStaffId: 'createdByStaffId',
  createdByStoreId: 'createdByStoreId',
  createdByDeviceId: 'createdByDeviceId'
};

exports.Prisma.PhoneHistoryScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  oldPhone: 'oldPhone',
  newPhone: 'newPhone',
  changedAt: 'changedAt',
  changedBy: 'changedBy',
  changedByName: 'changedByName',
  storeId: 'storeId',
  reason: 'reason'
};

exports.Prisma.TierRuleScalarFieldEnum = {
  id: 'id',
  level: 'level',
  name: 'name',
  minPoints: 'minPoints',
  clearEnabled: 'clearEnabled',
  clearPeriod: 'clearPeriod',
  clearMonth: 'clearMonth',
  clearDay: 'clearDay',
  sortOrder: 'sortOrder',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SettingScalarFieldEnum = {
  key: 'key',
  value: 'value',
  updatedAt: 'updatedAt'
};

exports.Prisma.MemberScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  cardNo: 'cardNo',
  status: 'status',
  deletedAt: 'deletedAt',
  registeredBy: 'registeredBy',
  registeredByName: 'registeredByName',
  registeredStoreId: 'registeredStoreId',
  registeredStoreName: 'registeredStoreName',
  registeredAt: 'registeredAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LedgerScalarFieldEnum = {
  id: 'id',
  memberId: 'memberId',
  field: 'field',
  delta: 'delta',
  source: 'source',
  reason: 'reason',
  refType: 'refType',
  refId: 'refId',
  beanBatchId: 'beanBatchId',
  operatorId: 'operatorId',
  operatorName: 'operatorName',
  operatorMemberId: 'operatorMemberId',
  storeId: 'storeId',
  storeName: 'storeName',
  deviceId: 'deviceId',
  createdAt: 'createdAt',
  syncStatus: 'syncStatus',
  syncedAt: 'syncedAt',
  origin: 'origin'
};

exports.Prisma.BeanBatchScalarFieldEnum = {
  id: 'id',
  memberId: 'memberId',
  remaining: 'remaining',
  total: 'total',
  expiresAt: 'expiresAt',
  source: 'source',
  refId: 'refId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  expired: 'expired'
};

exports.Prisma.ExamRecordScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  dept: 'dept',
  templateId: 'templateId',
  templateName: 'templateName',
  content: 'content',
  lensBrand: 'lensBrand',
  lensPrice: 'lensPrice',
  frameBrand: 'frameBrand',
  framePrice: 'framePrice',
  totalAmount: 'totalAmount',
  baseAmount: 'baseAmount',
  reviewDate: 'reviewDate',
  reviewerId: 'reviewerId',
  reviewerName: 'reviewerName',
  reviewStatus: 'reviewStatus',
  reviewNote: 'reviewNote',
  registeredBy: 'registeredBy',
  registeredByName: 'registeredByName',
  registeredStoreId: 'registeredStoreId',
  registeredStoreName: 'registeredStoreName',
  registeredDeviceId: 'registeredDeviceId',
  registeredAt: 'registeredAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.PaymentScalarFieldEnum = {
  id: 'id',
  examId: 'examId',
  baseAmount: 'baseAmount',
  discountType: 'discountType',
  discountValue: 'discountValue',
  afterDiscount: 'afterDiscount',
  balanceDeduct: 'balanceDeduct',
  beansDeduct: 'beansDeduct',
  beansDeductAmount: 'beansDeductAmount',
  cashPaid: 'cashPaid',
  cashPaidEdited: 'cashPaidEdited',
  editReason: 'editReason',
  beansAwarded: 'beansAwarded',
  pointsAwarded: 'pointsAwarded',
  payForMemberId: 'payForMemberId',
  payForMemberName: 'payForMemberName',
  payForMemberCardNo: 'payForMemberCardNo',
  awardMemberId: 'awardMemberId',
  awardMemberName: 'awardMemberName',
  operatorId: 'operatorId',
  operatorName: 'operatorName',
  storeId: 'storeId',
  storeName: 'storeName',
  deviceId: 'deviceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RechargeScalarFieldEnum = {
  id: 'id',
  memberId: 'memberId',
  cardNo: 'cardNo',
  cashPaid: 'cashPaid',
  balanceAdded: 'balanceAdded',
  beansGifted: 'beansGifted',
  pointsGifted: 'pointsGifted',
  note: 'note',
  operatorId: 'operatorId',
  operatorName: 'operatorName',
  storeId: 'storeId',
  storeName: 'storeName',
  deviceId: 'deviceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExamTemplateScalarFieldEnum = {
  id: 'id',
  name: 'name',
  dept: 'dept',
  pages: 'pages',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.BrandScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  sortIndex: 'sortIndex',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.AnomalyRecordScalarFieldEnum = {
  id: 'id',
  memberId: 'memberId',
  memberName: 'memberName',
  memberCardNo: 'memberCardNo',
  field: 'field',
  currentValue: 'currentValue',
  status: 'status',
  conflictLedgerIds: 'conflictLedgerIds',
  detail: 'detail',
  storeId: 'storeId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  resolvedAt: 'resolvedAt',
  resolvedBy: 'resolvedBy',
  resolvedByName: 'resolvedByName',
  resolveNote: 'resolveNote'
};

exports.Prisma.RecycleBinEntryScalarFieldEnum = {
  id: 'id',
  entityType: 'entityType',
  entityId: 'entityId',
  entitySnapshot: 'entitySnapshot',
  deletedAt: 'deletedAt',
  deletedBy: 'deletedBy',
  deletedByName: 'deletedByName',
  sourceStoreId: 'sourceStoreId',
  sourceStoreName: 'sourceStoreName'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  details: 'details',
  operatorId: 'operatorId',
  operatorName: 'operatorName',
  storeId: 'storeId',
  deviceId: 'deviceId',
  createdAt: 'createdAt'
};

exports.Prisma.SyncCursorScalarFieldEnum = {
  id: 'id',
  deviceId: 'deviceId',
  tableName: 'tableName',
  lastCursor: 'lastCursor'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Store: 'Store',
  Device: 'Device',
  Staff: 'Staff',
  Customer: 'Customer',
  PhoneHistory: 'PhoneHistory',
  TierRule: 'TierRule',
  Setting: 'Setting',
  Member: 'Member',
  Ledger: 'Ledger',
  BeanBatch: 'BeanBatch',
  ExamRecord: 'ExamRecord',
  Payment: 'Payment',
  Recharge: 'Recharge',
  ExamTemplate: 'ExamTemplate',
  Brand: 'Brand',
  AnomalyRecord: 'AnomalyRecord',
  RecycleBinEntry: 'RecycleBinEntry',
  AuditLog: 'AuditLog',
  SyncCursor: 'SyncCursor'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
