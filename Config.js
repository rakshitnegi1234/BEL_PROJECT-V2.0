import dotenv from "dotenv";
import axios from "axios";
import neo4j from "neo4j-driver";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// 1. NEO4J SETUP
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

// 2. PINECONE SETUP
// const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
// const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);

const pinecone = new Pinecone({ 
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);


// 3. MISTRAL LLM (NVIDIA API)
async function invokeLLM(systemPrompt, userPrompt) {
  try {
    const response = await axios.post(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        model: "mistralai/mistral-medium-3.5-128b",
        temperature: 0.2, 
        max_tokens: 8000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let content = response.data.choices[0].message.content.trim();
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return content;

  } catch (error) {
    console.error("LLM Error:", error.response?.data || error.message);
    throw error;
  }
}

// 4. GEMINI EMBEDDINGS (Google GenAI SDK)
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function embedText(text) {
  const response = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });
  return response.embeddings[0].values;
}

async function embedTexts(texts) {
  const response = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: texts,
  });
  return response.embeddings.map((e) => e.values);
}

async function closeConnections() {
  await driver.close();
  console.log("All database connections closed.");
}

export { driver, pineconeIndex, invokeLLM, embedText, embedTexts, closeConnections };
