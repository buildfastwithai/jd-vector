import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { searchQuestionsBySkill, getQuestionsWithConfidence } from "@/lib/vectorSearch";

export async function POST(req: Request) {
  const { skillName } = await req.json();

  // 1. Upsert skill
  let skill = await prisma.skill.findUnique({ where: { name: skillName } });
  if (!skill) {
    skill = await prisma.skill.create({ data: { name: skillName } });
  }

  // 2. Use the enhanced vector search to get 10 questions (7 existing + 3 new pattern)
  const questionsWithConfidence = await getQuestionsWithConfidence(
    skillName,
    skill.id,
    10
  );

  // If we have enough questions and don't need generation
  const needGeneration = questionsWithConfidence.some(q => q.needsGeneration);
  
  if (!needGeneration) {
    const existingCount = questionsWithConfidence.filter(q => q.source === "existing").length;
    const similarCount = questionsWithConfidence.filter(q => q.source === "similar").length;
    
    console.log(
      `Found ${questionsWithConfidence.length} questions for skill: ${skillName} (${existingCount} existing, ${similarCount} similar)`
    );
    
    return Response.json({
      questions: questionsWithConfidence.map((q) => q.text),
      similarQuestions: questionsWithConfidence.map((q) => ({
        text: q.text,
        skillName: q.skillName,
        similarity: q.similarity,
        source: q.source,
      })),
      source: existingCount > 0 ? "mixed" : "vector_search",
      existingCount,
      similarCount,
      generatedCount: 0,
    });
  }

  const needToGenerate = questionsWithConfidence.filter(q => q.needsGeneration).length;
  const existingCount = questionsWithConfidence.filter(q => q.source === "existing").length;
  const similarCount = questionsWithConfidence.filter(q => q.source === "similar").length;

  console.log(
    `Found ${existingCount + similarCount} questions for skill: ${skillName} (${existingCount} existing, ${similarCount} similar). Generating ${needToGenerate} new questions.`
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

  // Replace placeholders with generated questions
  let generatedIndex = 0;
  const finalQuestions = questionsWithConfidence.map((q) => {
    if (q.needsGeneration && generatedIndex < questionsText.length) {
      const newQuestion = {
        ...q,
        text: questionsText[generatedIndex],
        similarity: 1.0,
        needsGeneration: false,
        source: "generated" as const,
      };
      generatedIndex++;
      return newQuestion;
    }
    return q;
  });

  const finalExistingCount = finalQuestions.filter(q => q.source === "existing").length;
  const finalSimilarCount = finalQuestions.filter(q => q.source === "similar").length;
  const finalGeneratedCount = finalQuestions.filter(q => q.source === "generated").length;

  return Response.json({
    questions: finalQuestions.map((q) => q.text),
    similarQuestions: finalQuestions.map((q) => ({
      text: q.text,
      skillName: q.skillName,
      similarity: q.similarity,
      source: q.source,
    })),
    source: "mixed",
    existingCount: finalExistingCount,
    similarCount: finalSimilarCount,
    generatedCount: finalGeneratedCount,
    message: `Using ${finalExistingCount} existing + ${finalSimilarCount} similar + ${finalGeneratedCount} generated = ${finalQuestions.length} total questions.`,
  });
}
