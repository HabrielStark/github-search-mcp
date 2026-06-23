export interface ScoreWeights {
  relevance: number;
  maintenance: number;
  license: number;
  documentation: number;
  adoption: number;
  integration: number;
}

export interface ScoreReport {
  total: number;
  relevance: number;
  maintenance: number;
  license: number;
  documentation: number;
  adoption: number;
  integration: number;
  reasons: string[];
}
