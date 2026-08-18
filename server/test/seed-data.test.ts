import { describe, expect, it } from 'vitest';
import { createSeedData, stageDurationSeedData } from '../src/db/seed-data.js';

const expectedStages = [
  'RECEIVED',
  'EXTRACTION',
  'QUANTIFICATION',
  'LIBRARY_PREP',
  'SEQUENCING',
  'BIOINFORMATICS',
  'REVIEW',
  'DELIVERED'
];

describe('case seed data', () => {
  const reference = new Date('2026-08-17T12:00:00.000Z');
  const seedData = createSeedData(reference);

  it('covers every stage with realistic duration data', () => {
    expect(seedData.cases).toHaveLength(16);
    expect(new Set(seedData.cases.map((seedCase) => seedCase.currentStage))).toEqual(new Set(expectedStages));
    expect(stageDurationSeedData.map(({ stage }) => stage)).toEqual(expectedStages);
    expect(stageDurationSeedData.every(({ standardDays }) => Number.isInteger(standardDays) && standardDays >= 0)).toBe(true);
    expect(stageDurationSeedData.reduce((total, { standardDays }) => total + standardDays, 0)).toBe(21);
  });

  it('includes the required support scenarios', () => {
    expect(seedData.cases.some((seedCase) => seedCase.caseNumber === 'OTH-2026-0142' && seedCase.submittedAt.toISOString() === '2026-08-13T12:00:00.000Z')).toBe(true);
    expect(seedData.cases.some((seedCase) => seedCase.delayed)).toBe(true);
    expect(seedData.cases.some((seedCase) => seedCase.currentStage === 'DELIVERED')).toBe(true);
    expect(seedData.cases.filter((seedCase) => seedCase.customerEmail === 'maya.collins@othram-demo.test')).toHaveLength(3);
    expect(seedData.cases.some((seedCase) => seedCase.notes?.includes('Evidence is insufficient'))).toBe(true);
  });
});
