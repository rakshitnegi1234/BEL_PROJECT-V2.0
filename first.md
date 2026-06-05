# GRAPH_RAG Project Explanation

This project builds a GraphRAG indexing pipeline for movie data stored in `movie.pdf`.

GraphRAG means the project stores the same knowledge in two useful forms:

1. A graph database, Neo4j, for exact relationship-based questions.
2. A vector database, Pinecone, for semantic meaning-based search.

The PDF is parsed first, then an LLM extracts structured movie data, then the project inserts that data into Neo4j and Pinecone.

## 1. Basic Concepts First

### What is a graph database?

A graph database stores data as:

- Nodes: things/entities.
- Labels: the type/category of a node.
- Properties: fields stored on a node.
- Relationships: connections between nodes.

Example:

```cypher
(:Actor {name: "Leonardo DiCaprio"})-[:ACTED_IN]->(:Movie {title: "Inception"})
```

Here:

- `Actor` is a label.
- `Movie` is a label.
- `name` and `title` are properties.
- `ACTED_IN` is the relationship type.

This is useful because movie knowledge is naturally connected. Movies have actors, directors, genres, themes, and awards.

### What is a vector database?

A vector database stores numeric representations of text.

Example text:

```text
Inception is a science fiction movie released in 2010. Directed by Christopher Nolan.
```

An embedding model converts that text into a long array of numbers:

```js
[0.012, -0.44, 0.87, ...]
```

That numeric array is called a vector or embedding.

The vector database can compare meaning. So if a user searches:

```text
mind bending dream movies
```

it can find movies whose stored embedding is semantically close, even if the exact words are different.

### Why use both Neo4j and Pinecone?

Neo4j is good for exact connected facts:

- Which actors acted in this movie?
- Which movies did this director direct?
- Which movies won a specific award?
- Which movies belong to this genre?

Pinecone is good for semantic search:

- Find movies about revenge.
- Find movies with themes like identity and memory.
- Find movies similar to a natural language query.

Together they support GraphRAG:

1. Use vector search to find relevant movies by meaning.
2. Use graph search to expand those movies into facts and relationships.
3. Use the retrieved context to answer questions.

## 2. Full Project Flow

The main pipeline starts in `RunIndexing.js`.

```js
const pdfPath = './movie.pdf';
runIndexing(pdfPath);
```

The flow is:

1. `parsePDF(pdfPath)` reads and cleans text from `movie.pdf`.
2. `extractAllEntities(rawText)` sends movie text batches to the Mistral LLM and gets structured JSON.
3. `buildGraph(entities)` inserts the structured data into Neo4j.
4. `buildVectorStore(entities)` creates embeddings and upserts them into Pinecone.
5. `closeConnections()` closes the Neo4j driver.

The pipeline is:

```text
movie.pdf
   |
   v
PdfParse.js
   |
   v
raw cleaned text
   |
   v
Entity_Extractor.js
   |
   v
structured movie JSON
   |
   +--> GraphBuilder.js --> Neo4j graph database
   |
   +--> Vector.js -------> Pinecone vector database
```

## 3. PDF Parsing

The PDF parsing code is in `PdfParse.js`.

```js
import fs from "fs";
import { PDFParse } from "pdf-parse";

async function parsePDF(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const textResult = await parser.getText();

  let rawText = textResult.text;

  const cleanedText = rawText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "");

  return cleanedText;
}
```

### Why do we need PDF parsing?

The original data is inside `movie.pdf`. A PDF is not simple plain text like a `.txt` or `.json` file. It stores layout, pages, fonts, positions, and text fragments.

The LLM and the indexing code cannot directly work with a PDF file. They need readable text.

So PDF parsing does this:

1. Reads the PDF file as a buffer.
2. Uses `pdf-parse` to extract text from the PDF.
3. Removes page markers like:

```text
-- 1 of 10 --
```

4. Returns cleaned text.

That cleaned text is then passed to the entity extractor.

### Why clean the text?

PDFs often contain page numbers, headers, footers, and layout noise. If that noise is sent to the LLM, the LLM may extract wrong data or waste tokens.

This line removes page count markers:

```js
rawText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
```

Meaning:

- `--` matches the two dashes.
- `\s*` allows spaces.
- `\d+` matches numbers.
- `of` matches the word "of".
- `gi` means global and case-insensitive.

## 4. Entity Extraction

The entity extraction code is in `Entity_Extractor.js`.

Its job is to convert raw PDF text into structured JSON.

The expected output for each movie is:

```json
{
  "movie": {"title": "string", "year": 2010},
  "director": {"name": "string"},
  "actors": ["string"],
  "genres": ["string"],
  "themes": ["string"],
  "awards": ["string"]
}
```

### Why do we need entity extraction?

The graph builder and vector builder need clean structured data.

Raw text may look like:

```text
Title: Inception
Year: 2010
Director: Christopher Nolan
Actors: Leonardo DiCaprio, Joseph Gordon-Levitt
Genres: Science Fiction, Thriller
Themes: Dreams, Memory, Reality
Awards: Oscar (Best Cinematography)
```

But the code needs objects like:

```js
{
  movie: { title: "Inception", year: 2010 },
  director: { name: "Christopher Nolan" },
  actors: ["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
  genres: ["Science Fiction", "Thriller"],
  themes: ["Dreams", "Memory", "Reality"],
  awards: ["Oscar (Best Cinematography)"]
}
```

The LLM does that conversion.

### How batching works

The extractor splits the PDF text using:

```js
rawPdfText.split(/----------------------------------------/)
```

That means the PDF appears to separate movie entries with dashed lines.

Then it removes very small/empty chunks:

```js
const validMovies = rawMovies.filter(text => text.trim().length > 50);
```

Then it sends 20 movies at a time to the LLM:

```js
const batchSize = 20;
```

This is done because sending the entire PDF at once could be too large and could make the LLM output invalid JSON.

### Retry logic

Each batch is tried up to 3 times:

```js
const maxRetries = 3;
```

If JSON parsing fails, or the API fails, it waits 10 seconds and retries.

This is useful because LLM APIs can sometimes fail, rate limit, or return malformed output.

## 5. GraphBuilder.js

`GraphBuilder.js` creates the Neo4j graph.

It exports:

```js
export { buildGraph };
```

There are two main functions:

1. `buildGraph(entities)`
2. `insertMovieGraph(entity)`

### What `buildGraph(entities)` does

This function receives all extracted movie objects.

First it creates indexes:

```js
await session.run("CREATE INDEX IF NOT EXISTS FOR (m:Movie) ON (m.title)");
await session.run("CREATE INDEX IF NOT EXISTS FOR (d:Director) ON (d.name)");
await session.run("CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)");
await session.run("CREATE INDEX IF NOT EXISTS FOR (g:Genre) ON (g.name)");
await session.run("CREATE INDEX IF NOT EXISTS FOR (t:Theme) ON (t.name)");
await session.run("CREATE INDEX IF NOT EXISTS FOR (aw:Award) ON (aw.name, aw.category)");
```

Then it loops through every movie entity:

```js
for (let i = 0; i < entities.length; i++) {
  await insertMovieGraph(entities[i]);
}
```

Then it prints graph statistics:

```cypher
MATCH (n) RETURN count(n) AS count
MATCH ()-[r]->() RETURN count(r) AS count
```

### What `insertMovieGraph(entity)` does

This function inserts one movie and all connected entities.

For each movie, it creates or reuses:

- One `Movie` node.
- One `Director` node.
- Many `Actor` nodes.
- Many `Genre` nodes.
- Many `Theme` nodes.
- Many `Award` nodes.

And it creates relationships:

- `(Director)-[:DIRECTED]->(Movie)`
- `(Actor)-[:ACTED_IN]->(Movie)`
- `(Movie)-[:BELONGS_TO]->(Genre)`
- `(Movie)-[:EXPLORES]->(Theme)`
- `(Movie)-[:WON]->(Award)`

### Example graph

For this entity:

```js
{
  movie: { title: "Inception", year: 2010 },
  director: { name: "Christopher Nolan" },
  actors: ["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
  genres: ["Science Fiction", "Thriller"],
  themes: ["Dreams", "Reality"],
  awards: ["Oscar (Best Cinematography)"]
}
```

Neo4j will store something like:

```text
(Christopher Nolan:Director)-[:DIRECTED]->(Inception:Movie)
(Leonardo DiCaprio:Actor)-[:ACTED_IN]->(Inception:Movie)
(Joseph Gordon-Levitt:Actor)-[:ACTED_IN]->(Inception:Movie)
(Inception:Movie)-[:BELONGS_TO]->(Science Fiction:Genre)
(Inception:Movie)-[:BELONGS_TO]->(Thriller:Genre)
(Inception:Movie)-[:EXPLORES]->(Dreams:Theme)
(Inception:Movie)-[:EXPLORES]->(Reality:Theme)
(Inception:Movie)-[:WON]->(Oscar:Award {category: "Best Cinematography"})
```

## 6. Cypher Query Basics

Cypher is the query language used by Neo4j.

### Nodes

```cypher
(m:Movie)
```

This means a node with label `Movie`.

### Properties

```cypher
(m:Movie {title: "Inception"})
```

This means a `Movie` node whose `title` property is `"Inception"`.

### Relationships

```cypher
(a:Actor)-[:ACTED_IN]->(m:Movie)
```

This means an `Actor` node connected to a `Movie` node by an outgoing `ACTED_IN` relationship.

### MATCH

`MATCH` searches for existing graph patterns.

Example:

```cypher
MATCH (a:Actor)-[:ACTED_IN]->(m:Movie {title: "Inception"})
RETURN a.name
```

This returns actors who acted in `Inception`.

### CREATE

`CREATE` always creates new data.

```cypher
CREATE (m:Movie {title: "Inception"})
```

If you run this many times, it can create duplicate movie nodes.

### MERGE

`MERGE` means find it if it exists, otherwise create it.

```cypher
MERGE (m:Movie {title: $title})
```

This is why the project uses `MERGE`. Movie names, actor names, director names, genre names, and theme names may repeat across records. `MERGE` prevents duplicates when the match property is the same.

### SET

`SET` updates properties.

```cypher
MERGE (m:Movie {title: $title})
SET m.year = $year
```

This finds or creates the movie by title, then sets the year.

### Parameters

The code uses parameters:

```js
await tx.run(
  `MERGE (m:Movie {title: $title}) SET m.year = $year`,
  { title: entity.movie.title, year: entity.movie.year }
);
```

`$title` and `$year` are parameter placeholders. Their values come from the JavaScript object.

This is better than string concatenation because it is safer and handles escaping.

## 7. What Is `session.run()`?

In the Neo4j JavaScript driver, `session.run()` sends one Cypher query to Neo4j.

Example:

```js
await session.run("CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)");
```

This tells Neo4j:

```text
Create an index for Actor nodes using their name property, if that index does not already exist.
```

Another example:

```js
await session.run("MATCH (n) RETURN count(n) AS count");
```

This tells Neo4j:

```text
Count all nodes in the database.
```

### `session.run()` vs `tx.run()`

This project uses both:

```js
await session.run(...)
```

and:

```js
await session.executeWrite(async (tx) => {
  await tx.run(...);
});
```

`session.run()` runs a query directly in a session.

`tx.run()` runs a query inside a transaction.

A transaction groups related writes together. In `insertMovieGraph`, the movie node and its related nodes/relationships are inserted inside `session.executeWrite(...)`.

That is good because the graph insertion for one movie is treated as one write unit.

## 8. What Is Indexing in Neo4j?

Indexing means creating a lookup structure so the database can find nodes faster.

Without an index:

```cypher
MERGE (a:Actor {name: "Leonardo DiCaprio"})
```

Neo4j may need to scan many `Actor` nodes to check whether one already has that name.

With this index:

```cypher
CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)
```

Neo4j can quickly look up Actor nodes by `name`.

### Are we creating indexes in this project?

Yes.

`GraphBuilder.js` creates indexes for:

- `Movie.title`
- `Director.name`
- `Actor.name`
- `Genre.name`
- `Theme.name`
- `Award.name` plus `Award.category`

The code:

```cypher
CREATE INDEX IF NOT EXISTS FOR (m:Movie) ON (m.title)
CREATE INDEX IF NOT EXISTS FOR (d:Director) ON (d.name)
CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)
CREATE INDEX IF NOT EXISTS FOR (g:Genre) ON (g.name)
CREATE INDEX IF NOT EXISTS FOR (t:Theme) ON (t.name)
CREATE INDEX IF NOT EXISTS FOR (aw:Award) ON (aw.name, aw.category)
```

### Important: does this create one index inside each node?

No.

It does not create a separate index object inside every `Actor` node.

This query:

```cypher
CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)
```

creates one database-level index for the `Actor` label and the `name` property.

Think of it like this:

```text
Actor.name index
----------------
"Leonardo DiCaprio"       -> Actor node id 101
"Joseph Gordon-Levitt"    -> Actor node id 102
"Tom Hardy"               -> Actor node id 103
```

The index is maintained by Neo4j. When a new `Actor` node is inserted with a `name`, Neo4j updates the index.

So yes, all `Actor` nodes with a `name` property become searchable through that index, but the index is not stored separately inside each node.

### Example with Actor label

Suppose these nodes exist:

```cypher
(:Actor {name: "Amitabh Bachchan"})
(:Actor {name: "Shah Rukh Khan"})
(:Actor {name: "Aamir Khan"})
```

After this index is created:

```cypher
CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)
```

Neo4j can quickly answer:

```cypher
MATCH (a:Actor {name: "Shah Rukh Khan"})
RETURN a
```

It does not scan every actor one by one. It uses the `Actor.name` index.

### Why indexes matter for `MERGE`

This project uses `MERGE` heavily:

```cypher
MERGE (a:Actor {name: $name})
```

Before creating an actor, Neo4j must check whether the actor already exists.

If there is no index, this check can become slow as the database grows.

If there is an index on `Actor.name`, Neo4j can quickly check whether that actor already exists.

That is why indexes are created before inserting the graph.

### Is an index the same as a uniqueness constraint?

No.

An index improves lookup speed.

A uniqueness constraint prevents duplicates.

This project creates indexes, not uniqueness constraints.

So this helps performance:

```cypher
CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)
```

But this would enforce uniqueness:

```cypher
CREATE CONSTRAINT actor_name_unique IF NOT EXISTS
FOR (a:Actor)
REQUIRE a.name IS UNIQUE
```

The current project relies on `MERGE` plus indexes. That is usually fine for a controlled indexing pipeline, but uniqueness constraints are stronger if you want database-level duplicate protection.

## 9. Detailed GraphBuilder Flow

### Movie node

```cypher
MERGE (m:Movie {title: $title})
SET m.year = $year
```

This creates or finds a movie by title, then stores its year.

Example:

```cypher
MERGE (m:Movie {title: "Inception"})
SET m.year = 2010
```

### Director node and relationship

```cypher
MERGE (d:Director {name: $name})
MERGE (m:Movie {title: $title})
MERGE (d)-[:DIRECTED]->(m)
```

This creates or finds the director, creates or finds the movie, then connects the director to the movie.

Example:

```text
(Christopher Nolan)-[:DIRECTED]->(Inception)
```

### Actor nodes and relationships

For every actor:

```cypher
MERGE (a:Actor {name: $name})
MERGE (m:Movie {title: $title})
MERGE (a)-[:ACTED_IN]->(m)
```

Example:

```text
(Leonardo DiCaprio)-[:ACTED_IN]->(Inception)
```

### Genre nodes and relationships

For every genre:

```cypher
MERGE (g:Genre {name: $name})
MERGE (m:Movie {title: $title})
MERGE (m)-[:BELONGS_TO]->(g)
```

Example:

```text
(Inception)-[:BELONGS_TO]->(Science Fiction)
```

### Theme nodes and relationships

For every theme:

```cypher
MERGE (t:Theme {name: $name})
MERGE (m:Movie {title: $title})
MERGE (m)-[:EXPLORES]->(t)
```

Example:

```text
(Inception)-[:EXPLORES]->(Dreams)
```

### Award nodes and relationships

Awards are handled slightly differently.

The code expects awards like:

```text
Oscar (Best Picture)
```

It uses this regex:

```js
const match = awardName.match(/^(.+?)\s*\((.+)\)$/);
```

This splits:

```text
Oscar (Best Picture)
```

into:

```js
{
  name: "Oscar",
  category: "Best Picture"
}
```

Then it inserts:

```cypher
MERGE (aw:Award {name: $awardType, category: $category})
MERGE (m:Movie {title: $title})
MERGE (m)-[:WON]->(aw)
```

Example:

```text
(Inception)-[:WON]->(:Award {name: "Oscar", category: "Best Cinematography"})
```

## 10. Vector.js Builder

`Vector.js` builds the vector store in Pinecone.

It exports:

```js
export { buildVectorStore };
```

There are two important functions:

1. `createEmbeddingText(entity)`
2. `buildVectorStore(entities)`

## 11. What Is `createEmbeddingText(entity)`?

This function converts one structured movie entity into a natural language text paragraph.

Code:

```js
function createEmbeddingText(entity) {
  const parts = [
    `${entity.movie.title} is a ${entity.genres.join(", ")} movie released in ${entity.movie.year}.`,
    `Directed by ${entity.director.name}.`,
    `Starring ${entity.actors.join(", ")}.`,
    `The movie explores themes of ${entity.themes.join(", ")}.`
  ];
  return parts.join(" ");
}
```

### What is the use of this function?

Embedding models work best when they receive meaningful text.

The raw object:

```js
{
  movie: { title: "Inception", year: 2010 },
  genres: ["Science Fiction", "Thriller"],
  themes: ["Dreams", "Reality"]
}
```

is structured data, but not as natural for semantic embedding.

`createEmbeddingText` converts it into:

```text
Inception is a Science Fiction, Thriller movie released in 2010. Directed by Christopher Nolan. Starring Leonardo DiCaprio, Joseph Gordon-Levitt. The movie explores themes of Dreams, Reality.
```

This text is better for semantic search.

For example, if the user searches:

```text
movies about dreams and reality
```

the embedding for the query will be close to the embedding for this text.

### Does `createEmbeddingText` create the embedding?

No.

`createEmbeddingText` only creates the text.

The actual embedding is created later by:

```js
const vectors = await embedTexts(texts);
```

`embedTexts` is defined in `Config.js` and calls Gemini's embedding model:

```js
model: "gemini-embedding-001"
```

So the difference is:

```text
createEmbeddingText(entity)
    -> creates readable text

embedTexts(texts)
    -> converts readable text into vectors
```

## 12. Vector DB Insertion Flow

`buildVectorStore(entities)` does this:

1. Takes all extracted movie entities.
2. Processes them in batches of 50.
3. Converts each movie entity into embedding text.
4. Calls Gemini to create vectors.
5. Builds Pinecone records.
6. Upserts records into Pinecone.
7. Prints Pinecone index stats.

### Batch size

```js
const batchSize = 50;
```

It embeds 50 movies per batch.

### Creating text for each movie

```js
const texts = batch.map((entity) => createEmbeddingText(entity));
```

Each entity becomes one text string.

### Waiting for rate limits

```js
if (i > 0) {
  await sleep(15000);
}
```

This waits 15 seconds between batches after the first batch.

Why?

Embedding APIs have rate limits. If too many requests are sent too quickly, the API may fail.

### Creating vectors

```js
const vectors = await embedTexts(texts);
```

This sends the text list to Gemini and receives vectors.

### Creating Pinecone records

Each record looks like this:

```js
{
  id: "inception",
  values: [0.012, -0.44, 0.87, ...],
  metadata: {
    title: "Inception",
    year: 2010,
    director: "Christopher Nolan",
    genres: "Science Fiction, Thriller",
    themes: "Dreams, Reality",
    actors: "Leonardo DiCaprio, Joseph Gordon-Levitt",
    text: "Inception is a Science Fiction, Thriller movie released in 2010..."
  }
}
```

The fields are:

- `id`: unique record id in Pinecone.
- `values`: the embedding vector.
- `metadata`: readable information stored with the vector.

The id is created from the movie title:

```js
id: entity.movie.title.replace(/\s+/g, "-").toLowerCase()
```

Example:

```text
"The Dark Knight" -> "the-dark-knight"
```

### Upserting into Pinecone

```js
await pineconeIndex.upsert({ records: records });
```

`upsert` means:

- Insert the record if it does not exist.
- Update/replace the record if the same id already exists.

So if `"inception"` already exists in Pinecone, it gets overwritten with the latest vector and metadata.

## 13. How Neo4j and Pinecone Work Together

Suppose a user asks:

```text
Recommend movies about dreams and identity, and tell me their directors and actors.
```

A GraphRAG app could do:

1. Convert the question to an embedding.
2. Search Pinecone for semantically similar movie records.
3. Get movie titles from Pinecone metadata.
4. Query Neo4j for those movie titles.
5. Fetch directors, actors, genres, themes, and awards.
6. Give the final answer using this retrieved context.

Example Cypher after Pinecone returns `"Inception"`:

```cypher
MATCH (d:Director)-[:DIRECTED]->(m:Movie {title: "Inception"})
OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
RETURN m.title, d.name, collect(DISTINCT a.name), collect(DISTINCT g.name), collect(DISTINCT t.name)
```

This is the main reason to have both vector search and graph search.

## 14. Config.js

`Config.js` connects the project to external services.

It uses `.env` variables for credentials:

- `NEO4J_URI`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_NAME`
- `NVIDIA_API_KEY`
- `GEMINI_API_KEY`

It creates:

- `driver`: Neo4j connection driver.
- `pineconeIndex`: Pinecone index connection.
- `invokeLLM`: function for calling Mistral through NVIDIA API.
- `embedText`: embeds one text.
- `embedTexts`: embeds multiple texts.
- `closeConnections`: closes Neo4j connection.

## 15. TestConnections.js

`TestConnections.js` checks whether the services are connected:

1. Neo4j
2. Pinecone
3. NVIDIA Mistral LLM
4. Gemini embeddings

The npm script is:

```bash
npm test
```

This runs:

```bash
node TestConnections.js
```

## 16. RunIndexing.js

The npm indexing script is:

```bash
npm run index
```

This runs:

```bash
node RunIndexing.js
```

That starts the complete pipeline:

```text
PDF -> text -> entities -> Neo4j graph -> Pinecone vectors
```

## 17. Example End-to-End

Input from PDF:

```text
Title: Inception
Year: 2010
Director: Christopher Nolan
Actors: Leonardo DiCaprio, Joseph Gordon-Levitt
Genres: Science Fiction, Thriller
Themes: Dreams, Reality, Memory
Awards: Oscar (Best Cinematography)
```

After `Entity_Extractor.js`:

```js
{
  movie: { title: "Inception", year: 2010 },
  director: { name: "Christopher Nolan" },
  actors: ["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
  genres: ["Science Fiction", "Thriller"],
  themes: ["Dreams", "Reality", "Memory"],
  awards: ["Oscar (Best Cinematography)"]
}
```

After `GraphBuilder.js`, Neo4j gets:

```text
Movie node: Inception
Director node: Christopher Nolan
Actor nodes: Leonardo DiCaprio, Joseph Gordon-Levitt
Genre nodes: Science Fiction, Thriller
Theme nodes: Dreams, Reality, Memory
Award node: Oscar / Best Cinematography
Relationships: DIRECTED, ACTED_IN, BELONGS_TO, EXPLORES, WON
```

After `Vector.js`, Pinecone gets:

```js
{
  id: "inception",
  values: [/* Gemini embedding numbers */],
  metadata: {
    title: "Inception",
    year: 2010,
    director: "Christopher Nolan",
    genres: "Science Fiction, Thriller",
    themes: "Dreams, Reality, Memory",
    actors: "Leonardo DiCaprio, Joseph Gordon-Levitt",
    text: "Inception is a Science Fiction, Thriller movie released in 2010..."
  }
}
```

## 18. Small Code Notes

There are a few important implementation notes:

1. `PdfParse.js` currently has this line at the bottom:

```js
parsePDF("./movie.pdf")
```

Because of this, importing `PdfParse.js` can trigger PDF parsing immediately. Usually this line should be removed, and only `RunIndexing.js` should call `parsePDF(pdfPath)`.

2. `RunIndexing.js` calls:

```js
const entities = await extractAllEntities(rawText, 250);
```

But `extractAllEntities` only accepts one argument:

```js
async function extractAllEntities(rawPdfText)
```

So `250` is currently ignored.

3. The catch message says:

```js
No data was inserted into the databases.
```

But if the graph insertion succeeds and Pinecone insertion fails later, then some Neo4j data may already have been inserted. So that message may not always be accurate.

4. The project creates indexes, not uniqueness constraints. Indexes improve speed, but uniqueness constraints are stronger if you want Neo4j to reject duplicates at the database level.

## 19. Summary

The project is doing this:

```text
1. Read movie.pdf.
2. Extract clean text from the PDF.
3. Split the text into movie blocks.
4. Send batches of movie text to Mistral.
5. Receive structured movie JSON.
6. Create Neo4j indexes for fast lookup.
7. Insert movies, actors, directors, genres, themes, awards into Neo4j.
8. Create graph relationships between those nodes.
9. Convert each movie entity into readable embedding text.
10. Use Gemini to convert that text into vectors.
11. Insert vectors plus metadata into Pinecone.
```

In simple words:

```text
Neo4j stores facts and relationships.
Pinecone stores meaning/similarity.
PDF parsing turns the source file into text.
LLM extraction turns messy text into clean JSON.
GraphBuilder turns JSON into connected graph data.
Vector.js turns JSON into searchable semantic vectors.
```
