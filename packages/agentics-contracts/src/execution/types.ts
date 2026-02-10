/**
 * Execution Graph Types for Agentics Platform
 *
 * Defines the hierarchical span structure that every Foundational Execution Unit
 * (repository) must produce when invoked by a Core orchestrator.
 *
 * Invariant hierarchy:
 *   Core
 *     └─ Repo Span (this repo)
 *         └─ Agent Span (one or more)
 *             └─ Artifacts (attached to agent spans)
 */

import { z } from 'zod';

/**
 * Span status values
 */
export const SpanStatusSchema = z.enum(['RUNNING', 'OK', 'FAILED']);
export type SpanStatus = z.infer<typeof SpanStatusSchema>;

/**
 * Reference to an artifact produced by an agent.
 * Artifacts are always attached at the agent span level.
 */
export const ArtifactRefSchema = z.object({
  /** Stable identifier for the artifact (UUID, URI, hash, or filename) */
  artifact_id: z.string().min(1),
  /** Type of artifact (e.g. 'decision_event', 'metric', 'report') */
  artifact_type: z.string().min(1),
  /** The agent span that produced this artifact */
  agent_span_id: z.string().uuid(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/**
 * Agent-level execution span.
 * One per agent execution, nested under the repo span.
 */
export const AgentSpanSchema = z.object({
  type: z.literal('agent'),
  span_id: z.string().uuid(),
  /** Must point to the repo span */
  parent_span_id: z.string().uuid(),
  agent_name: z.string().min(1),
  agent_version: z.string().min(1),
  repo_name: z.string().min(1),
  status: SpanStatusSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  duration_ms: z.number().nonnegative().optional(),
  artifacts: z.array(ArtifactRefSchema),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type AgentSpan = z.infer<typeof AgentSpanSchema>;

/**
 * Repo-level execution span.
 * One per externally-invoked operation. Contains nested agent spans.
 */
export const RepoSpanSchema = z.object({
  type: z.literal('repo'),
  span_id: z.string().uuid(),
  /** Provided by the Core orchestrator */
  parent_span_id: z.string().uuid(),
  repo_name: z.string().min(1),
  status: SpanStatusSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  duration_ms: z.number().nonnegative().optional(),
  agent_spans: z.array(AgentSpanSchema),
});
export type RepoSpan = z.infer<typeof RepoSpanSchema>;

/**
 * Input provided by the Core orchestrator when invoking this repo.
 * parent_span_id is mandatory - execution MUST be rejected without it.
 */
export const ExecutionInputSchema = z.object({
  execution_id: z.string().uuid(),
  parent_span_id: z.string().uuid(),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;

/**
 * Output returned to the Core orchestrator.
 * Always includes the full repo span with nested agent spans,
 * even on failure.
 */
export const ExecutionOutputSchema = z.object({
  execution_id: z.string().uuid(),
  repo_span: RepoSpanSchema,
  success: z.boolean(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type ExecutionOutput = z.infer<typeof ExecutionOutputSchema>;
