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
  // Use embedding-based search for skill-related questions
  console.log(
    `Searching for questions related to skill: ${skillName} using embeddings`
  );

  // Generate search query that includes the skill and question context
  const searchQuery = `${skillName} interview questions technical skills assessment`;
  return searchSimilarQuestions(searchQuery, limit, minSimilarity);
}

export interface SkillWithConfidence {
  id: number;
  name: string;
  confidence: number;
  source: "existing" | "extracted";
}

// Enhanced text similarity function for skill matching
function normalizeSkillName(skillName: string): string {
  return skillName
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove special characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

// In-memory cache for performance (secondary cache)
const aliasCache = new Map<string, string[]>();

async function getSkillAliases(skillName: string): Promise<string[]> {
  const normalized = normalizeSkillName(skillName);

  // Check in-memory cache first (fastest)
  if (aliasCache.has(normalized)) {
    return aliasCache.get(normalized)!;
  }

  // Check database for existing aliases
  try {
    const skill = await prisma.skill.findFirst({
      where: {
        OR: [
          { name: { equals: skillName, mode: "insensitive" } },
          {
            aliases: {
              some: { alias: { equals: normalized, mode: "insensitive" } },
            },
          },
        ],
      },
      include: {
        aliases: true,
      },
    });

    if (skill && skill.aliases.length > 0) {
      console.log(
        `Found ${skill.aliases.length} existing aliases for "${skillName}" in database`
      );
      const dbAliases = [
        normalized,
        skillName.trim(),
        skill.name,
        ...skill.aliases.map((a) => a.alias),
      ];
      const uniqueAliases = [
        ...new Set(dbAliases.map((a) => normalizeSkillName(a))),
      ];

      // Cache in memory for future use
      aliasCache.set(normalized, uniqueAliases);
      return uniqueAliases;
    }
  } catch (error) {
    console.error("Error fetching aliases from database:", error);
  }

  // No aliases in database, generate with AI
  console.log(
    `No aliases found for "${skillName}" in database. Generating with AI...`
  );
  const aliases = [normalized, skillName.trim()]; // Include original form

  try {
    // Use AI to generate aliases for the skill
    const { openai } = await import("./openai");

    const aliasPrompt = `Generate common aliases, abbreviations, and alternative names for the technical skill "${skillName}". 
Include variations with:
- Different spacing (e.g., "Next.js" vs "NextJS" vs "Next JS")
- Different formatting (e.g., "React.js" vs "ReactJS" vs "React")
- Common abbreviations (e.g., "JavaScript" vs "JS")
- Different capitalization
- Alternative names used in the industry

Return ONLY a JSON object with an "aliases" array containing strings. Maximum 8 aliases.

Example for "React":
{"aliases": ["react", "reactjs", "react.js", "react js"]}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: aliasPrompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 200,
    });

    const response = JSON.parse(completion.choices[0].message.content || "{}");
    const aiAliases = response.aliases || [];

    // Add AI-generated aliases
    if (Array.isArray(aiAliases)) {
      aiAliases.forEach((alias: string) => {
        if (typeof alias === "string" && alias.trim().length > 0) {
          aliases.push(normalizeSkillName(alias));
        }
      });
    }

    console.log(
      `Generated ${aliases.length} aliases for "${skillName}":`,
      aliases
    );

    // Store aliases in database for future use
    await storeSkillAliases(skillName, aliases);
  } catch (error) {
    console.error("Failed to generate AI aliases for", skillName, error);
    // Fallback to basic variations if AI fails
    const variations = [
      skillName.toLowerCase(),
      skillName.replace(/\s+/g, ""),
      skillName.replace(/\./g, ""),
      skillName.replace(/\s+/g, "."),
    ];
    aliases.push(...variations);
  }

  const uniqueAliases = [...new Set(aliases)];
  aliasCache.set(normalized, uniqueAliases);
  return uniqueAliases;
}

async function storeSkillAliases(
  skillName: string,
  aliases: string[]
): Promise<void> {
  try {
    // First, find or create the skill
    let skill = await prisma.skill.findFirst({
      where: { name: { equals: skillName, mode: "insensitive" } },
    });

    if (!skill) {
      skill = await prisma.skill.create({
        data: { name: skillName },
      });
    }

    // Store each alias (skip duplicates)
    for (const alias of aliases) {
      const normalizedAlias = normalizeSkillName(alias);
      if (
        normalizedAlias &&
        normalizedAlias !== normalizeSkillName(skill.name)
      ) {
        try {
          await prisma.skillAlias.upsert({
            where: {
              skillId_alias: {
                skillId: skill.id,
                alias: normalizedAlias,
              },
            },
            update: {}, // No update needed if exists
            create: {
              skillId: skill.id,
              alias: normalizedAlias,
            },
          });
        } catch (error) {
          // Ignore duplicate errors, continue with other aliases
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes("unique constraint")) {
            console.error("Error storing alias:", normalizedAlias, error);
          }
        }
      }
    }

    console.log(
      `Stored ${aliases.length} aliases for skill "${skillName}" in database`
    );
  } catch (error) {
    console.error("Error storing skill aliases:", error);
  }
}

async function calculateTextSimilarity(
  extractedSkill: string,
  existingSkill: string
): Promise<number> {
  const norm1 = normalizeSkillName(extractedSkill);
  const norm2 = normalizeSkillName(existingSkill);

  // Exact match
  if (norm1 === norm2) return 1.0;

  // Check if existing skill name matches any aliases of the extracted skill
  // Only generate aliases for the extracted skill, not the existing skill
  try {
    const extractedSkillAliases = await getSkillAliases(extractedSkill);

    // Check if existing skill matches any alias of extracted skill
    for (const alias of extractedSkillAliases) {
      if (normalizeSkillName(alias) === norm2) {
        return 0.95; // High confidence for alias matches
      }
    }
  } catch (error) {
    console.error("Error getting aliases for similarity check:", error);
  }

  // Substring match
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const longer = norm1.length > norm2.length ? norm1 : norm2;
    const shorter = norm1.length > norm2.length ? norm2 : norm1;
    return (shorter.length / longer.length) * 0.9; // Scaled down for partial matches
  }

  // Levenshtein distance for close matches
  const maxLen = Math.max(norm1.length, norm2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(norm1, norm2);
  const similarity = (maxLen - distance) / maxLen;

  // Only return if similarity is reasonably high
  return similarity >= 0.7 ? similarity * 0.8 : 0;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

export async function searchSkillsForJobDescription(
  jobDescription: string,
  extractedSkills: string[]
): Promise<SkillWithConfidence[]> {
  const skillsWithConfidence: SkillWithConfidence[] = [];

  // Get all existing skills
  const existingSkills = await prisma.skill.findMany();

  for (const extractedSkill of extractedSkills) {
    let bestMatch: SkillWithConfidence | null = null;

    // First, check text similarity (exact match and AI-generated aliases)
    for (const existingSkill of existingSkills) {
      const textSimilarity = await calculateTextSimilarity(
        extractedSkill,
        existingSkill.name
      );

      if (
        textSimilarity >= 0.9 &&
        (!bestMatch || textSimilarity > bestMatch.confidence)
      ) {
        bestMatch = {
          id: existingSkill.id,
          name: existingSkill.name,
          confidence: textSimilarity,
          source: "existing",
        };
      }
    }

    // If no good text match, try semantic similarity with embeddings
    if (!bestMatch || bestMatch.confidence < 0.95) {
      console.log(
        `No high-confidence text match for "${extractedSkill}". Trying semantic similarity...`
      );
      const extractedSkillEmbedding = await getEmbedding(extractedSkill);

      for (const existingSkill of existingSkills) {
        const skillEmbedding = await getEmbedding(existingSkill.name);
        const semanticSimilarity = cosineSimilarity(
          extractedSkillEmbedding,
          skillEmbedding
        );

        // Combine text and semantic similarity, prioritizing text similarity
        const combinedSimilarity =
          bestMatch && bestMatch.confidence > semanticSimilarity
            ? bestMatch.confidence
            : semanticSimilarity;

        if (
          semanticSimilarity >= 0.8 &&
          (!bestMatch || combinedSimilarity > bestMatch.confidence)
        ) {
          bestMatch = {
            id: existingSkill.id,
            name: existingSkill.name,
            confidence: semanticSimilarity,
            source: "existing",
          };
        }
      }
    }

    if (bestMatch && bestMatch.confidence >= 0.8) {
      console.log(
        `Matched "${extractedSkill}" → "${bestMatch.name}" (${(
          bestMatch.confidence * 100
        ).toFixed(1)}%)`
      );
      skillsWithConfidence.push(bestMatch);
    } else {
      // Create new skill or find existing one by name
      console.log(`Creating new skill: "${extractedSkill}"`);

      try {
        const newSkill = await prisma.skill.create({
          data: { name: extractedSkill },
        });

        skillsWithConfidence.push({
          id: newSkill.id,
          name: newSkill.name,
          confidence: 1.0,
          source: "extracted",
        });
      } catch (error) {
        // If skill already exists due to race condition, find it
        const existingSkill = await prisma.skill.findUnique({
          where: { name: extractedSkill },
        });

        if (existingSkill) {
          console.log(
            `Found existing skill after create failed: "${extractedSkill}"`
          );
          skillsWithConfidence.push({
            id: existingSkill.id,
            name: existingSkill.name,
            confidence: 1.0,
            source: "extracted",
          });
        } else {
          console.error(
            `Failed to create or find skill: "${extractedSkill}"`,
            error
          );
          // Skip this skill if we can't create or find it
        }
      }
    }
  }

  return skillsWithConfidence;
}

export interface QuestionWithConfidence extends SimilarQuestion {
  needsGeneration: boolean;
  source: "existing" | "similar" | "generated";
}

export async function getQuestionsWithConfidence(
  skillName: string,
  skillId: number,
  limit: number = 10
): Promise<QuestionWithConfidence[]> {
  // Generate random distribution for existing vs generated questions
  // Force randomization regardless of what's available in database
  const existingCount = Math.floor(Math.random() * 6) + 2; // 2-7 existing
  const generatedCount = limit - existingCount; // rest are generated

  console.log(
    `For skill ${skillName}: Forcing ${existingCount} existing + ${generatedCount} generated questions`
  );

  // Get all available questions for this skill to choose from
  const allAvailableQuestions = await getQuestionsBySkillId(skillId, 50); // Get up to 50 to choose from

  // Get vector search questions to use as backup
  const vectorQuestions = await searchQuestionsBySkill(
    skillName,
    30, // Get more options
    0.6
  );

  // Filter vector questions to exclude questions from same skill
  const uniqueVectorQuestions = vectorQuestions.filter(
    (vq) => vq.skillId !== skillId
  );

  const result: QuestionWithConfidence[] = [];

  // Add existing questions (up to our random limit)
  const selectedExisting = allAvailableQuestions.slice(0, existingCount);
  selectedExisting.forEach((q) => {
    result.push({
      ...q,
      needsGeneration: false,
      source: "existing" as const,
    });
  });

  // Fill remaining slots with vector search questions or placeholders for generation
  const remainingSlots = limit - result.length;

  if (remainingSlots > 0) {
    // Use vector questions if available, but mark them as needing generation
    const vectorQuestionsToUse = uniqueVectorQuestions.slice(0, remainingSlots);

    vectorQuestionsToUse.forEach((q) => {
      result.push({
        ...q,
        needsGeneration: true, // Force these to be regenerated for variety
        source: "generated" as const,
      });
    });

    // If we still need more, add placeholders
    const stillNeeded = remainingSlots - vectorQuestionsToUse.length;
    for (let i = 0; i < stillNeeded; i++) {
      result.push({
        id: -1,
        text: `Generated question ${i + 1} needed`,
        skillId,
        skillName,
        similarity: 0.0,
        needsGeneration: true,
        source: "generated" as const,
      });
    }
  }

  console.log(
    `Final distribution for ${skillName}: ${
      result.filter((q) => q.source === "existing").length
    } existing, ${
      result.filter((q) => q.source === "generated").length
    } generated`
  );

  return result;
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
