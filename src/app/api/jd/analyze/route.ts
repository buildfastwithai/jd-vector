import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  searchSimilarJobDescriptions,
  searchQuestionsBySkill,
  getQuestionsBySkillId,
} from "@/lib/vectorSearch";

export async function POST(req: Request) {
  const { jobDescription, title } = await req.json();

  if (!jobDescription) {
    return Response.json(
      { error: "Job description is required" },
      { status: 400 }
    );
  }

  try {
    // 1. Generate embedding for the job description
    const jdEmbedding = await getEmbedding(jobDescription);

    // 2. Search for similar job descriptions
    const similarJDs = await searchSimilarJobDescriptions(
      jobDescription,
      3,
      0.5
    );

    if (similarJDs.length > 0 && similarJDs[0].similarity >= 0.5) {
      console.log(
        `Found ${
          similarJDs.length
        } similar job descriptions with highest similarity: ${(
          similarJDs[0].similarity * 100
        ).toFixed(1)}%`
      );

      // Get skills from the most similar JD
      const mostSimilarJD = similarJDs[0];
      const jdWithSkills = await prisma.jobDescription.findUnique({
        where: { id: mostSimilarJD.id },
        include: {
          skills: {
            include: {
              skill: true,
            },
          },
        },
      });

      const existingSkills =
        jdWithSkills?.skills.map((jds) => ({
          id: jds.skill.id,
          name: jds.skill.name,
        })) || [];

      // Get questions for each skill - first try direct lookup, then vector search
      const skillsWithQuestions = await Promise.all(
        existingSkills.map(async (skill) => {
          // First: Get questions directly by skill ID
          const directQuestions = await getQuestionsBySkillId(skill.id, 10);

          if (directQuestions.length >= 5) {
            console.log(
              `Found ${directQuestions.length} direct questions for ${skill.name}, using first 5`
            );
            const selectedQuestions = directQuestions.slice(0, 5);
            return {
              ...skill,
              questions: selectedQuestions.map((q) => q.text),
              hasExistingQuestions: true,
              existingCount: 5,
              generatedCount: 0,
            };
          }

          // Second: Try vector search for additional similar questions
          let allExistingQuestions = [...directQuestions];
          if (directQuestions.length < 5) {
            const vectorQuestions = await searchQuestionsBySkill(
              skill.name,
              10 - directQuestions.length,
              0.6
            );
            // Filter out questions we already have
            const newVectorQuestions = vectorQuestions.filter(
              (vq) => !directQuestions.some((dq) => dq.id === vq.id)
            );
            allExistingQuestions = [...directQuestions, ...newVectorQuestions];
          }

          if (allExistingQuestions.length >= 5) {
            console.log(
              `Found ${allExistingQuestions.length} total questions for ${
                skill.name
              } (${directQuestions.length} direct + ${
                allExistingQuestions.length - directQuestions.length
              } similar), using first 5`
            );
            const selectedQuestions = allExistingQuestions.slice(0, 5);
            return {
              ...skill,
              questions: selectedQuestions.map((q) => q.text),
              hasExistingQuestions: true,
              existingCount: 5,
              generatedCount: 0,
            };
          }

          // Generate new questions for this skill
          const existingCount = allExistingQuestions.length;
          const needToGenerate = 5 - existingCount;

          console.log(
            `Generating ${needToGenerate} new questions for ${
              skill.name
            } (found ${existingCount} existing: ${
              directQuestions.length
            } direct + ${existingCount - directQuestions.length} similar)`
          );
          const questionsPrompt = `Generate ${needToGenerate} technical interview questions for the skill "${skill.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

          const questionsCompletion = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "user", content: questionsPrompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
          });

          let questionsText: string[] = [];
          try {
            const response = JSON.parse(
              questionsCompletion.choices[0].message.content || "{}"
            );
            questionsText = response.questions || [];
          } catch (error) {
            console.error("Failed to parse questions JSON:", error);
            // Fallback to text parsing
            questionsText =
              questionsCompletion.choices[0].message.content
                ?.split("\n")
                .filter((line) => line.trim())
                .map((q) => q.replace(/^\d+\.\s*/, "").trim())
                .filter((q) => q.length > 0) || [];
          }

          // Store new questions with embeddings
          for (const questionText of questionsText) {
            const questionEmbedding = await getEmbedding(questionText);
            await prisma.question.create({
              data: {
                text: questionText,
                skillId: skill.id,
                embedding: questionEmbedding,
              },
            });
          }

          // Combine existing and new questions to make exactly 5
          const allQuestions = [
            ...allExistingQuestions.map((q) => q.text),
            ...questionsText,
          ].slice(0, 5);

          return {
            ...skill,
            questions: allQuestions,
            hasExistingQuestions: false,
            existingCount,
            generatedCount: questionsText.length,
          };
        })
      );

      return Response.json({
        source: "similar_jd",
        similarJDs: similarJDs.map((jd) => ({
          id: jd.id,
          title: jd.title,
          similarity: jd.similarity,
          content: jd.content.substring(0, 200) + "...",
        })),
        skills: skillsWithQuestions,
        message: `Found similar job description (${(
          similarJDs[0].similarity * 100
        ).toFixed(1)}% match). Using existing skills.`,
      });
    }

    // 3. No similar JD found or similarity too low, extract skills using OpenAI
    if (similarJDs.length > 0) {
      console.log(
        `Similar JDs found but highest similarity is ${(
          similarJDs[0].similarity * 100
        ).toFixed(1)}% (below 50% threshold). Treating as new JD.`
      );
    } else {
      console.log(
        "No similar job descriptions found. Extracting skills from JD."
      );
    }

    const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${jobDescription}`;

    const skillsCompletion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: skillsPrompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const skillsText = skillsCompletion.choices[0].message.content;
    let extractedSkills: string[] = [];

    try {
      const response = JSON.parse(skillsText || "{}");
      extractedSkills = response.skills || [];

      // Ensure it's an array of strings
      if (!Array.isArray(extractedSkills)) {
        throw new Error("Response is not an array");
      }

      // Clean and filter skills
      extractedSkills = extractedSkills
        .filter((skill) => typeof skill === "string" && skill.trim().length > 0)
        .map((skill) => skill.trim())
        .slice(0, 15); // Limit to 15 skills max
    } catch (error) {
      console.error("Failed to parse skills JSON:", error);
      console.log("Raw OpenAI response:", skillsText);

      // Fallback: try to extract skills from text
      extractedSkills =
        skillsText
          ?.split("\n")
          .filter((line) => line.trim())
          .map((line) => line.replace(/[^a-zA-Z0-9\s\+\#\.\-]/g, "").trim())
          .filter((skill) => skill.length > 0 && skill.length < 50) // Remove very long lines
          .slice(0, 10) || [];
    }

    console.log("Extracted skills:", extractedSkills);

    // 4. Store the job description
    const savedJD = await prisma.jobDescription.create({
      data: {
        title: title || null,
        content: jobDescription,
        embedding: jdEmbedding,
      },
    });

    // 5. Process each skill
    const skillsWithQuestions = await Promise.all(
      extractedSkills.map(async (skillName) => {
        // Upsert skill
        let skill = await prisma.skill.findUnique({
          where: { name: skillName },
        });
        if (!skill) {
          skill = await prisma.skill.create({ data: { name: skillName } });
        }

        // Link skill to job description
        await prisma.jobDescriptionSkill.create({
          data: {
            jobDescriptionId: savedJD.id,
            skillId: skill.id,
          },
        });

        // Check for existing questions using vector search
        const existingQuestions = await searchQuestionsBySkill(
          skillName,
          10,
          0.6
        );

        if (existingQuestions.length >= 5) {
          console.log(
            `Found ${existingQuestions.length} existing questions for ${skillName}, using first 5`
          );
          const selectedQuestions = existingQuestions.slice(0, 5);
          return {
            id: skill.id,
            name: skillName,
            questions: selectedQuestions.map((q) => q.text),
            hasExistingQuestions: true,
            existingCount: 5,
            generatedCount: 0,
          };
        }

        // Generate new questions for this skill
        const existingCount = existingQuestions.length;
        const needToGenerate = 5 - existingCount;

        console.log(
          `Generating ${needToGenerate} new questions for ${skillName} (found ${existingCount} existing)`
        );
        const questionsPrompt = `Generate ${needToGenerate} technical interview questions for the skill "${skillName}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

        const questionsCompletion = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [{ role: "user", content: questionsPrompt }],
          temperature: 0.7,
          response_format: { type: "json_object" },
        });

        let questionsText: string[] = [];
        try {
          const response = JSON.parse(
            questionsCompletion.choices[0].message.content || "{}"
          );
          questionsText = response.questions || [];
        } catch (error) {
          console.error("Failed to parse questions JSON:", error);
          // Fallback to text parsing
          questionsText =
            questionsCompletion.choices[0].message.content
              ?.split("\n")
              .filter((line) => line.trim())
              .map((q) => q.replace(/^\d+\.\s*/, "").trim())
              .filter((q) => q.length > 0) || [];
        }

        // Store new questions with embeddings
        for (const questionText of questionsText) {
          const questionEmbedding = await getEmbedding(questionText);
          await prisma.question.create({
            data: {
              text: questionText,
              skillId: skill.id,
              embedding: questionEmbedding,
            },
          });
        }

        // Combine existing and new questions to make exactly 5
        const allQuestions = [
          ...existingQuestions.map((q) => q.text),
          ...questionsText,
        ].slice(0, 5);

        return {
          id: skill.id,
          name: skillName,
          questions: allQuestions,
          hasExistingQuestions: false,
          existingCount,
          generatedCount: questionsText.length,
        };
      })
    );

    return Response.json({
      source: "extracted",
      jobDescriptionId: savedJD.id,
      skills: skillsWithQuestions,
      message: `Extracted ${extractedSkills.length} skills from job description and processed questions.`,
    });
  } catch (error) {
    console.error("Error analyzing job description:", error);
    return Response.json(
      { error: "Failed to analyze job description" },
      { status: 500 }
    );
  }
}
