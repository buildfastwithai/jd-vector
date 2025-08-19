"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ThinkingPhase {
  id: string;
  label: string;
  status: "pending" | "active" | "completed";
  description: string;
}

export default function JobDescriptionAnalyzer() {
  const router = useRouter();
  const [jobDescription, setJobDescription] = useState("");
  const [title, setTitle] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingPhases, setThinkingPhases] = useState<ThinkingPhase[]>([
    {
      id: "starting",
      label: "🚀 Starting Analysis",
      status: "pending",
      description: "Initializing job description analysis...",
    },
    {
      id: "jd_embedding",
      label: "🧠 Creating JD Embeddings",
      status: "pending",
      description: "Converting job description to vector format...",
    },
    {
      id: "similar_search",
      label: "🔍 Searching Similar Jobs",
      status: "pending",
      description: "Finding similar job descriptions in database...",
    },
  ]);

  const updatePhaseStatus = (
    phaseId: string,
    status: "pending" | "active" | "completed"
  ) => {
    setThinkingPhases((prev) =>
      prev.map((phase) => (phase.id === phaseId ? { ...phase, status } : phase))
    );
  };

  const resetThinkingPhases = () => {
    setThinkingPhases((prev) =>
      prev.map((phase) => ({ ...phase, status: "pending" as const }))
    );
  };

  const analyzeJD = async () => {
    if (!jobDescription.trim()) {
      setError("Please enter a job description");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setShowThinking(true);
    resetThinkingPhases();

    try {
      // First, store the job description
      updatePhaseStatus("starting", "active");
      updatePhaseStatus("jd_embedding", "active");
      
      const storeResponse = await fetch("/api/jd/store", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobDescription: jobDescription.trim(),
          title: title.trim() || null,
        }),
      });

      if (!storeResponse.ok) {
        throw new Error("Failed to store job description");
      }

      const storeData = await storeResponse.json();
      
      if (storeData.error) {
        throw new Error(storeData.error);
      }

      updatePhaseStatus("starting", "completed");
      updatePhaseStatus("jd_embedding", "completed");
      updatePhaseStatus("similar_search", "active");

      // Navigate to the analysis page
      window.location.href = `/jd/${storeData.jobDescriptionId}`;
    } catch (error) {
      console.error("Error storing job description:", error);
      setError("Failed to store job description. Please try again.");
      setShowThinking(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearForm = () => {
    setJobDescription("");
    setTitle("");
    setError("");
    setShowThinking(false);
    resetThinkingPhases();
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

              <button
                onClick={clearForm}
                className="px-6 py-2 rounded-md font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Clear Form
              </button>
            </div>
          </div>
        </div>

        {/* Thinking Progress */}
        {showThinking && (
          <div className="bg-white rounded-lg shadow-md mb-6">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  🤖 Storing Job Description
                </h3>
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm text-gray-600">
                    {
                      thinkingPhases.filter((p) => p.status === "completed")
                        .length
                    }{" "}
                    / {thinkingPhases.length} complete
                  </span>
                </div>
              </div>

              <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      (thinkingPhases.filter((p) => p.status === "completed")
                        .length /
                        thinkingPhases.length) *
                      100
                    }%`,
                  }}
                ></div>
              </div>

              <div className="space-y-3">
                {thinkingPhases.map((phase) => (
                  <div
                    key={phase.id}
                    className={`flex items-center space-x-3 p-3 rounded-lg transition-all duration-300 ${
                      phase.status === "active"
                        ? "bg-blue-50 border border-blue-200"
                        : phase.status === "completed"
                        ? "bg-green-50 border border-green-200"
                        : "bg-gray-50 border border-gray-200"
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {phase.status === "completed" && (
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <svg
                            className="w-3 h-3 text-white"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                      {phase.status === "active" && (
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                        </div>
                      )}
                      {phase.status === "pending" && (
                        <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center">
                          <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1">
                      <div
                        className={`font-medium ${
                          phase.status === "active"
                            ? "text-blue-900"
                            : phase.status === "completed"
                            ? "text-green-900"
                            : "text-gray-600"
                        }`}
                      >
                        {phase.label}
                      </div>
                      <div
                        className={`text-sm ${
                          phase.status === "active"
                            ? "text-blue-700"
                            : phase.status === "completed"
                            ? "text-green-700"
                            : "text-gray-500"
                        }`}
                      >
                        {phase.description}
                      </div>
                    </div>

                    {phase.status === "active" && (
                      <div className="flex-shrink-0">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
