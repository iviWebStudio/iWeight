/**
 * API contracts shared by the server and both clients. JSON fields are camelCase;
 * weights travel as integer grams (`weightG`), dates as `YYYY-MM-DD` in the user's time zone.
 */
import { z } from 'zod';

export * from './client.js';

/* ------------------------------------------------------------------ primitives */

export const LocalDateSchema = z.iso.date();
export const WeightGSchema = z.number().int().min(20_000).max(400_000);
export const WeightUnitSchema = z.enum(['kg', 'lb']);
export const UuidSchema = z.uuid();
const InstantSchema = z.iso.datetime({ offset: true });

/* ------------------------------------------------------------------ errors */

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_ENTRY',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'AI_NOT_CONFIGURED',
  'AI_UNAVAILABLE',
  'AI_BUDGET_EXCEEDED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/* ------------------------------------------------------------------ auth (local adapter, dev/CI only) */

export const LocalAuthRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});
export type LocalAuthRequest = z.infer<typeof LocalAuthRequestSchema>;
export const LocalAuthResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('bearer'),
  expiresIn: z.number().int(),
  userId: UuidSchema,
});
export type LocalAuthResponse = z.infer<typeof LocalAuthResponseSchema>;

/* ------------------------------------------------------------------ profile & preferences */

export const ReportFormatSchema = z.enum(['brief', 'standard', 'detailed']);
export const AgentToneSchema = z.enum(['neutral', 'supportive', 'concise']);
export const LanguageSchema = z.enum(['ru', 'en', 'hy']);

export const MeSchema = z.object({
  id: UuidSchema,
  displayName: z.string().nullable(),
  timezone: z.string(),
  weightUnit: WeightUnitSchema,
  heightCm: z.number().int().nullable(),
  onboardedAt: z.string().nullable(),
  preferences: z.object({
    language: LanguageSchema,
    reportFormat: ReportFormatSchema,
    agentTone: AgentToneSchema,
    memoryEnabled: z.boolean(),
  }),
});
export type Me = z.infer<typeof MeSchema>;

export const PatchMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable(),
    timezone: z.string().min(1).max(64),
    weightUnit: WeightUnitSchema,
    heightCm: z.number().int().min(80).max(260).nullable(),
    onboarded: z.boolean(),
    preferences: z
      .object({
        language: LanguageSchema,
        reportFormat: ReportFormatSchema,
        agentTone: AgentToneSchema,
        memoryEnabled: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type PatchMe = z.infer<typeof PatchMeSchema>;

export const DeleteMeSchema = z.object({ confirm: z.literal('DELETE') }).strict();

/* ------------------------------------------------------------------ weights */

export const WeightSourceSchema = z.enum(['web', 'android', 'chat', 'import']);

export const WeightEntrySchema = z.object({
  id: UuidSchema,
  measuredOn: LocalDateSchema,
  measuredAt: z.string().nullable(),
  weightG: WeightGSchema,
  note: z.string().nullable(),
  source: WeightSourceSchema,
  clientEntryId: UuidSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WeightEntry = z.infer<typeof WeightEntrySchema>;

export const CreateWeightSchema = z
  .object({
    weightG: WeightGSchema,
    /** Defaults to today in the profile's time zone (or the date of `measuredAt`). */
    measuredOn: LocalDateSchema.optional(),
    measuredAt: InstantSchema.optional(),
    note: z.string().trim().max(500).optional(),
    source: z.enum(['web', 'android', 'import']).default('web'),
    /** Client-generated id: repeating a request with the same id returns the same entry. */
    clientEntryId: UuidSchema.optional(),
    /** Skip the "same date + same weight" duplicate check (ADR-004). */
    allowDuplicate: z.boolean().optional(),
  })
  .strict();
export type CreateWeight = z.input<typeof CreateWeightSchema>;

export const PatchWeightSchema = z
  .object({
    weightG: WeightGSchema,
    measuredOn: LocalDateSchema,
    measuredAt: InstantSchema.nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type PatchWeight = z.infer<typeof PatchWeightSchema>;

export const ListWeightsQuerySchema = z
  .object({
    from: LocalDateSchema.optional(),
    to: LocalDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    /** Opaque cursor from the previous page. */
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type ListWeightsQuery = z.input<typeof ListWeightsQuerySchema>;

export const WeightListSchema = z.object({
  items: z.array(WeightEntrySchema),
  nextCursor: z.string().nullable(),
});
export type WeightList = z.infer<typeof WeightListSchema>;

/* ------------------------------------------------------------------ goals */

export const GoalSchema = z.object({
  id: UuidSchema,
  startWeightG: WeightGSchema,
  targetWeightG: WeightGSchema,
  startDate: LocalDateSchema,
  status: z.enum(['active', 'replaced', 'completed', 'cancelled']),
  direction: z.enum(['lose', 'gain', 'maintain']),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const CreateGoalSchema = z
  .object({
    targetWeightG: WeightGSchema,
    /** Defaults to the latest morning weight. */
    startWeightG: WeightGSchema.optional(),
    /** Defaults to today in the profile's time zone. */
    startDate: LocalDateSchema.optional(),
  })
  .strict();
export type CreateGoal = z.infer<typeof CreateGoalSchema>;

/* ------------------------------------------------------------------ analytics */

/** Shape of `computeSummary` from @weight-ai/core; documented there. */
export const AnalyticsSummarySchema = z.object({
  asOf: LocalDateSchema,
  timezone: z.string(),
  unit: WeightUnitSchema,
  summary: z.record(z.string(), z.unknown()),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

export const HistoryQuerySchema = z
  .object({
    from: LocalDateSchema.optional(),
    to: LocalDateSchema.optional(),
  })
  .strict();
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const HistoryPointSchema = z.object({
  date: LocalDateSchema,
  weightG: WeightGSchema,
  entryCount: z.number().int(),
  avg7G: z.number().nullable(),
  avg7Count: z.number().int(),
});
export const AnalyticsHistorySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  points: z.array(HistoryPointSchema),
  goal: GoalSchema.nullable(),
  forecast: z.record(z.string(), z.unknown()),
});
export type AnalyticsHistory = z.infer<typeof AnalyticsHistorySchema>;

/* ------------------------------------------------------------------ memory */

export const MemoryKindSchema = z.enum(['preference', 'rule', 'fact']);
export const MemoryItemSchema = z.object({
  id: UuidSchema,
  kind: MemoryKindSchema,
  content: z.string(),
  source: z.enum(['user', 'agent']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
export const CreateMemorySchema = z
  .object({ kind: MemoryKindSchema.default('fact'), content: z.string().trim().min(1).max(500) })
  .strict();
export const PatchMemorySchema = z
  .object({ kind: MemoryKindSchema, content: z.string().trim().min(1).max(500) })
  .partial()
  .strict();

/* ------------------------------------------------------------------ chat */

export const ChatRequestSchema = z
  .object({
    /** Omit to start a new conversation. */
    conversationId: UuidSchema.optional(),
    message: z.string().trim().min(1).max(4000),
    /** Client-generated id: a retried request returns the stored reply instead of running again. */
    clientMessageId: UuidSchema.optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ToolEventSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  /** Short machine-readable outcome, e.g. "created", "confirmation_required", "VALIDATION_ERROR". */
  outcome: z.string(),
  /** Entity the tool touched, when it changed data. */
  entityId: z.string().nullable().optional(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

export const PendingActionSchema = z.object({
  type: z.literal('delete_weight_entry'),
  confirmationId: UuidSchema,
  entryId: UuidSchema,
  description: z.string(),
  expiresAt: z.string(),
  /** The user message during which the action was proposed; confirmation must come in a later one. */
  createdInMessageId: UuidSchema,
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const ChatMessageSchema = z.object({
  id: UuidSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  toolEvents: z.array(ToolEventSchema).nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatResponseSchema = z.object({
  conversationId: UuidSchema,
  userMessageId: UuidSchema,
  reply: ChatMessageSchema,
  pendingAction: PendingActionSchema.nullable(),
  /** True when the tool-iteration limit cut the run short. */
  limited: z.boolean(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ConversationSchema = z.object({
  id: UuidSchema,
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;
export const ConversationDetailSchema = ConversationSchema.extend({
  messages: z.array(ChatMessageSchema),
  pendingAction: PendingActionSchema.nullable(),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
