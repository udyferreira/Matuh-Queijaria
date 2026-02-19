import { z } from 'zod';
import { insertBatchSchema, productionBatches, batchLogs } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  businessRule: z.object({
    message: z.string(),
    code: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  batches: {
    list: {
      method: 'GET' as const,
      path: '/api/batches',
      responses: {
        200: z.array(z.custom<typeof productionBatches.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/batches/:id',
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    start: {
      method: 'POST' as const,
      path: '/api/batches',
      input: z.object({
        milkVolumeL: z.number().min(10).max(200),
        milkTemperatureC: z.number().min(0).max(100).transform((val) => {
          if (val > 50 && val < 100) return val / 10;
          return val;
        }).refine((val) => val >= 0 && val <= 50, {
          message: "Temperatura deve ser entre 0 e 50°C"
        }),
        // Accept spoken pH values like 66 (→6.6), 55 (→5.5) before validation
        milkPh: z.number().min(0).max(100).transform((val) => {
          if (val > 14 && val < 100) return val / 10;
          return val;
        }).refine((val) => val >= 3.5 && val <= 8.0, {
          message: "pH must be between 3.5 and 8.0"
        }),
        recipeId: z.string().optional().default("QUEIJO_NETE"),
      }),
      responses: {
        201: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    advance: {
      method: 'POST' as const,
      path: '/api/batches/:id/advance',
      input: z.object({
        inputs: z.record(z.any()).optional(),
      }),
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.businessRule,
        404: errorSchemas.notFound,
      },
    },
    input: {
      method: 'POST' as const,
      path: '/api/batches/:id/input',
      input: z.object({
        type: z.enum(["ph", "temperature", "time"]),
        value: z.union([z.number(), z.string()]),
        notes: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    logs: {
      method: 'GET' as const,
      path: '/api/batches/:id/logs',
      responses: {
        200: z.array(z.custom<typeof batchLogs.$inferSelect>()),
        404: errorSchemas.notFound,
      },
    },
    status: {
        method: 'GET' as const,
        path: '/api/batches/:id/status',
        responses: {
            200: z.object({
                batchId: z.number(),
                currentStageId: z.number(),
                status: z.string(),
                activeTimers: z.array(z.any()),
                nextAction: z.string(),
                guidance: z.string().optional()
            }),
            404: errorSchemas.notFound
        }
    },
    pause: {
      method: 'POST' as const,
      path: '/api/batches/:id/pause',
      input: z.object({
        reason: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.businessRule,
        404: errorSchemas.notFound,
      },
    },
    resume: {
      method: 'POST' as const,
      path: '/api/batches/:id/resume',
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.businessRule,
        404: errorSchemas.notFound,
      },
    },
    complete: {
      method: 'POST' as const,
      path: '/api/batches/:id/complete',
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.businessRule,
        404: errorSchemas.notFound,
      },
    },
    cancel: {
      method: 'POST' as const,
      path: '/api/batches/:id/cancel',
      input: z.object({
        reason: z.string(),
      }),
      responses: {
        200: z.custom<typeof productionBatches.$inferSelect>(),
        400: errorSchemas.businessRule,
        404: errorSchemas.notFound,
      },
    }
  },
  // Alexa Integration Webhook
  alexa: {
    webhook: {
      method: 'POST' as const,
      path: '/api/alexa/webhook',
      input: z.object({
        intent: z.string(),
        slots: z.record(z.any()).optional(),
        userId: z.string().optional()
      }),
      responses: {
        200: z.object({
          speech: z.string(),
          shouldEndSession: z.boolean()
        })
      }
    }
  }
};

// ============================================
// REQUIRED: buildUrl helper
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// ============================================
// TYPE HELPERS
// ============================================
export type BatchStatusResponse = z.infer<typeof api.batches.status.responses[200]>;
