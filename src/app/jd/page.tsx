"use client";

import { useState } from "react";
import SkillsTable from "@/components/SkillsTable";
import QuestionsTable from "@/components/QuestionsTable";

interface Question {
  text: string;
  confidence: number;
  source: "existing" | "generated";
}

interface Skill {
  id: number;
  name: string;
  confidence: number;
  source?: "existing" | "extracted";
  questions: Question[];
}

interface SimilarJD {
  id: number;
  title: string | null;
  similarity: number;
  content: string;
}

interface AnalyzeResponse {
  source: "similar_jd" | "extracted";
  jobDescriptionId?: number;
  skills: Skill[];
  similarJDs?: SimilarJD[];
  message: string;
}

export default function JobDescriptionAnalyzer() {
  const [jobDescription, setJobDescription] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const analyzeJD = async () => {
    if (!jobDescription.trim()) {
      setError("Please enter a job description");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/jd/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobDescription: jobDescription.trim(),
          title: title.trim() || null,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to analyze job description");
      }

      const data: AnalyzeResponse = await res.json();
      setResult(data);
    } catch (error) {
      console.error("Error analyzing job description:", error);
      setError("Failed to analyze job description. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearForm = () => {
    setJobDescription("");
    setTitle("");
    setResult(null);
    setError("");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Job Description Analyzer
          </h1>
          <p className="text-gray-600 mb-6">
            Analyze job descriptions with AI-powered skill extraction and
            intelligent question generation. Features confidence scoring and
            automatic question generation when similarity is below 90%.
          </p>

          {/* Input Form */}
          <div className="space-y-4">
            <div>
              <label
                htmlFor="title"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Job Title (Optional)
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Senior Frontend Developer"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isAnalyzing}
              />
            </div>

            <div>
              <label
                htmlFor="jobDescription"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Job Description *
              </label>
              <textarea
                id="jobDescription"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the complete job description here..."
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
                disabled={isAnalyzing}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={analyzeJD}
                disabled={isAnalyzing || !jobDescription.trim()}
                className={`px-6 py-2 rounded-md font-medium ${
                  isAnalyzing || !jobDescription.trim()
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {isAnalyzing ? "Analyzing..." : "Analyze Job Description"}
              </button>

              {result && (
                <button
                  onClick={clearForm}
                  className="px-6 py-2 rounded-md font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                >
                  Clear & Start Over
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Status Message */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {result.source === "similar_jd" ? (
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <span className="text-green-600 text-lg">✨</span>
                    </div>
                  ) : (
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 text-lg">🤖</span>
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {result.source === "similar_jd"
                      ? "Similar Job Description Found!"
                      : "Skills Extracted Successfully!"}
                  </h3>
                  <p className="text-gray-600 mt-1">{result.message}</p>
                </div>
              </div>
            </div>

            {/* Similar JDs (if found) */}
            {result.similarJDs && result.similarJDs.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">
                  Similar Job Descriptions
                </h3>
                <div className="space-y-3">
                  {result.similarJDs.map((jd) => (
                    <div
                      key={jd.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-medium text-gray-900">
                          {jd.title || "Untitled Job Description"}
                        </h4>
                        <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                          {(jd.similarity * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm">{jd.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skills Table */}
            <SkillsTable skills={result.skills} />

            {/* Questions Table */}
            <QuestionsTable skills={result.skills} />
          </div>
        )}
      </div>
    </div>
  );
}
