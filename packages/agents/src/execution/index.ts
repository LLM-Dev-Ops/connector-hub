/**
 * Execution graph instrumentation for the Agentics platform.
 *
 * Provides the ExecutionContext for managing hierarchical execution spans,
 * and wrapper functions for running agents within that context.
 */

export { ExecutionContext } from './execution-context.js';
export {
  runAgentInContext,
  runProcessAgentInContext,
  type ProcessAgent,
} from './instrumented-agent.js';
