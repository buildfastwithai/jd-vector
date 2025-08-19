export interface Question {
  text: string;
  confidence: number;
  source: "existing" | "similar" | "generated";
}

export interface Skill {
  id: number;
  name: string;
  confidence: number;
  source?: "existing" | "extracted";
  questions: Question[];
  existingCount?: number;
  similarCount?: number;
  generatedCount?: number;
}

export interface SimilarJD {
  id: number;
  title: string | null;
  similarity: number;
  content: string;
}

export interface AnalyzeResponse {
  source: "similar_jd" | "extracted";
  jobDescriptionId?: number;
  skills: Skill[];
  similarJDs?: SimilarJD[];
  message: string;
}

export interface SimilarQuestion {
  text: string;
  skillName: string;
  similarity: number;
  source?: "existing" | "similar" | "generated";
}

export interface GenerateResponse {
  questions: string[];
  similarQuestions?: SimilarQuestion[];
  source: "vector_search" | "generated" | "mixed";
  message?: string;
  existingCount?: number;
  similarCount?: number;
  generatedCount?: number;
}
