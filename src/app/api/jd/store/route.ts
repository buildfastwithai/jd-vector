import { getEmbedding } from "@/lib/embedding";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { jobDescription, title } = await req.json();

    if (!jobDescription || !jobDescription.trim()) {
      return NextResponse.json(
        { error: "Job description is required" },
        { status: 400 }
      );
    }

    // Generate embedding for the job description
    const jdEmbedding = await getEmbedding(jobDescription.trim());

    // Store the job description
    const savedJD = await prisma.jobDescription.create({
      data: {
        title: title?.trim() || null,
        content: jobDescription.trim(),
        embedding: jdEmbedding,
      },
    });

    return NextResponse.json({
      success: true,
      jobDescriptionId: savedJD.id,
      message: "Job description stored successfully",
    });
  } catch (error) {
    console.error("Error storing job description:", error);
    return NextResponse.json(
      { error: "Failed to store job description" },
      { status: 500 }
    );
  }
}
