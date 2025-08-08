import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  searchSimilarJobDescriptions,
  searchQuestionsBySkill,
  getQuestionsBySkillId,
  searchSkillsForJobDescription,
  getQuestionsWithConfidence,
  SkillWithConfidence,
  QuestionWithConfidence,
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
      0.9
    );

    if (similarJDs.length > 0 && similarJDs[0].similarity >= 0.9) {
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

      // Get questions with confidence scores for each skill
      const skillsWithQuestions = await Promise.all(
        existingSkills.map(async (skill) => {
          // First, check if questions already exist in database for this skill
          const existingQuestions = await prisma.question.findMany({
            where: { skillId: skill.id },
            take: 5,
          });

          if (existingQuestions.length >= 5) {
            console.log(
              `Found ${existingQuestions.length} existing questions for ${skill.name} in database, using them`
            );
            
            return {
              id: skill.id,
              name: skill.name,
              confidence: 1.0, // Existing skills from similar JD have high confidence
              questions: existingQuestions.map((q) => ({
                text: q.text,
                confidence: 1.0, // Direct database match has 100% confidence
                source: "existing" as "existing",
              })),
            };
          }

          // If we don't have enough questions in database, check with vector search
          const questionsWithConfidence = await getQuestionsWithConfidence(
            skill.name,
            skill.id,
            5
          );

          // Check if we need to generate questions (similarity < 90%)
          const needGeneration = questionsWithConfidence.some(
            (q) => q.needsGeneration
          );

          if (needGeneration) {
            const lowConfidenceQuestions = questionsWithConfidence.filter(
              (q) => q.needsGeneration
            );
            console.log(
              `Generating ${lowConfidenceQuestions.length} new questions for ${skill.name} (not enough in database)`
            );

            const questionsPrompt = `Generate ${lowConfidenceQuestions.length} technical interview questions for the skill "${skill.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

            const questionsCompletion = await openai.chat.completions.create({
              model: "gpt-4.1",
              messages: [{ role: "user", content: questionsPrompt }],
              temperature: 0.7,
              response_format: { type: "json_object" },
            });

            let generatedQuestions: string[] = [];
            try {
              const response = JSON.parse(
                questionsCompletion.choices[0].message.content || "{}"
              );
              generatedQuestions = response.questions || [];
            } catch (error) {
              console.error("Failed to parse questions JSON:", error);
              generatedQuestions =
                questionsCompletion.choices[0].message.content
                  ?.split("\n")
                  .filter((line) => line.trim())
                  .map((q) => q.replace(/^\d+\.\s*/, "").trim())
                  .filter((q) => q.length > 0) || [];
            }

            // Store new questions with embeddings
            for (const questionText of generatedQuestions) {
              const questionEmbedding = await getEmbedding(questionText);
              await prisma.question.create({
                data: {
                  text: questionText,
                  skillId: skill.id,
                  embedding: questionEmbedding,
                },
              });
            }

            // Replace low confidence questions with generated ones
            let generatedIndex = 0;
            for (let i = 0; i < questionsWithConfidence.length; i++) {
              if (
                questionsWithConfidence[i].needsGeneration &&
                generatedIndex < generatedQuestions.length
              ) {
                questionsWithConfidence[i] = {
                  id: -1,
                  text: generatedQuestions[generatedIndex],
                  skillId: skill.id,
                  skillName: skill.name,
                  similarity: 1.0, // New generated questions have 100% confidence
                  needsGeneration: false,
                };
                generatedIndex++;
              }
            }
          }

          return {
            id: skill.id,
            name: skill.name,
            confidence: 1.0, // Existing skills from similar JD have high confidence
            questions: questionsWithConfidence.map((q) => ({
              text: q.text,
              confidence: q.similarity,
              source: q.needsGeneration
                ? "generated"
                : ("existing" as "generated" | "existing"),
            })),
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
        ).toFixed(1)}% (below 90% threshold). Treating as new JD.`
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

    // 5. Process skills with confidence scores
    const skillsWithConfidence = await searchSkillsForJobDescription(
      jobDescription,
      extractedSkills
    );

    // Link skills to job description and get questions
    const skillsWithQuestions = await Promise.all(
      skillsWithConfidence.map(async (skillWithConf) => {
        // Link skill to job description
        await prisma.jobDescriptionSkill.create({
          data: {
            jobDescriptionId: savedJD.id,
            skillId: skillWithConf.id,
          },
        });

        // First, check if questions already exist in database for this skill
        const existingQuestions = await prisma.question.findMany({
          where: { skillId: skillWithConf.id },
          take: 5,
        });

        if (existingQuestions.length >= 5) {
          console.log(
            `Found ${existingQuestions.length} existing questions for ${skillWithConf.name} in database, using them`
          );
          
          return {
            id: skillWithConf.id,
            name: skillWithConf.name,
            confidence: skillWithConf.confidence,
            source: skillWithConf.source,
            questions: existingQuestions.map((q) => ({
              text: q.text,
              confidence: 1.0, // Direct database match has 100% confidence
              source: "existing" as "existing",
            })),
          };
        }

        // If we don't have enough questions in database, check with vector search
        const questionsWithConfidence = await getQuestionsWithConfidence(
          skillWithConf.name,
          skillWithConf.id,
          5
        );

        // Check if we need to generate questions (similarity < 90%)
        const needGeneration = questionsWithConfidence.some(
          (q) => q.needsGeneration
        );

        if (needGeneration) {
          const lowConfidenceQuestions = questionsWithConfidence.filter(
            (q) => q.needsGeneration
          );
          console.log(
            `Generating ${lowConfidenceQuestions.length} new questions for ${skillWithConf.name} (not enough in database)`
          );

          const questionsPrompt = `Generate ${lowConfidenceQuestions.length} technical interview questions for the skill "${skillWithConf.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

          const questionsCompletion = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "user", content: questionsPrompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
          });

          let generatedQuestions: string[] = [];
          try {
            const response = JSON.parse(
              questionsCompletion.choices[0].message.content || "{}"
            );
            generatedQuestions = response.questions || [];
          } catch (error) {
            console.error("Failed to parse questions JSON:", error);
            generatedQuestions =
              questionsCompletion.choices[0].message.content
                ?.split("\n")
                .filter((line) => line.trim())
                .map((q) => q.replace(/^\d+\.\s*/, "").trim())
                .filter((q) => q.length > 0) || [];
          }

          // Store new questions with embeddings
          for (const questionText of generatedQuestions) {
            const questionEmbedding = await getEmbedding(questionText);
            await prisma.question.create({
              data: {
                text: questionText,
                skillId: skillWithConf.id,
                embedding: questionEmbedding,
              },
            });
          }

          // Replace low confidence questions with generated ones
          let generatedIndex = 0;
          for (let i = 0; i < questionsWithConfidence.length; i++) {
            if (
              questionsWithConfidence[i].needsGeneration &&
              generatedIndex < generatedQuestions.length
            ) {
              questionsWithConfidence[i] = {
                id: -1,
                text: generatedQuestions[generatedIndex],
                skillId: skillWithConf.id,
                skillName: skillWithConf.name,
                similarity: 1.0, // New generated questions have 100% confidence
                needsGeneration: false,
              };
              generatedIndex++;
            }
          }
        }

        return {
          id: skillWithConf.id,
          name: skillWithConf.name,
          confidence: skillWithConf.confidence,
          source: skillWithConf.source,
          questions: questionsWithConfidence.map((q) => ({
            text: q.text,
            confidence: q.similarity,
            source: q.needsGeneration
              ? "generated"
              : ("existing" as "generated" | "existing"),
          })),
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
