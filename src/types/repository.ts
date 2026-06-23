/** Normalized repository models. Mapped from raw GitHub REST responses. */

export interface RepositoryCandidate {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  archived: boolean;
  disabled: boolean;
  pushedAt: string | null;
  updatedAt: string | null;
}

export interface RepositoryProfile {
  repository: string;
  description: string | null;
  url: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
  archived: boolean;
  disabled: boolean;
  sizeKb: number;
}
