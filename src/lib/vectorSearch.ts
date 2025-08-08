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
  minSimilarity: number = 0.9
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

export interface SkillWithConfidence {
  id: number;
  name: string;
  confidence: number;
  source: "existing" | "extracted";
}

export async function searchSkillsForJobDescription(
  jobDescription: string,
  extractedSkills: string[]
): Promise<SkillWithConfidence[]> {
  const skillsWithConfidence: SkillWithConfidence[] = [];

  // Get all existing skills
  const existingSkills = await prisma.skill.findMany();

  for (const extractedSkill of extractedSkills) {
    // Find exact match first
    const exactMatch = existingSkills.find(
      (skill) => skill.name.toLowerCase() === extractedSkill.toLowerCase()
    );

    if (exactMatch) {
      skillsWithConfidence.push({
        id: exactMatch.id,
        name: exactMatch.name,
        confidence: 1.0,
        source: "existing",
      });
      continue;
    }

    // Calculate semantic similarity with existing skills
    const extractedSkillEmbedding = await getEmbedding(extractedSkill);
    let bestMatch: SkillWithConfidence | null = null;

    for (const existingSkill of existingSkills) {
      const skillEmbedding = await getEmbedding(existingSkill.name);
      const similarity = cosineSimilarity(
        extractedSkillEmbedding,
        skillEmbedding
      );

      if (
        similarity >= 0.8 &&
        (!bestMatch || similarity > bestMatch.confidence)
      ) {
        bestMatch = {
          id: existingSkill.id,
          name: existingSkill.name,
          confidence: similarity,
          source: "existing",
        };
      }
    }

    if (bestMatch) {
      skillsWithConfidence.push(bestMatch);
    } else {
      // Create new skill
      const newSkill = await prisma.skill.create({
        data: { name: extractedSkill },
      });

      skillsWithConfidence.push({
        id: newSkill.id,
        name: newSkill.name,
        confidence: 1.0,
        source: "extracted",
      });
    }
  }

  return skillsWithConfidence;
}

export interface QuestionWithConfidence extends SimilarQuestion {
  needsGeneration: boolean;
}

export async function getQuestionsWithConfidence(
  skillName: string,
  skillId: number,
  limit: number = 5
): Promise<QuestionWithConfidence[]> {
  // First try to get questions directly by skill ID
  const directQuestions = await getQuestionsBySkillId(skillId, limit);

  if (directQuestions.length >= limit) {
    return directQuestions.map((q) => ({
      ...q,
      needsGeneration: false,
    }));
  }

  // Then try vector search for similar questions
  const vectorQuestions = await searchQuestionsBySkill(
    skillName,
    limit - directQuestions.length,
    0.9 // 90% similarity threshold
  );

  // Filter out duplicates
  const uniqueVectorQuestions = vectorQuestions.filter(
    (vq) => !directQuestions.some((dq) => dq.id === vq.id)
  );

  const allQuestions = [...directQuestions, ...uniqueVectorQuestions];

  // If we still don't have enough questions with 90% confidence, mark for generation
  const questionsWithConfidence = allQuestions.slice(0, limit).map((q) => ({
    ...q,
    needsGeneration: q.similarity < 0.9,
  }));

  // If we have fewer than the limit, we'll need to generate more
  if (questionsWithConfidence.length < limit) {
    const needed = limit - questionsWithConfidence.length;
    for (let i = 0; i < needed; i++) {
      questionsWithConfidence.push({
        id: -1, // Placeholder for generated questions
        text: `Generated question ${i + 1} needed`,
        skillId,
        skillName,
        similarity: 0.0,
        needsGeneration: true,
      });
    }
  }

  return questionsWithConfidence;
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
  minSimilarity: number = 0.7
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
