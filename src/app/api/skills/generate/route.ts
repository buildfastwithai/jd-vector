import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { skillName } = await req.json();

  // 1. Upsert skill
  let skill = await prisma.skill.findUnique({ where: { name: skillName } });
  if (!skill) {
    skill = await prisma.skill.create({ data: { name: skillName } });
  }

  // 2. Check for existing questions for this skill
  const existingQuestions = await prisma.question.findMany({
    where: { skillId: skill.id },
    select: { text: true },
  });

  if (existingQuestions.length > 0) {
    console.log(
      `Using ${existingQuestions.length} existing questions for skill: ${skillName}`
    );
    return Response.json({
      questions: existingQuestions.map((q: { text: string }) => q.text),
      source: "existing",
    });
  }

  console.log(
    `No existing questions found for skill: ${skillName}. Generating new questions.`
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
    source: "generated",
  });
}
