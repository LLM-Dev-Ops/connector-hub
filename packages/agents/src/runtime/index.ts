/**
 * Runtime - Public API
 *
 * Exports runtime handlers for deploying agents.
 */

export {
  createEdgeFunctionHandler,
  createExpressMiddleware,
  createHandlerFromEnv,
  webhookHandler,
  type EdgeFunctionConfig,
  type CloudFunctionHandler,
} from './edge-function.js';

// Execution graph instrumentation
export {
  ExecutionContext,
  runAgentInContext,
  runProcessAgentInContext,
  type ProcessAgent,
} from '../execution/index.js';
