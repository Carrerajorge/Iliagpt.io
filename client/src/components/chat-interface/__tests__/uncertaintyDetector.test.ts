import { describe, it, expect } from 'vitest';
import {
  detectUncertainty,
  getConfidenceLabel,
  getConfidenceColor
} from '../uncertaintyDetector';

describe('uncertaintyDetector', () => {
  describe('detectUncertainty', () => {
    describe('low confidence patterns', () => {
      it.each([
        'No estoy seguro de la respuesta',
        'No puedo confirmar esta información',
        'Falta información para responder',
        'La información insuficiente para responder',
        'No se menciona en el documento',
        'Podría ser de otra forma',
        'Es probable que sea así',
        'Sin certeza puedo decir',
        "I'm not sure about this",
        "I cannot confirm this information",
        'Insufficient information available',
      ])('detects low confidence in: "%s"', (content) => {
        const result = detectUncertainty(content);
        expect(result.confidence).toBe('low');
        expect(result.reason).toBeDefined();
      });
    });

    describe('medium confidence patterns', () => {
      it.each([
        'Parece indicar que sí',
        'Esto sugiere que podría funcionar',
        'Aparentemente es correcto',
        'Posiblemente sea la solución',
        'En principio debería funcionar',
        'Según el contexto proporcionado',
        'This seems to indicate success',
        'The data suggests that it works',
        'Based on the information available',
      ])('detects medium confidence in: "%s"', (content) => {
        const result = detectUncertainty(content);
        expect(result.confidence).toBe('medium');
        expect(result.reason).toBeDefined();
      });
    });

    describe('high confidence', () => {
      it.each([
        'La respuesta correcta es 42',
        'El código funciona perfectamente',
        'This is the correct solution',
        'The function returns the expected value',
        'Sí, esto es correcto',
        'La implementación es válida',
      ])('returns high confidence for: "%s"', (content) => {
        const result = detectUncertainty(content);
        expect(result.confidence).toBe('high');
        expect(result.reason).toBeUndefined();
      });
    });

    it('returns high confidence for empty string', () => {
      const result = detectUncertainty('');
      expect(result.confidence).toBe('high');
    });
  });

  describe('getConfidenceLabel', () => {
    it('returns correct labels for each level', () => {
      expect(getConfidenceLabel('high')).toBe('Alta confianza');
      expect(getConfidenceLabel('medium')).toBe('Confianza media');
      expect(getConfidenceLabel('low')).toBe('Baja confianza');
    });
  });

  describe('getConfidenceColor', () => {
    it('returns correct colors for each level', () => {
      expect(getConfidenceColor('high')).toBe('text-green-500');
      expect(getConfidenceColor('medium')).toBe('text-yellow-500');
      expect(getConfidenceColor('low')).toBe('text-red-500');
    });
  });
});
