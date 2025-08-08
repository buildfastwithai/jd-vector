import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { searchQuestionsBySkill } from "@/lib/vectorSearch";

export async function POST(req: Request) {
  const { skillName } = await req.json();

  // 1. Upsert skill
  let skill = await prisma.skill.findUnique({ where: { name: skillName } });
  if (!skill) {
    skill = await prisma.skill.create({ data: { name: skillName } });
  }

  // 2. First, check if questions already exist in database for this skill
  const existingQuestions = await prisma.question.findMany({
    where: { skillId: skill.id },
    take: 5,
  });

  if (existingQuestions.length >= 5) {
    console.log(
      `Found ${existingQuestions.length} existing questions for skill: ${skillName} in database, using them`
    );
    return Response.json({
      questions: existingQuestions.map((q) => q.text),
      similarQuestions: existingQuestions.map((q) => ({
        text: q.text,
        skillName: skillName,
        similarity: 1.0,
      })),
      source: "database",
      existingCount: existingQuestions.length,
      generatedCount: 0,
    });
  }

  // 3. If not enough in database, search for similar questions using vector search
  const similarQuestions = await searchQuestionsBySkill(skillName, 10, 0.6);

  if (similarQuestions.length >= 5) {
    console.log(
      `Found ${similarQuestions.length} similar questions for skill: ${skillName}, using first 5`
    );
    const selectedQuestions = similarQuestions.slice(0, 5);
    return Response.json({
      questions: selectedQuestions.map((q) => q.text),
      similarQuestions: selectedQuestions.map((q) => ({
        text: q.text,
        skillName: q.skillName,
        similarity: q.similarity,
      })),
      source: "vector_search",
      existingCount: 5,
      generatedCount: 0,
    });
  }

  const existingCount = Math.max(
    existingQuestions.length,
    similarQuestions.length
  );
  const needToGenerate = 5 - existingCount;

  console.log(
    `Found ${existingCount} questions for skill: ${skillName} (${existingQuestions.length} from database, ${similarQuestions.length} from vector search). Generating ${needToGenerate} new questions.`
  );

  // 3. Generate new questions with OpenAI
  const prompt = `Generate ${needToGenerate} interview questions for the skill "${skillName}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  let questionsText: string[] = [];
  try {
    const response = JSON.parse(completion.choices[0].message.content || "{}");
    questionsText = response.questions || [];
  } catch (error) {
    console.error("Failed to parse questions JSON:", error);
    // Fallback to text parsing
    questionsText =
      completion.choices[0].message.content
        ?.split("\n")
        .filter((line) => line.trim())
        .map((q) => q.replace(/^\d+\.\s*/, "").trim()) || [];
  }

  // 4. Store new questions with embeddings
  for (const questionText of questionsText) {
    const qEmbed = await getEmbedding(questionText);
    await prisma.question.create({
      data: {
        text: questionText,
        skillId: skill.id,
        embedding: qEmbed,
      },
    });
  }

  console.log(
    `Generated and stored ${questionsText.length} new questions for skill: ${skillName}`
  );

  // Combine existing and new questions to make exactly 5
  const allQuestions = [
    ...existingQuestions.map((q) => q.text),
    ...similarQuestions.map((q) => q.text),
    ...questionsText,
  ].slice(0, 5);

  return Response.json({
    questions: allQuestions,
    similarQuestions: [
      ...existingQuestions.map((q) => ({
        text: q.text,
        skillName: skillName,
        similarity: 1.0,
      })),
      ...similarQuestions.map((q) => ({
        text: q.text,
        skillName: q.skillName,
        similarity: q.similarity,
      })),
    ],
    source: "mixed",
    existingCount: existingCount,
    generatedCount: questionsText.length,
    message: `Using ${existingCount} existing questions and generated ${questionsText.length} new questions.`,
  });
}
