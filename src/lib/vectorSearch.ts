import { prisma } from "./prisma";
import { getEmbedding } from "./embedding";

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SimilarQuestion {
  id: number;
  text: string;
  skillId: number;
  skillName: string;
  similarity: number;
}

export async function searchSimilarQuestions(
  query: string,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<SimilarQuestion[]> {
  // Get embedding for the query
  const queryEmbedding = await getEmbedding(query);

  // Get all questions with their embeddings and skill names
  const questions = await prisma.question.findMany({
    include: {
      skill: {
        select: {
          name: true,
        },
      },
    },
  });

  // Calculate similarity scores
  const questionsWithSimilarity = questions
    .map((question) => {
      // Convert JSON embedding back to number array
      const questionEmbedding = question.embedding as number[];
      const similarity = cosineSimilarity(queryEmbedding, questionEmbedding);

      return {
        id: question.id,
        text: question.text,
        skillId: question.skillId,
        skillName: question.skill.name,
        similarity,
      };
    })
    .filter((q) => q.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return questionsWithSimilarity;
}

export async function searchQuestionsBySkill(
  skillName: string,
  limit: number = 10,
  minSimilarity: number = 0.6
): Promise<SimilarQuestion[]> {
  return searchSimilarQuestions(skillName, limit, minSimilarity);
}

export async function getQuestionsBySkillId(
  skillId: number,
  limit: number = 10
): Promise<SimilarQuestion[]> {
  // Get questions directly by skill ID
  const questions = await prisma.question.findMany({
    where: { skillId },
    include: {
      skill: {
        select: {
          name: true,
        },
      },
    },
    take: limit,
  });

  return questions.map((question) => ({
    id: question.id,
    text: question.text,
    skillId: question.skillId,
    skillName: question.skill.name,
    similarity: 1.0, // Direct match
  }));
}

export interface SimilarJobDescription {
  id: number;
  title: string | null;
  content: string;
  similarity: number;
  createdAt: Date;
}

export async function searchSimilarJobDescriptions(
  query: string,
  limit: number = 5,
  minSimilarity: number = 0.5
): Promise<SimilarJobDescription[]> {
  // Get embedding for the query
  const queryEmbedding = await getEmbedding(query);

  // Get all job descriptions with their embeddings
  const jobDescriptions = await prisma.jobDescription.findMany();

  // Calculate similarity scores
  const jdsWithSimilarity = jobDescriptions
    .map((jd) => {
      // Convert JSON embedding back to number array
      const jdEmbedding = jd.embedding as number[];
      const similarity = cosineSimilarity(queryEmbedding, jdEmbedding);

      return {
        id: jd.id,
        title: jd.title,
        content: jd.content,
        similarity,
        createdAt: jd.createdAt,
      };
    })
    .filter((jd) => jd.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return jdsWithSimilarity;
}
