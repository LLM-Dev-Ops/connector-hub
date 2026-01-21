/**
 * Confidence Scoring System for Auth/Identity Agent
 *
 * Calculates overall confidence scores based on multiple factors.
 */

import { Confidence, AuthConfidenceFactors } from '@llm-dev-ops/agentics-contracts';

/**
 * Weights for different confidence factors
 */
const FACTOR_WEIGHTS: Record<keyof AuthConfidenceFactors, number> = {
  signature_verification: 0.35,
  issuer_trust: 0.25,
  token_freshness: 0.15,
  claims_completeness: 0.15,
  scope_sufficiency: 0.10,
};

/**
 * Confidence level thresholds
 */
const CONFIDENCE_THRESHOLDS = {
  high: 0.85,
  medium: 0.6,
  low: 0.3,
};

/**
 * Calculate overall confidence from individual factors
 */
export function calculateConfidence(factors: AuthConfidenceFactors): Confidence {
  // Calculate weighted score
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [factor, weight] of Object.entries(FACTOR_WEIGHTS)) {
    const value = factors[factor as keyof AuthConfidenceFactors];
    if (value !== undefined) {
      weightedSum += value * weight;
      totalWeight += weight;
    }
  }

  // Normalize if not all factors are present
  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Determine confidence level
  let level: Confidence['level'];
  if (score >= CONFIDENCE_THRESHOLDS.high) {
    level = 'high';
  } else if (score >= CONFIDENCE_THRESHOLDS.medium) {
    level = 'medium';
  } else if (score >= CONFIDENCE_THRESHOLDS.low) {
    level = 'low';
  } else {
    level = 'uncertain';
  }

  // Generate reasoning
  const reasoning = generateReasoning(factors, score, level);

  return {
    score: Math.round(score * 1000) / 1000, // Round to 3 decimal places
    level,
    factors: factors as unknown as Record<string, number>,
    reasoning,
  };
}

/**
 * Generate human-readable reasoning for confidence level
 */
function generateReasoning(
  factors: AuthConfidenceFactors,
  score: number,
  level: Confidence['level']
): string {
  const parts: string[] = [];

  // Signature verification
  if (factors.signature_verification >= 0.9) {
    parts.push('signature verified');
  } else if (factors.signature_verification >= 0.5) {
    parts.push('signature partially verified');
  } else if (factors.signature_verification > 0) {
    parts.push('signature verification incomplete');
  } else {
    parts.push('signature not verified');
  }

  // Issuer trust
  if (factors.issuer_trust >= 0.9) {
    parts.push('trusted issuer');
  } else if (factors.issuer_trust >= 0.5) {
    parts.push('known issuer');
  } else if (factors.issuer_trust > 0) {
    parts.push('unknown issuer');
  }

  // Token freshness
  if (factors.token_freshness >= 0.8) {
    parts.push('token fresh');
  } else if (factors.token_freshness >= 0.3) {
    parts.push('token aging');
  } else if (factors.token_freshness > 0) {
    parts.push('token near expiry');
  }

  // Scope sufficiency
  if (factors.scope_sufficiency !== undefined) {
    if (factors.scope_sufficiency >= 1) {
      parts.push('all scopes present');
    } else if (factors.scope_sufficiency >= 0.5) {
      parts.push('partial scopes');
    } else {
      parts.push('insufficient scopes');
    }
  }

  // Claims completeness
  if (factors.claims_completeness >= 0.8) {
    parts.push('complete claims');
  } else if (factors.claims_completeness >= 0.5) {
    parts.push('partial claims');
  } else if (factors.claims_completeness > 0) {
    parts.push('minimal claims');
  }

  const summary = `${level.toUpperCase()} confidence (${Math.round(score * 100)}%)`;
  return `${summary}: ${parts.join(', ')}`;
}

/**
 * Check if confidence meets minimum threshold
 */
export function meetsMinimumConfidence(
  confidence: Confidence,
  minimumLevel: Confidence['level'] = 'medium'
): boolean {
  const levelOrder: Confidence['level'][] = ['uncertain', 'low', 'medium', 'high'];
  const currentIndex = levelOrder.indexOf(confidence.level);
  const requiredIndex = levelOrder.indexOf(minimumLevel);
  return currentIndex >= requiredIndex;
}

/**
 * Combine multiple confidence assessments
 */
export function combineConfidences(confidences: Confidence[]): Confidence {
  if (confidences.length === 0) {
    return {
      score: 0,
      level: 'uncertain',
      reasoning: 'No confidence assessments provided',
    };
  }

  // Average the scores
  const avgScore = confidences.reduce((sum, c) => sum + c.score, 0) / confidences.length;

  // Combine factors
  const combinedFactors: Record<string, number[]> = {};
  for (const conf of confidences) {
    if (conf.factors) {
      for (const [key, value] of Object.entries(conf.factors)) {
        if (!combinedFactors[key]) {
          combinedFactors[key] = [];
        }
        combinedFactors[key]!.push(value);
      }
    }
  }

  const averagedFactors: Record<string, number> = {};
  for (const [key, values] of Object.entries(combinedFactors)) {
    averagedFactors[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Determine level
  let level: Confidence['level'];
  if (avgScore >= CONFIDENCE_THRESHOLDS.high) {
    level = 'high';
  } else if (avgScore >= CONFIDENCE_THRESHOLDS.medium) {
    level = 'medium';
  } else if (avgScore >= CONFIDENCE_THRESHOLDS.low) {
    level = 'low';
  } else {
    level = 'uncertain';
  }

  return {
    score: Math.round(avgScore * 1000) / 1000,
    level,
    factors: averagedFactors,
    reasoning: `Combined from ${confidences.length} assessments`,
  };
}
