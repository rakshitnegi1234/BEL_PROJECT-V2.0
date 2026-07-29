import { invokeLLM } from "./Config.js";

const EXTRACTION_PROMPT = `You are a precise data extractor.
I will provide raw text containing a batch of movies.

Extract ALL movies from the text. For EACH movie, output this EXACT JSON structure:
{
  "movie": {"title": "string", "year": number},
  "director": {"name": "string"},
  "actors": ["string"],
  "genres": ["string"],
  "themes": ["string"],
  "awards": ["string"]
}

Rules:

- If awards say "None", return awards as an empty array [].
- Year must be a number.
- Return ONLY a valid JSON ARRAY of objects: [{...}, {...}, ...]
- Do NOT add markdown, greetings, or explanations.`;


function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanModelJson(modelText) {
  return modelText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

async function extractMovieBatch(batchText, batchNumber, attempt = 1)
 {

  const maxAttempts = 3;
  console.log(`Sending Batch ${batchNumber} to Mistral (Attempt ${attempt}/${maxAttempts})...`);

  
  try {

    const modelText = await invokeLLM(EXTRACTION_PROMPT, batchText);
    const cleanText = cleanModelJson(modelText);
    const parsedMovies = JSON.parse(cleanText);

  
    return Array.isArray(parsedMovies) ? parsedMovies : [parsedMovies];
  }
   catch (error) 
   
   {
    if (attempt < maxAttempts) 
      
      {
      console.warn(`Batch ${batchNumber} failed: ${error.message}. Retrying in 10s...`);
      await pause(10000);
      return extractMovieBatch(batchText, batchNumber, attempt + 1);
    }

    console.error(`Batch ${batchNumber} failed completely after 3 attempts. Skipping to next batch.`);
    return [];
  }
}

async function extractMovieEntities(pdfText) 
{
  const movieBlocks = pdfText.split(/----------------------------------------/);
  const movieTexts = movieBlocks.filter((text) => text.trim().length > 50);

  console.log(`\nSplit PDF into ${movieTexts.length} individual movie text blocks.`);

  
  const batchSize = 20;
  const movies = [];

  for (let startIndex = 0; startIndex < movieTexts.length; startIndex += batchSize) {

    const batchMovies = movieTexts.slice(startIndex, startIndex + batchSize);
    const batchText = batchMovies.join("\n----------------------------------------\n");
    const batchNumber = Math.floor(startIndex / batchSize) + 1;

    const extractedMovies = await extractMovieBatch(batchText, batchNumber);

    movies.push(...extractedMovies);
    console.log(`Batch ${batchNumber} completed. Total extracted so far: ${movies.length}`);
  }

  console.log(`\nFinished extraction. Total movies successfully processed: ${movies.length}`);
  return movies;
}

export { extractMovieEntities };
