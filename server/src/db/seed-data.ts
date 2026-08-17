import type { Stage } from '@othram/shared';

export const stageDurationSeedData: ReadonlyArray<{ stage: Stage; standardDays: number }> = [
  { stage: 'RECEIVED', standardDays: 2 },
  { stage: 'EXTRACTION', standardDays: 10 },
  { stage: 'QUANTIFICATION', standardDays: 5 },
  { stage: 'LIBRARY_PREP', standardDays: 7 },
  { stage: 'SEQUENCING', standardDays: 14 },
  { stage: 'BIOINFORMATICS', standardDays: 10 },
  { stage: 'REVIEW', standardDays: 7 },
  { stage: 'DELIVERED', standardDays: 0 }
];

export interface SeedCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface SeedCase {
  caseNumber: string;
  customerEmail: string;
  serviceType: string;
  currentStage: Stage;
  stageEnteredAt: Date;
  submittedAt: Date;
  delayed: boolean;
  notes: string | null;
}

function daysBefore(reference: Date, days: number): Date {
  return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000);
}

function lastThursday(reference: Date): Date {
  const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 12));
  const daysSinceThursday = (date.getUTCDay() + 3) % 7 || 7;
  return daysBefore(date, daysSinceThursday);
}

export function createSeedData(reference = new Date()): {
  customers: ReadonlyArray<SeedCustomer>;
  cases: ReadonlyArray<SeedCase>;
} {
  const submittedLastThursday = lastThursday(reference);
  const customers = [
    { name: 'Jordan Lee', email: 'jordan.lee@othram-demo.test', phone: '+1-512-555-0101' },
    { name: 'Maya Collins', email: 'maya.collins@othram-demo.test', phone: '+1-512-555-0102' },
    { name: 'Detective Aaron Bell', email: 'aaron.bell@othram-demo.test', phone: '+1-512-555-0103' },
    { name: 'Priya Shah', email: 'priya.shah@othram-demo.test', phone: '+1-512-555-0104' },
    { name: 'Sgt. Elena Torres', email: 'elena.torres@othram-demo.test', phone: '+1-512-555-0105' },
    { name: 'Noah Williams', email: 'noah.williams@othram-demo.test', phone: '+1-512-555-0106' },
    { name: 'Dana Brooks', email: 'dana.brooks@othram-demo.test', phone: '+1-512-555-0107' },
    { name: 'Alex Morgan', email: 'alex.morgan@othram-demo.test', phone: '+1-512-555-0108' },
    { name: 'Lt. Samira Khan', email: 'samira.khan@othram-demo.test', phone: '+1-512-555-0109' },
    { name: 'Casey Nguyen', email: 'casey.nguyen@othram-demo.test', phone: '+1-512-555-0110' },
    { name: 'Morgan Price', email: 'morgan.price@othram-demo.test', phone: '+1-512-555-0111' },
    { name: 'Riley Chen', email: 'riley.chen@othram-demo.test', phone: '+1-512-555-0112' },
    { name: 'Jamie Patel', email: 'jamie.patel@othram-demo.test', phone: '+1-512-555-0113' },
    { name: 'Taylor Reed', email: 'taylor.reed@othram-demo.test', phone: '+1-512-555-0114' }
  ] as const;

  const cases = [
    { caseNumber: 'OTH-2026-0142', customerEmail: 'jordan.lee@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'RECEIVED', stageEnteredAt: submittedLastThursday, submittedAt: submittedLastThursday, delayed: false, notes: 'Submitted last Thursday; intake documentation is complete.' },
    { caseNumber: 'OTH-2026-0143', customerEmail: 'maya.collins@othram-demo.test', serviceType: 'Kinship testing', currentStage: 'EXTRACTION', stageEnteredAt: daysBefore(reference, 3), submittedAt: daysBefore(reference, 5), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0144', customerEmail: 'maya.collins@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'QUANTIFICATION', stageEnteredAt: daysBefore(reference, 2), submittedAt: daysBefore(reference, 16), delayed: false, notes: 'First of two active cases for this customer.' },
    { caseNumber: 'OTH-2026-0145', customerEmail: 'aaron.bell@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'LIBRARY_PREP', stageEnteredAt: daysBefore(reference, 4), submittedAt: daysBefore(reference, 27), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0146', customerEmail: 'priya.shah@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'SEQUENCING', stageEnteredAt: daysBefore(reference, 21), submittedAt: daysBefore(reference, 48), delayed: true, notes: 'Delayed: sequencing queue requires a verified technical update before a revised timeline is communicated.' },
    { caseNumber: 'OTH-2026-0147', customerEmail: 'elena.torres@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'BIOINFORMATICS', stageEnteredAt: daysBefore(reference, 6), submittedAt: daysBefore(reference, 58), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0148', customerEmail: 'noah.williams@othram-demo.test', serviceType: 'Kinship testing', currentStage: 'REVIEW', stageEnteredAt: daysBefore(reference, 5), submittedAt: daysBefore(reference, 70), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0149', customerEmail: 'dana.brooks@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'DELIVERED', stageEnteredAt: daysBefore(reference, 8), submittedAt: daysBefore(reference, 84), delayed: false, notes: 'Report delivered to the authorized recipient.' },
    { caseNumber: 'OTH-2026-0150', customerEmail: 'alex.morgan@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'RECEIVED', stageEnteredAt: daysBefore(reference, 1), submittedAt: daysBefore(reference, 1), delayed: false, notes: 'Evidence is insufficient for processing: additional approved material is required.' },
    { caseNumber: 'OTH-2026-0151', customerEmail: 'samira.khan@othram-demo.test', serviceType: 'Kinship testing', currentStage: 'EXTRACTION', stageEnteredAt: daysBefore(reference, 8), submittedAt: daysBefore(reference, 12), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0152', customerEmail: 'casey.nguyen@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'QUANTIFICATION', stageEnteredAt: daysBefore(reference, 1), submittedAt: daysBefore(reference, 23), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0153', customerEmail: 'maya.collins@othram-demo.test', serviceType: 'Kinship testing', currentStage: 'LIBRARY_PREP', stageEnteredAt: daysBefore(reference, 3), submittedAt: daysBefore(reference, 35), delayed: false, notes: 'Second active case for this customer.' },
    { caseNumber: 'OTH-2026-0154', customerEmail: 'morgan.price@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'SEQUENCING', stageEnteredAt: daysBefore(reference, 7), submittedAt: daysBefore(reference, 42), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0155', customerEmail: 'riley.chen@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'BIOINFORMATICS', stageEnteredAt: daysBefore(reference, 3), submittedAt: daysBefore(reference, 61), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0156', customerEmail: 'jamie.patel@othram-demo.test', serviceType: 'Kinship testing', currentStage: 'REVIEW', stageEnteredAt: daysBefore(reference, 2), submittedAt: daysBefore(reference, 74), delayed: false, notes: null },
    { caseNumber: 'OTH-2026-0157', customerEmail: 'taylor.reed@othram-demo.test', serviceType: 'Forensic DNA identification', currentStage: 'DELIVERED', stageEnteredAt: daysBefore(reference, 14), submittedAt: daysBefore(reference, 96), delayed: false, notes: 'Report delivered to the authorized recipient.' }
  ] as const satisfies ReadonlyArray<SeedCase>;

  return { customers, cases };
}
