import { parseMoviePdf } from "./PdfParse.js";
import { extractMovieEntities } from "./Entity_Extractor.js";
import { buildMovieGraph } from "./GraphBuilder.js";
import { buildMovieVectors } from "./Vector.js";
import { closeConnections } from "./Config.js";

async function runIndexingPipeline(pdfPath) {



  console.log("GraphRAG Indexing Pipeline");

  try {
    
    console.log("STEP 1: Parse PDF Locally");
    const pdfText = await parseMoviePdf(pdfPath);


    console.log("STEP 2: Extract Entities From PDF ");
    const movies = await extractMovieEntities(pdfText);


    
    console.log("\n STEP 3: Build Graph (Neo4j) --");
    await buildMovieGraph(movies);


    console.log("\nSTEP 4: Build Vector Store (Pinecone)");
    await buildMovieVectors(movies);


    console.log("\nIndexing complete.");
  } catch (error) 
  
  {
    console.error("\nIndexing aborted due to error:", error.message);
    console.error("No data was inserted into the databases.");
  } 
  
  finally {
    await closeConnections();
  }
}


const moviePdfPath = "./Data/movie.pdf";
runIndexingPipeline(moviePdfPath);
