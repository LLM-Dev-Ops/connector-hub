/**
 * Agentics Contracts Package
 *
 * This package provides contract definitions, schemas, and types for all agents
 * in the Agentics platform. All agents MUST import schemas from this package.
 */

export const VERSION = '0.1.0';

// Event schemas
export * from './events';

// Validation utilities
export * from './validation';

// Agent-specific contracts
export * as AuthContracts from './agents/auth';

// Re-export auth contracts for direct imports
export * from './agents/auth';
