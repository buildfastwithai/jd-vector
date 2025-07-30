"use client";

import { useState } from "react";

export default function Home() {
  const [skill, setSkill] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);

  const generate = async () => {
    const res = await fetch("/api/skills/generate", {
      method: "POST",
      body: JSON.stringify({ skillName: skill }),
    });

    const data = await res.json();
    setQuestions(data.questions);
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
      <button onClick={generate} className="bg-blue-500 text-white px-4 py-2">
        Generate Questions
      </button>
      <ul className="mt-6 space-y-2">
        {questions.map((q, idx) => (
          <li key={idx} className="border p-2 rounded">
            {q}
          </li>
        ))}
      </ul>
    </div>
  );
}
