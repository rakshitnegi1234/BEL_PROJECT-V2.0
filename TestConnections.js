import { driver, pineconeIndex, invokeLLM, embedText, closeConnections } from "./Config.js";

async function testConnections() {
  console.log("Testing all connections...\n");

  // Test 1: Neo4j
  try {
    const session = driver.session();
    const result = await session.run("RETURN 'Neo4j Connected!' AS message");
    console.log("Neo4j:", result.records[0].get("message"));
    await session.close();
  } catch (err) {
    console.error("Neo4j:", err.message);
  }

  // Test 2: Pinecone
  try {
    const stats = await pineconeIndex.describeIndexStats();
    console.log("Pinecone: Connected | Vectors:", stats.totalRecordCount || 0);
  } catch (err) {
    console.error("Pinecone:", err.message);
  }

  // Test 3: NVIDIA Mistral LLM
  try {
    const response = await invokeLLM("You are a helpful bot.", "Say 'NVIDIA Mistral Connected!' and nothing else.");
    console.log("NVIDIA LLM:", response);
  } catch (err) {
    console.error("NVIDIA LLM:", err.message);
  }

  // Test 4: Gemini Embeddings
  try {
    const vector = await embedText("test");
    console.log(`Gemini Embeddings (gemini-embedding-001): Dimension = ${vector.length}`);
    console.log("   (Make sure your Pinecone index matches this dimension size!)");
  } catch (err) {
    console.error("Gemini Embeddings:", err.message);
  }

  await closeConnections();
}

testConnections();
