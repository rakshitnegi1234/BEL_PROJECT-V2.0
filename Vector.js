import { embedTexts, pineconeIndex } from "./Config.js";

// A small helper function to pause the code

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function createEmbeddingText(entity) {
  const parts = [
    `${entity.movie.title} is a ${entity.genres.join(", ")} movie released in ${entity.movie.year}.`,
    `Directed by ${entity.director.name}.`,
    `Starring ${entity.actors.join(", ")}.`,
    `The movie explores themes of ${entity.themes.join(", ")}.`
  ];
  return parts.join(" ");
}

async function buildVectorStore(entities) {
  const entitiesToIndex = entities.slice(0, 200);
  console.log(`\nBuilding vector store for ${entitiesToIndex.length} movies...\n`);

  const batchSize = 50; 

  for (let i = 0; i < entitiesToIndex.length; i += batchSize) {
    const batch = entitiesToIndex.slice(i, i + batchSize);
    console.log(`Embedding batch ${Math.floor(i / batchSize) + 1}...`);

    const texts = batch.map((entity) => createEmbeddingText(entity));
    

    // If it's not the first batch, wait 15 seconds to let the Gemini rate limit cool down.

    if (i > 0) {
      console.log("Waiting 15 seconds for Gemini API rate limits...");
      await sleep(15000); 
    }

    // Send movie text to the embedding model.
    const vectors = await embedTexts(texts);

    const records = batch.map((entity, idx) => ({
      id: entity.movie.title.replace(/\s+/g, "-").toLowerCase(),
      values: vectors[idx],
      metadata: {
        title: entity.movie.title,
        year: entity.movie.year,
        director: entity.director.name,
        genres: entity.genres.join(", "),
        themes: entity.themes.join(", "),
        actors: entity.actors.join(", "),
        text: texts[idx],
      },
    }));

    // Insert into Pinecone.

    await pineconeIndex.upsert({ records: records });
  }

  const stats = await pineconeIndex.describeIndexStats();
  console.log(`Vector store built! Total vectors: ${stats.totalRecordCount}`);
}

export { buildVectorStore };
