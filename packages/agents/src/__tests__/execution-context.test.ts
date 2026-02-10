/**
 * ExecutionContext Tests
 *
 * Tests for the Agentics execution graph instrumentation:
 * - Input validation (parent_span_id required)
 * - Repo-level span creation
 * - Agent span lifecycle
 * - Artifact attachment
 * - Finalization enforcement
 * - Output contract
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '../execution/execution-context';

function validInput() {
  return {
    execution_id: randomUUID(),
    parent_span_id: randomUUID(),
  };
}

// =============================================================================
// ExecutionContext.create() validation
// =============================================================================

describe('ExecutionContext.create()', () => {
  it('should accept valid input with execution_id and parent_span_id', () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);

    expect(ctx.executionId).toBe(input.execution_id);
    expect(ctx.repoSpanId).toBeDefined();
    expect(ctx.repoSpanId).not.toBe(input.parent_span_id);
    expect(ctx.isFinalized).toBe(false);
  });

  it('should accept input with optional payload and metadata', () => {
    const input = {
      ...validInput(),
      payload: { some: 'data' },
      metadata: { key: 'value' },
    };
    const ctx = ExecutionContext.create(input);

    expect(ctx.executionId).toBe(input.execution_id);
  });

  it('should reject missing parent_span_id', () => {
    expect(() =>
      ExecutionContext.create({ execution_id: randomUUID() })
    ).toThrow();
  });

  it('should reject missing execution_id', () => {
    expect(() =>
      ExecutionContext.create({ parent_span_id: randomUUID() })
    ).toThrow();
  });

  it('should reject non-UUID parent_span_id', () => {
    expect(() =>
      ExecutionContext.create({
        execution_id: randomUUID(),
        parent_span_id: 'not-a-uuid',
      })
    ).toThrow();
  });

  it('should reject non-UUID execution_id', () => {
    expect(() =>
      ExecutionContext.create({
        execution_id: 'not-a-uuid',
        parent_span_id: randomUUID(),
      })
    ).toThrow();
  });

  it('should reject empty input', () => {
    expect(() => ExecutionContext.create({})).toThrow();
  });

  it('should reject null input', () => {
    expect(() => ExecutionContext.create(null)).toThrow();
  });
});

// =============================================================================
// Agent span lifecycle
// =============================================================================

describe('Agent span lifecycle', () => {
  it('should create an agent span and return a span ID', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    expect(spanId).toBeDefined();
    expect(typeof spanId).toBe('string');
    expect(spanId.length).toBeGreaterThan(0);
  });

  it('should create unique span IDs for each agent', () => {
    const ctx = ExecutionContext.create(validInput());
    const span1 = ctx.startAgentSpan('agent-a', '1.0.0');
    const span2 = ctx.startAgentSpan('agent-b', '2.0.0');

    expect(span1).not.toBe(span2);
  });

  it('should end an agent span successfully', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    // Should not throw
    ctx.endAgentSpan(spanId, 'OK');
  });

  it('should end an agent span with FAILED status and error', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    ctx.endAgentSpan(spanId, 'FAILED', {
      code: 'TEST_ERROR',
      message: 'Something went wrong',
    });

    // Verify through finalize
    const output = ctx.finalize();
    const agentSpan = output.repo_span.agent_spans[0];
    expect(agentSpan.status).toBe('FAILED');
    expect(agentSpan.error).toEqual({
      code: 'TEST_ERROR',
      message: 'Something went wrong',
    });
  });

  it('should throw when ending an unknown span', () => {
    const ctx = ExecutionContext.create(validInput());

    expect(() => ctx.endAgentSpan(randomUUID(), 'OK')).toThrow('Unknown agent span');
  });

  it('should throw when ending a span twice', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    expect(() => ctx.endAgentSpan(spanId, 'OK')).toThrow('already ended');
  });

  it('should not allow starting spans after finalization', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');
    ctx.finalize();

    expect(() => ctx.startAgentSpan('late-agent', '1.0.0')).toThrow('already finalized');
  });

  it('should record duration on ended spans', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    const output = ctx.finalize();
    const agentSpan = output.repo_span.agent_spans[0];
    expect(agentSpan.duration_ms).toBeDefined();
    expect(agentSpan.duration_ms).toBeGreaterThanOrEqual(0);
    expect(agentSpan.end_time).toBeDefined();
  });
});

// =============================================================================
// Artifact attachment
// =============================================================================

describe('Artifact attachment', () => {
  it('should attach an artifact to an agent span', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    const ref = ctx.attachArtifact(spanId, 'decision_event', 'some-event-id');

    expect(ref.artifact_type).toBe('decision_event');
    expect(ref.artifact_id).toBe('some-event-id');
    expect(ref.agent_span_id).toBe(spanId);
  });

  it('should auto-generate artifact_id when not provided', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    const ref = ctx.attachArtifact(spanId, 'metric');

    expect(ref.artifact_id).toBeDefined();
    expect(ref.artifact_id.length).toBeGreaterThan(0);
  });

  it('should allow multiple artifacts per span', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    ctx.attachArtifact(spanId, 'decision_event', 'event-1');
    ctx.attachArtifact(spanId, 'metric', 'metric-1');
    ctx.attachArtifact(spanId, 'report', 'report-1');

    ctx.endAgentSpan(spanId, 'OK');
    const output = ctx.finalize();

    expect(output.repo_span.agent_spans[0].artifacts).toHaveLength(3);
  });

  it('should throw when attaching to an unknown span', () => {
    const ctx = ExecutionContext.create(validInput());

    expect(() =>
      ctx.attachArtifact(randomUUID(), 'decision_event')
    ).toThrow('Unknown agent span');
  });

  it('should include artifacts in finalized output', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');

    ctx.attachArtifact(spanId, 'decision_event', 'evt-123');
    ctx.endAgentSpan(spanId, 'OK');

    const output = ctx.finalize();
    const artifacts = output.repo_span.agent_spans[0].artifacts;

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact_type).toBe('decision_event');
    expect(artifacts[0].artifact_id).toBe('evt-123');
    expect(artifacts[0].agent_span_id).toBe(spanId);
  });
});

// =============================================================================
// Finalization enforcement
// =============================================================================

describe('Finalization enforcement', () => {
  it('should succeed when all agent spans are OK', () => {
    const ctx = ExecutionContext.create(validInput());

    const span1 = ctx.startAgentSpan('agent-a', '1.0.0');
    ctx.endAgentSpan(span1, 'OK');

    const span2 = ctx.startAgentSpan('agent-b', '1.0.0');
    ctx.endAgentSpan(span2, 'OK');

    const output = ctx.finalize();

    expect(output.success).toBe(true);
    expect(output.error).toBeUndefined();
    expect(output.repo_span.status).toBe('OK');
  });

  it('should fail with NO_AGENT_SPANS when no agents ran', () => {
    const ctx = ExecutionContext.create(validInput());
    const output = ctx.finalize();

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('NO_AGENT_SPANS');
    expect(output.repo_span.status).toBe('FAILED');
  });

  it('should fail with UNFINISHED_SPANS when a span is still RUNNING', () => {
    const ctx = ExecutionContext.create(validInput());
    ctx.startAgentSpan('unfinished-agent', '1.0.0');

    const output = ctx.finalize();

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('UNFINISHED_SPANS');
    expect(output.repo_span.status).toBe('FAILED');
  });

  it('should fail with AGENT_FAILURE when any span is FAILED', () => {
    const ctx = ExecutionContext.create(validInput());

    const span1 = ctx.startAgentSpan('ok-agent', '1.0.0');
    ctx.endAgentSpan(span1, 'OK');

    const span2 = ctx.startAgentSpan('failed-agent', '1.0.0');
    ctx.endAgentSpan(span2, 'FAILED', { code: 'ERR', message: 'failure' });

    const output = ctx.finalize();

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('AGENT_FAILURE');
    expect(output.repo_span.status).toBe('FAILED');
  });

  it('should still return all spans on failure', () => {
    const ctx = ExecutionContext.create(validInput());

    const span1 = ctx.startAgentSpan('ok-agent', '1.0.0');
    ctx.endAgentSpan(span1, 'OK');

    const span2 = ctx.startAgentSpan('failed-agent', '1.0.0');
    ctx.endAgentSpan(span2, 'FAILED', { code: 'ERR', message: 'fail' });

    const output = ctx.finalize();

    // Both spans present even though result is FAILED
    expect(output.repo_span.agent_spans).toHaveLength(2);
    expect(output.repo_span.agent_spans[0].agent_name).toBe('ok-agent');
    expect(output.repo_span.agent_spans[1].agent_name).toBe('failed-agent');
  });

  it('should throw when finalized twice', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    ctx.finalize();

    expect(() => ctx.finalize()).toThrow('already finalized');
  });
});

// =============================================================================
// Output contract
// =============================================================================

describe('Output contract', () => {
  it('should include correct execution_id', () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    const output = ctx.finalize();

    expect(output.execution_id).toBe(input.execution_id);
  });

  it('should produce repo span with correct hierarchy', () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    const output = ctx.finalize();

    // Repo span links back to Core via parent_span_id
    expect(output.repo_span.type).toBe('repo');
    expect(output.repo_span.parent_span_id).toBe(input.parent_span_id);
    expect(output.repo_span.repo_name).toBe('connector-hub');

    // Agent span links to repo span
    const agentSpan = output.repo_span.agent_spans[0];
    expect(agentSpan.type).toBe('agent');
    expect(agentSpan.parent_span_id).toBe(output.repo_span.span_id);
    expect(agentSpan.repo_name).toBe('connector-hub');
  });

  it('should be JSON-serializable without loss', () => {
    const ctx = ExecutionContext.create(validInput());

    const span1 = ctx.startAgentSpan('agent-a', '1.0.0');
    ctx.attachArtifact(span1, 'decision_event', 'evt-1');
    ctx.endAgentSpan(span1, 'OK');

    const span2 = ctx.startAgentSpan('agent-b', '2.0.0');
    ctx.attachArtifact(span2, 'metric', 'met-1');
    ctx.endAgentSpan(span2, 'FAILED', { code: 'ERR', message: 'test' });

    const output = ctx.finalize();

    // Round-trip through JSON
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);

    expect(parsed.execution_id).toBe(output.execution_id);
    expect(parsed.success).toBe(output.success);
    expect(parsed.repo_span.agent_spans).toHaveLength(2);
    expect(parsed.repo_span.agent_spans[0].artifacts[0].artifact_id).toBe('evt-1');
    expect(parsed.repo_span.agent_spans[1].error.code).toBe('ERR');
  });

  it('should record duration on the repo span', () => {
    const ctx = ExecutionContext.create(validInput());
    const spanId = ctx.startAgentSpan('test-agent', '1.0.0');
    ctx.endAgentSpan(spanId, 'OK');

    const output = ctx.finalize();

    expect(output.repo_span.start_time).toBeDefined();
    expect(output.repo_span.end_time).toBeDefined();
    expect(output.repo_span.duration_ms).toBeDefined();
    expect(output.repo_span.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should maintain causal ordering: agent spans start after repo span', () => {
    const ctx = ExecutionContext.create(validInput());

    const span1 = ctx.startAgentSpan('first-agent', '1.0.0');
    ctx.endAgentSpan(span1, 'OK');

    const span2 = ctx.startAgentSpan('second-agent', '1.0.0');
    ctx.endAgentSpan(span2, 'OK');

    const output = ctx.finalize();

    const repoStart = new Date(output.repo_span.start_time).getTime();
    for (const agentSpan of output.repo_span.agent_spans) {
      const agentStart = new Date(agentSpan.start_time).getTime();
      expect(agentStart).toBeGreaterThanOrEqual(repoStart);
    }
  });
});
