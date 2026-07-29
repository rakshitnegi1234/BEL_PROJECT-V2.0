import readline from "readline";
import { closeConnections } from "./Config.js";
import { resolveQueryEntities } from "./Entity_Resolver.js";
import { classifyQuery } from "./QueryClassifier.js";
import { answerGraphQuery } from "./GraphHander.js";
import { answerSimilarityQuery } from "./SimilarityHandler.js";

async function answerUserQuery(userQuery) 
{
  const resolvedEntities = await resolveQueryEntities(userQuery);

  const queryType = await classifyQuery(userQuery, resolvedEntities);


  const finalAnswer = queryType.type === "similarity"
    ? await answerSimilarityQuery(userQuery, resolvedEntities)
    : await answerGraphQuery(userQuery, resolvedEntities);

  console.log("Answer:\n");
  console.log(finalAnswer);
}

async function startQueryCli()

{
  
  console.log("GraphRAG Movie Query System");
  console.log('Type your question. Type "exit" to quit.\n');

  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => 
    
    {
    prompt.question("You: ", async (userInput) => {
      const userQuery = userInput.trim();

      if (userQuery.toLowerCase() === "exit") {
        console.log("\nGoodbye.");
        prompt.close();
        await closeConnections();
        process.exit(0);
      }

      if (!userQuery) {
        askQuestion();
        return;
      }

      // Keep the CLI alive after one bad question.
      try {
        await answerUserQuery(userQuery);
      } catch (error) {
        console.error("\nError:", error.message);
      }

      askQuestion();
    });
  };

  askQuestion();
}

startQueryCli();

