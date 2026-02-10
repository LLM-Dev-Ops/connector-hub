/**
 * ExecutionContext - Repo-level span manager for the Agentics execution system.
 *
 * Manages the hierarchical span structure required by the Agentics platform:
 *   Core (external)
 *     └─ Repo Span (this context)
 *         └─ Agent Span (one or more)
 *             └─ Artifacts
 *
 * Enforces all invariants:
 * - parent_span_id must be present (validated on creation)
 * - Every agent must have its own span
 * - At least one agent span must exist before finalization
 * - No agent span may remain in RUNNING state at finalization
 */

import {
  ExecutionInputSchema,
  type ExecutionInput,
  type ExecutionOutput,
  type RepoSpan,
  type AgentSpan,
  type ArtifactRef,
  type SpanStatus,
} from '@llm-dev-ops/agentics-contracts';

const REPO_NAME = 'connector-hub';

export class ExecutionContext {
  private readonly _executionId: string;
  private readonly repoSpan: RepoSpan;
  private readonly agentSpans: Map<string, AgentSpan> = new Map();
  private finalized = false;

  private constructor(input: ExecutionInput) {
    this._executionId = input.execution_id;
    this.repoSpan = {
      type: 'repo' as const,
      span_id: crypto.randomUUID(),
      parent_span_id: input.parent_span_id,
      repo_name: REPO_NAME,
      status: 'RUNNING',
      start_time: new Date().toISOString(),
      agent_spans: [],
    };
  }

  /**
   * Create an ExecutionContext from raw input.
   * Validates that execution_id and parent_span_id are present and valid UUIDs.
   * Throws a ZodError if validation fails.
   */
  static create(rawInput: unknown): ExecutionContext {
    const input = ExecutionInputSchema.parse(rawInput);
    return new ExecutionContext(input);
  }

  /** The execution ID from the Core orchestrator */
  get executionId(): string {
    return this._executionId;
  }

  /** The repo-level span ID */
  get repoSpanId(): string {
    return this.repoSpan.span_id;
  }

  /** Whether this context has been finalized */
  get isFinalized(): boolean {
    return this.finalized;
  }

  /**
   * Start a new agent-level span nested under this repo span.
   * Each agent MUST have its own span - spans cannot be shared.
   *
   * @returns The agent span ID
   */
  startAgentSpan(agentName: string, agentVersion: string): string {
    if (this.finalized) {
      throw new Error('Cannot start agent span: execution already finalized');
    }

    const spanId = crypto.randomUUID();
    const span: AgentSpan = {
      type: 'agent' as const,
      span_id: spanId,
      parent_span_id: this.repoSpan.span_id,
      agent_name: agentName,
      agent_version: agentVersion,
      repo_name: REPO_NAME,
      status: 'RUNNING',
      start_time: new Date().toISOString(),
      artifacts: [],
    };

    this.agentSpans.set(spanId, span);
    return spanId;
  }

  /**
   * End an agent span with a status.
   */
  endAgentSpan(
    spanId: string,
    status: 'OK' | 'FAILED',
    error?: { code: string; message: string }
  ): void {
    const span = this.agentSpans.get(spanId);
    if (!span) {
      throw new Error(`Unknown agent span: ${spanId}`);
    }
    if (span.status !== 'RUNNING') {
      throw new Error(`Agent span ${spanId} already ended`);
    }

    const endTime = new Date().toISOString();
    span.status = status;
    span.end_time = endTime;
    span.duration_ms = new Date(endTime).getTime() - new Date(span.start_time).getTime();
    if (error) {
      span.error = error;
    }
  }

  /**
   * Attach an artifact reference to a specific agent span.
   * Artifacts must always be attached at the agent level, never directly to the repo span.
   */
  attachArtifact(
    agentSpanId: string,
    artifactType: string,
    artifactId?: string
  ): ArtifactRef {
    const span = this.agentSpans.get(agentSpanId);
    if (!span) {
      throw new Error(`Unknown agent span: ${agentSpanId}`);
    }

    const ref: ArtifactRef = {
      artifact_id: artifactId ?? crypto.randomUUID(),
      artifact_type: artifactType,
      agent_span_id: agentSpanId,
    };

    span.artifacts.push(ref);
    return ref;
  }

  /**
   * Finalize the execution and return the ExecutionOutput.
   *
   * Enforces all invariants:
   * - At least one agent span must have been emitted
   * - No agent span may still be in RUNNING state
   * - If any agent span is FAILED, the repo span is FAILED
   * - All spans are included in the output even on failure
   *
   * Can only be called once.
   */
  finalize(): ExecutionOutput {
    if (this.finalized) {
      throw new Error('Execution already finalized');
    }
    this.finalized = true;

    const agentSpanList = Array.from(this.agentSpans.values());
    const endTime = new Date().toISOString();

    const hasNoAgentSpans = agentSpanList.length === 0;
    const hasRunningSpans = agentSpanList.some(s => s.status === 'RUNNING');
    const hasFailedSpans = agentSpanList.some(s => s.status === 'FAILED');

    let repoStatus: SpanStatus = 'OK';
    let error: { code: string; message: string } | undefined;

    if (hasNoAgentSpans) {
      repoStatus = 'FAILED';
      error = {
        code: 'NO_AGENT_SPANS',
        message: 'No agent-level spans were emitted during execution',
      };
    } else if (hasRunningSpans) {
      repoStatus = 'FAILED';
      error = {
        code: 'UNFINISHED_SPANS',
        message: 'One or more agent spans were not completed before finalization',
      };
    } else if (hasFailedSpans) {
      repoStatus = 'FAILED';
      error = {
        code: 'AGENT_FAILURE',
        message: 'One or more agents failed during execution',
      };
    }

    this.repoSpan.status = repoStatus;
    this.repoSpan.end_time = endTime;
    this.repoSpan.duration_ms =
      new Date(endTime).getTime() - new Date(this.repoSpan.start_time).getTime();
    this.repoSpan.agent_spans = agentSpanList;

    return {
      execution_id: this._executionId,
      repo_span: this.repoSpan,
      success: repoStatus === 'OK',
      error,
    };
  }
}
