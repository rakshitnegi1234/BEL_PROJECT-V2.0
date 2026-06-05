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


// 1. Helper Function: Process a SINGLE batch with its own retry logic
async function extractBatch(textChunk, batchNum, attempt = 1) {
  const maxRetries = 3;

  console.log(`Sending Batch ${batchNum} to Mistral (Attempt ${attempt}/${maxRetries})...`);
  
  try {
    const jsonText = await invokeLLM(EXTRACTION_PROMPT, textChunk);
    
    // Safety check: LLMs sometimes wrap JSON in markdown (```json ... ```) despite instructions.
    // This strips the markdown so JSON.parse doesn't crash.
    const cleanJsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(cleanJsonText);
    return Array.isArray(parsed) ? parsed : [parsed];

  } catch (err) {
    if (attempt < maxRetries) {
        console.warn(`   ⚠️ Batch ${batchNum} failed: ${err.message}. Retrying in 10s...`);
        await new Promise((r) => setTimeout(r, 10000));
        return extractBatch(textChunk, batchNum, attempt + 1);
    }
    
    console.error(`❌ Batch ${batchNum} failed completely after 3 attempts. Skipping to next batch.`);
    return [];
  }
}

// 2. Main Function: Split the text and orchestrate the batches

async function extractAllEntities(rawPdfText) {
  // Step A: Split the giant string using the PDF's dashed lines
  const rawMovies = rawPdfText.split(/----------------------------------------/);
  
  // Step B: Filter out any empty chunks or tiny fragments
  const validMovies = rawMovies.filter(text => text.trim().length > 50);

  console.log(`\n🧩 Split PDF into ${validMovies.length} individual movie text blocks.`);

  const batchSize = 20; // 20 movies per request is very safe for LLM output limits
  let allExtractedMovies = [];

  // Step C: Loop through the movies in batches of 20
  
  for (let i = 0; i < validMovies.length; i += batchSize) {
    const batchTextArray = validMovies.slice(i, i + batchSize);
    
    // Stitch the 20 movies back into a single string for this prompt
    const batchTextString = batchTextArray.join("\n----------------------------------------\n");
    
    const batchNum = Math.floor(i / batchSize) + 1;
    
    // Send to the helper function
    const extractedBatch = await extractBatch(batchTextString, batchNum);
    
    // Combine results
    allExtractedMovies = allExtractedMovies.concat(extractedBatch);
    console.log(`   ✅ Batch ${batchNum} completed. Total extracted so far: ${allExtractedMovies.length}`);
  }

  console.log(`\n🎉 Finished extraction! Total movies successfully processed: ${allExtractedMovies.length}`);
  return allExtractedMovies;
}

export { extractAllEntities };