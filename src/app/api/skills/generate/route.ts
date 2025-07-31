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

  // 2. Search for similar questions using vector search
  const similarQuestions = await searchQuestionsBySkill(skillName, 10, 0.6);

  if (similarQuestions.length >= 3) {
    console.log(
      `Found ${similarQuestions.length} similar questions for skill: ${skillName}`
    );
    console.log(
      "Similar questions from skills:",
      similarQuestions
        .map((q) => `${q.skillName} (${q.similarity.toFixed(2)})`)
        .join(", ")
    );
    return Response.json({
      questions: similarQuestions.map((q) => q.text),
      similarQuestions: similarQuestions.map((q) => ({
        text: q.text,
        skillName: q.skillName,
        similarity: q.similarity,
      })),
      source: "vector_search",
    });
  }

  console.log(
    `Found only ${similarQuestions.length} similar questions for skill: ${skillName}. Generating new questions.`
  );

  // 3. Generate new questions with OpenAI
  const prompt = `Generate 5 interview questions for the skill "${skillName}"`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: prompt }],
  });

  const questionsText =
    completion.choices[0].message.content
      ?.split("\n")
      .filter((line) => line.trim())
      .map((q) => q.replace(/^\d+\.\s*/, "").trim()) || [];

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

  return Response.json({
    questions: questionsText,
    similarQuestions: similarQuestions.map((q) => ({
      text: q.text,
      skillName: q.skillName,
      similarity: q.similarity,
    })),
    source: "generated",
    message:
      similarQuestions.length > 0
        ? `Generated ${questionsText.length} new questions. Found ${similarQuestions.length} similar existing questions.`
        : `Generated ${questionsText.length} new questions. No similar questions found in database.`,
  });
}
