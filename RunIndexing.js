import { parsePDF } from "./PdfParse.js";
import { extractAllEntities } from "./Entity_Extractor.js";
import { buildGraph } from "./GraphBuilder.js";
import { buildVectorStore } from "./Vector.js";
import { closeConnections } from "./Config.js";

async function runIndexing(pdfPath) {
  console.log("===========================================");
  console.log("   🎬 GraphRAG Indexing Pipeline");
  console.log("===========================================\n");

  try {
    console.log("── STEP 1: Parse PDF Locally ──");
    const rawText = await parsePDF(pdfPath);

    console.log("\n── STEP 2: Extract Entities (Mistral) ──");

    // If this fails after retries, it throws an error and jumps to catch()
  

    const entities = await extractAllEntities(rawText, 250); 

    console.log("\n── STEP 3: Build Graph (Neo4j) ──");
    await buildGraph(entities);

    console.log("\n── STEP 4: Build Vector Store (Pinecone) ──");
    await buildVectorStore(entities);

    console.log("\n✅ Indexing complete!");


  } catch (err) {


    console.error("\n❌ Indexing aborted due to error:", err.message);
    console.error("No data was inserted into the databases.");

  } finally {

    await closeConnections();
  }
}

const pdfPath = './movie.pdf'; 
runIndexing(pdfPath);