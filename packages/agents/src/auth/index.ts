/**
 * Auth/Identity Agent Package
 *
 * This module exports all components for the Auth/Identity Agent.
 *
 * Purpose: Authenticate and verify external identities, tokens, and credentials
 * Classification: AUTHENTICATION / IDENTITY VERIFICATION
 * decision_type: "auth_identity_verification"
 */

// Main agent
export * from './auth-agent';

// Confidence scoring
export * from './confidence';

// Token validators
export * from './validators';

// HTTP handlers
export * from './handlers';
