export interface HealthResponse {
  status: 'ok';
  service: 'othram-support-server';
}

export const stages = [
  'RECEIVED',
  'EXTRACTION',
  'QUANTIFICATION',
  'LIBRARY_PREP',
  'SEQUENCING',
  'BIOINFORMATICS',
  'REVIEW',
  'DELIVERED'
] as const;

export type Stage = (typeof stages)[number];

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface Case {
  id: string;
  caseNumber: string;
  customerId: string;
  serviceType: string;
  currentStage: Stage;
  stageEnteredAt: Date;
  submittedAt: Date;
  delayed: boolean;
  notes: string | null;
}
