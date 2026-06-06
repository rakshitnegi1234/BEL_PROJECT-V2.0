import readline from "readline";
import { closeConnections } from "./Config.js";
import { resolveQueryEntities } from "./Entity_Resolver.js";
import { classifyQuery } from "./QueryClassifier.js";
import { handleGraphQuery } from "./GraphHander.js";
import { handleSimilarityQuery } from "./SimilarityHandler.js";

async function processQuery(query) {
  console.log("\n===========================================");

    // entity extraction is going on 
  console.log("\nEntity resolution");

  const resolved = await resolveQueryEntities(query);

  console.log("\nClassification");


  const classification = await classifyQuery(query, resolved);
  
  console.log(`Type: ${classification.type}`);
  console.log(`Reason: ${classification.reasoning}`);

  let answer;
  if (classification.type === "similarity") {
    console.log("\nSimilarity handler: Pinecone top 30, Neo4j enrichment, final top 10");
    answer = await handleSimilarityQuery(query, resolved);
  } else {
    console.log("\nGraph handler: Neo4j factual query");
    answer = await handleGraphQuery(query, resolved);
  }

  console.log("\n===========================================");
  console.log("Answer:\n");
  console.log(answer);
  console.log("\n===========================================");
}

async function startCLI() {
  console.log("===========================================");
  console.log("GraphRAG Movie Query System");
  console.log("===========================================");
  console.log('Type your question. Type "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question("You: ", async (input) => {
      const query = input.trim();

      if (query.toLowerCase() === "exit") {
        console.log("\nGoodbye.");
        rl.close();
        await closeConnections();
        process.exit(0);
      }

      if (!query) {
        ask();
        return;
      }

      try {
        await processQuery(query);
      } catch (err) {
        console.error("\nError:", err.message);
      }

      ask();
    });
  };

  ask();
}

startCLI();
