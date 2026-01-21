/**
 * Tests for Confidence Scoring System
 */

import { describe, it, expect } from 'vitest';
import {
  calculateConfidence,
  meetsMinimumConfidence,
  combineConfidences,
} from '../auth/confidence';
import { AuthConfidenceFactors } from '@llm-dev-ops/agentics-contracts/agents/auth';

describe('Confidence Scoring', () => {
  describe('calculateConfidence', () => {
    it('should calculate high confidence when all factors are high', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 1.0,
        issuer_trust: 1.0,
        token_freshness: 1.0,
        claims_completeness: 1.0,
        scope_sufficiency: 1.0,
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.level).toBe('high');
      expect(confidence.score).toBeGreaterThanOrEqual(0.85);
    });

    it('should calculate low confidence when factors are low', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 0.2,
        issuer_trust: 0.3,
        token_freshness: 0.2,
        claims_completeness: 0.3,
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.level).toBe('low');
      expect(confidence.score).toBeLessThan(0.6);
    });

    it('should calculate uncertain when factors are very low', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 0,
        issuer_trust: 0.1,
        token_freshness: 0.1,
        claims_completeness: 0.1,
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.level).toBe('uncertain');
      expect(confidence.score).toBeLessThan(0.3);
    });

    it('should weight signature verification heavily', () => {
      const withVerification: AuthConfidenceFactors = {
        signature_verification: 1.0,
        issuer_trust: 0.5,
        token_freshness: 0.5,
        claims_completeness: 0.5,
      };

      const withoutVerification: AuthConfidenceFactors = {
        signature_verification: 0,
        issuer_trust: 0.5,
        token_freshness: 0.5,
        claims_completeness: 0.5,
      };

      const confWith = calculateConfidence(withVerification);
      const confWithout = calculateConfidence(withoutVerification);

      expect(confWith.score).toBeGreaterThan(confWithout.score);
      expect(confWith.score - confWithout.score).toBeGreaterThan(0.2); // Significant difference
    });

    it('should include reasoning in output', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 0.9,
        issuer_trust: 0.8,
        token_freshness: 0.7,
        claims_completeness: 0.6,
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.reasoning).toBeDefined();
      expect(confidence.reasoning).toContain('signature verified');
      expect(confidence.reasoning).toContain('trusted issuer');
    });

    it('should handle missing optional factors', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 0.8,
        issuer_trust: 0.7,
        token_freshness: 0.9,
        claims_completeness: 0.8,
        // scope_sufficiency omitted
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.score).toBeGreaterThan(0);
      expect(confidence.level).toBeDefined();
    });

    it('should include factors in output', () => {
      const factors: AuthConfidenceFactors = {
        signature_verification: 0.9,
        issuer_trust: 0.8,
        token_freshness: 0.7,
        claims_completeness: 0.6,
        scope_sufficiency: 0.5,
      };

      const confidence = calculateConfidence(factors);

      expect(confidence.factors).toBeDefined();
      expect(confidence.factors!['signature_verification']).toBe(0.9);
    });
  });

  describe('meetsMinimumConfidence', () => {
    it('should return true when confidence meets threshold', () => {
      const highConfidence = {
        score: 0.9,
        level: 'high' as const,
        reasoning: 'test',
      };

      expect(meetsMinimumConfidence(highConfidence, 'high')).toBe(true);
      expect(meetsMinimumConfidence(highConfidence, 'medium')).toBe(true);
      expect(meetsMinimumConfidence(highConfidence, 'low')).toBe(true);
    });

    it('should return false when confidence is below threshold', () => {
      const lowConfidence = {
        score: 0.4,
        level: 'low' as const,
        reasoning: 'test',
      };

      expect(meetsMinimumConfidence(lowConfidence, 'high')).toBe(false);
      expect(meetsMinimumConfidence(lowConfidence, 'medium')).toBe(false);
      expect(meetsMinimumConfidence(lowConfidence, 'low')).toBe(true);
    });

    it('should use medium as default threshold', () => {
      const mediumConfidence = {
        score: 0.65,
        level: 'medium' as const,
        reasoning: 'test',
      };

      expect(meetsMinimumConfidence(mediumConfidence)).toBe(true);
    });
  });

  describe('combineConfidences', () => {
    it('should average scores from multiple assessments', () => {
      const confidences = [
        { score: 0.8, level: 'high' as const, reasoning: 'test1' },
        { score: 0.6, level: 'medium' as const, reasoning: 'test2' },
      ];

      const combined = combineConfidences(confidences);

      expect(combined.score).toBe(0.7);
    });

    it('should handle empty array', () => {
      const combined = combineConfidences([]);

      expect(combined.score).toBe(0);
      expect(combined.level).toBe('uncertain');
    });

    it('should combine factors from multiple assessments', () => {
      const confidences = [
        {
          score: 0.8,
          level: 'high' as const,
          reasoning: 'test1',
          factors: { signature_verification: 1.0, issuer_trust: 0.8 },
        },
        {
          score: 0.6,
          level: 'medium' as const,
          reasoning: 'test2',
          factors: { signature_verification: 0.6, issuer_trust: 0.6 },
        },
      ];

      const combined = combineConfidences(confidences);

      expect(combined.factors!['signature_verification']).toBe(0.8);
      expect(combined.factors!['issuer_trust']).toBe(0.7);
    });

    it('should determine level from averaged score', () => {
      const highConfidences = [
        { score: 0.9, level: 'high' as const, reasoning: 'test' },
        { score: 0.85, level: 'high' as const, reasoning: 'test' },
      ];

      const combined = combineConfidences(highConfidences);

      expect(combined.level).toBe('high');
    });
  });
});
