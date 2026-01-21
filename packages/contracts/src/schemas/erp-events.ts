import { z } from 'zod';

/**
 * ERP system types
 */
export const ERPSystemTypeSchema = z.enum([
  'salesforce',
  'sap',
  'oracle',
  'dynamics365',
  'netsuite',
  'workday',
  'custom',
]);

export type ERPSystemType = z.infer<typeof ERPSystemTypeSchema>;

/**
 * ERP record operation types
 */
export const ERPOperationTypeSchema = z.enum([
  'create',
  'read',
  'update',
  'delete',
  'upsert',
  'query',
]);

export type ERPOperationType = z.infer<typeof ERPOperationTypeSchema>;

/**
 * ERP record event schema (canonical format)
 */
export const ERPRecordEventSchema = z.object({
  system: ERPSystemTypeSchema,
  operation: ERPOperationTypeSchema,
  object_type: z.string().describe('Object type (e.g., "Account", "Contact", "Opportunity")'),
  record_id: z.string().optional(),
  record_data: z.record(z.unknown()),
  changed_fields: z.array(z.string()).optional(),
  previous_values: z.record(z.unknown()).optional(),
  performed_by: z.object({
    user_id: z.string(),
    username: z.string().optional(),
    email: z.string().optional(),
  }).optional(),
  performed_at: z.string().datetime(),
  transaction_id: z.string().optional(),
});

export type ERPRecordEvent = z.infer<typeof ERPRecordEventSchema>;

/**
 * ERP query event schema
 */
export const ERPQueryEventSchema = z.object({
  system: ERPSystemTypeSchema,
  query_type: z.enum(['soql', 'sql', 'odata', 'graphql', 'custom']),
  query_string: z.string(),
  parameters: z.record(z.unknown()).optional(),
  result_count: z.number().optional(),
  execution_time_ms: z.number().optional(),
  executed_at: z.string().datetime(),
});

export type ERPQueryEvent = z.infer<typeof ERPQueryEventSchema>;

/**
 * Salesforce-specific event schema
 */
export const SalesforceEventSchema = z.object({
  sobject_type: z.string(),
  record_id: z.string().regex(/^[a-zA-Z0-9]{15,18}$/),
  attributes: z.record(z.unknown()),
  system_modstamp: z.string().datetime().optional(),
  created_date: z.string().datetime().optional(),
  last_modified_date: z.string().datetime().optional(),
  is_deleted: z.boolean().optional(),
});

export type SalesforceEvent = z.infer<typeof SalesforceEventSchema>;

/**
 * SAP-specific event schema
 */
export const SAPEventSchema = z.object({
  client: z.string(),
  transaction_code: z.string().optional(),
  document_number: z.string().optional(),
  company_code: z.string().optional(),
  plant: z.string().optional(),
  material: z.string().optional(),
  data: z.record(z.unknown()),
  change_indicator: z.enum(['I', 'U', 'D']).optional(),
});

export type SAPEvent = z.infer<typeof SAPEventSchema>;
