"use client";

import { useState } from "react";

interface SimilarQuestion {
  text: string;
  skillName: string;
  similarity: number;
}

interface GenerateResponse {
  questions: string[];
  similarQuestions?: SimilarQuestion[];
  source: "vector_search" | "generated";
  message?: string;
}

export default function Home() {
  const [skill, setSkill] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [similarQuestions, setSimilarQuestions] = useState<SimilarQuestion[]>(
    []
  );
  const [source, setSource] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        body: JSON.stringify({ skillName: skill }),
      });

      const data: GenerateResponse = await res.json();
      setQuestions(data.questions);
      setSimilarQuestions(data.similarQuestions || []);
      setSource(data.source);
      setMessage(data.message || "");
    } catch (error) {
      console.error("Error generating questions:", error);
      setQuestions([]);
      setSimilarQuestions([]);
      setSource("");
      setMessage("");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-8 max-w-xl mx-auto">
      <h1 className="text-2xl mb-4">AI Skill Question Generator</h1>
      <input
        value={skill}
        onChange={(e) => setSkill(e.target.value)}
        placeholder="Enter skill name"
        className="p-2 border w-full mb-4"
      />
      <button
        onClick={generate}
        disabled={isGenerating}
        className={`px-4 py-2 text-white ${
          isGenerating
            ? "bg-blue-400 cursor-not-allowed"
            : "bg-blue-500 hover:bg-blue-600"
        }`}
      >
        {isGenerating ? "Generating..." : "Generate Questions"}
      </button>

      {/* Status Message */}
      {source && (
        <div className="mt-4 p-3 bg-gray-100 rounded">
          <p className="text-sm text-gray-700">
            {source === "vector_search"
              ? "✨ Found similar questions using AI search"
              : "🤖 Generated new questions"}
          </p>
          {message && <p className="text-xs text-gray-600 mt-1">{message}</p>}
        </div>
      )}

      {/* Main Questions */}
      {questions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">
            {source === "vector_search"
              ? "Similar Questions Found"
              : "Generated Questions"}
          </h2>
          <ul className="space-y-2">
            {questions.map((q, idx) => (
              <li key={idx} className="border p-3 rounded bg-white shadow-sm">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Similar Questions (when generated new questions but found some similar ones) */}
      {source === "generated" && similarQuestions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">
            Related Questions Found
          </h2>
          <ul className="space-y-2">
            {similarQuestions.map((q, idx) => (
              <li key={idx} className="border p-3 rounded bg-blue-50">
                <div className="text-sm text-gray-800">{q.text}</div>
                <div className="text-xs text-gray-500 mt-1">
                  From: {q.skillName} • Similarity:{" "}
                  {(q.similarity * 100).toFixed(1)}%
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
