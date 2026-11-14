import { z } from 'zod';

/** 上游响应/请求的局部 contract（P2 最小集，后续随能力扩展）。 */

export const FumaEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]),
  data: z.unknown().optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
  traceId: z.string().optional(),
  ApiTime: z.number().optional(),
  version: z.string().optional(),
  releaseVersion: z.number().optional()
}).passthrough();

export const ListPageSchema = z.object({
  from: z.number().int().min(0),
  size: z.number().int().min(1).max(500)
});

export const CustomerListRequestSchema = z.object({
  moduleCode: z.string().default('NewBF001'),
  page: ListPageSchema.default({ from: 0, size: 50 }),
  orderBy: z.object({ desc: z.enum(['desc', 'asc']).default('desc'), realFieldName: z.string().default('create_date'), tableCode: z.string().default('1') }).optional(),
  searchFieldCondition: z.record(z.string(), z.unknown()).optional(),
  systemSelection: z.object({ selectionId: z.string(), selectionType: z.number().int(), selectionName: z.string().optional() }).optional(),
  recoveryFlag: z.boolean().default(false)
});

export const DedupCheckRequestSchema = z.object({
  keywords: z.string().min(1),
  moduleCode: z.string().default('NewBF001'),
  type: z.string().default('1'),
  ignore: z.boolean().default(true),
  querySuffix: z.boolean().default(true),
  mutual: z.boolean().default(true),
  fieldId: z.string().optional()
});

export const TradeListRequestSchema = z.object({
  inputCompany: z.string().min(2),
  companyFlag: z.number().int().default(1),
  smartSearchFlag: z.number().int().default(1),
  filterForwarderImp: z.boolean().default(false),
  filterForwarderExp: z.boolean().default(false),
  importerName: z.record(z.string(), z.unknown()).optional(),
  exporterName: z.record(z.string(), z.unknown()).optional(),
  notifyName: z.record(z.string(), z.unknown()).optional(),
  manufacturer: z.record(z.string(), z.unknown()).optional(),
  brandName: z.record(z.string(), z.unknown()).optional(),
  companyTradeListTab: z.number().int().default(0),
  pageIndex: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortColumn: z.string().default('lasttradedate'),
  sortType: z.enum(['asc', 'desc']).default('desc')
});

export type CustomerListRequest = z.infer<typeof CustomerListRequestSchema>;
export type DedupCheckRequest = z.infer<typeof DedupCheckRequestSchema>;
export type TradeListRequest = z.infer<typeof TradeListRequestSchema>;
