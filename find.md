# Query Pipeline Explanation

This file explains how the query side of the project works.

Indexing happens first and stores data in:

- Neo4j for graph facts and relationships.
- Pinecone for semantic vector search.

After that, `RunQuery.js` lets the user ask questions against already indexed data.

The query flow is:

```text
User question
  -> RunQuery.js
  -> Entity_Resolver.js
  -> QueryClassifier.js
  -> GraphHander.js OR SimilarityHandler.js
  -> final answer
```

## 1. RunQuery.js

`RunQuery.js` is the interactive command-line entry point.

You run it with:

```bash
npm run query
```

It starts a prompt:

```text
You:
```

When the user types a question, this function handles it:

```js
async function processQuery(query) {
```

The function does three main things.

### Step 1: Entity resolution

```js
const resolved = await resolveQueryEntities(query);
```

This sends the query to `Entity_Resolver.js`.

Example:

```text
Tell me all the movies Zendaya worked on
```

The resolver returns:

```js
{
  query: "Tell me all the movies Zendaya worked on",
  entities: [
    {
      searchTerm: "Zendaya",
      label: "Actor",
      nodeName: "Zendaya",
      matchType: "exact"
    }
  ],
  unresolved: []
}
```

Meaning:

```text
The user said Zendaya.
Neo4j says Zendaya is an Actor.
Use Actor.name = "Zendaya" later.
```

### Step 2: Query classification

```js
const classification = await classifyQuery(query, resolved);
```

This sends the original query plus resolved entities to `QueryClassifier.js`.

The classifier returns only one of:

```js
{ type: "graph", reasoning: "..." }
```

or:

```js
{ type: "similarity", reasoning: "..." }
```

### Step 3: Route to the right handler

```js
if (classification.type === "similarity") {
  answer = await handleSimilarityQuery(query, resolved);
} else {
  answer = await handleGraphQuery(query, resolved);
}
```

If the question is factual, it goes to `GraphHander.js`.

If the question asks for similar movies, it goes to `SimilarityHandler.js`.

## 2. Entity_Resolver.js

`Entity_Resolver.js` figures out what names in the user question refer to in Neo4j.

It does not answer the question.

It only resolves names.

Example:

```text
who is nolan crishtopher
```

The resolver might produce:

```js
{
  entities: [
    {
      searchTerm: "Nolan",
      label: "Director",
      nodeName: "Christopher Nolan",
      matchType: "partial"
    }
  ],
  unresolved: ["Crishtopher"]
}
```

### NODE_TYPES

```js
const NODE_TYPES = [
  { label: "Movie", property: "title" },
  { label: "Director", property: "name" },
  { label: "Actor", property: "name" },
  { label: "Genre", property: "name" },
  { label: "Theme", property: "name" },
  { label: "Award", property: "name" },
];
```

`NODE_TYPES` is not built in.

It is your custom list telling the resolver:

```text
Search Movie.title
Search Director.name
Search Actor.name
Search Genre.name
Search Theme.name
Search Award.name
```

Movie uses `title` because movie nodes look like:

```cypher
(:Movie {title: "Inception"})
```

Other nodes use `name` because they look like:

```cypher
(:Actor {name: "Zendaya"})
(:Director {name: "Christopher Nolan"})
(:Genre {name: "Sci-Fi"})
```

### extractEntities(query)

```js
async function extractEntities(query) {
```

This asks Mistral to extract entity terms from the user question.

Example:

```text
Action movies with Tom Hardy
```

Mistral should return:

```js
["Action", "Tom Hardy"]
```

Example:

```text
Movies like Inception
```

Mistral should return:

```js
["Inception"]
```

The code expects a JSON array:

```js
const raw = await invokeLLM(systemPrompt, query);
const parsed = JSON.parse(cleanJson(raw));
return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
```

`filter(Boolean)` removes empty values.

Example:

```js
["Zendaya", "", null, "Inception"].filter(Boolean)
```

becomes:

```js
["Zendaya", "Inception"]
```

### resolveEntity(entityName)

```js
async function resolveEntity(entityName) {
```

This resolves one entity name at a time.

If the extracted entity array is:

```js
["Nolan", "Inception"]
```

then the code runs:

```js
resolveEntity("Nolan")
resolveEntity("Inception")
```

It does not receive the full array at once.

Inside `resolveEntity`, the code opens a Neo4j read session:

```js
const session = driver.session({ defaultAccessMode: "READ" });
const matches = [];
```

`matches` stores every result found in Neo4j.

Then it loops over every node type:

```js
for (const { label, property } of NODE_TYPES) {
```

For each label, it tries exact match first.

Example exact query for an actor:

```cypher
MATCH (n:Actor)
WHERE toLower(n.name) = toLower($name)
RETURN n.name AS nodeName, labels(n)[0] AS label
LIMIT 5
```

Exact match means:

```text
Zendaya == Zendaya
Inception == Inception
```

If exact match is found, it pushes:

```js
{
  searchTerm: entityName,
  label: record.get("label"),
  nodeName: record.get("nodeName"),
  matchType: "exact"
}
```

Then it skips partial search for that same label.

If exact match is not found, it tries partial match:

```cypher
MATCH (n:Director)
WHERE toLower(n.name) CONTAINS toLower($name)
RETURN n.name AS nodeName, labels(n)[0] AS label
LIMIT 5
```

Partial match means:

```text
Christopher Nolan contains Nolan
Leonardo DiCaprio contains DiCaprio
```

Partial match does not fix spelling mistakes.

This works:

```text
Nolan -> Christopher Nolan
```

This does not work by itself:

```text
Crishtopher -> Christopher
```

because:

```text
christopher does not contain crishtopher
```

At the end:

```js
const exactMatches = matches.filter((match) => match.matchType === "exact");
return exactMatches.length > 0 ? exactMatches : matches;
```

Meaning:

```text
If exact matches exist, return exact matches only.
If no exact matches exist, return partial matches.
```

Exact is preferred because it is more reliable.

### resolveQueryEntities(query)

This is the main resolver function.

It does:

```text
1. Ask Mistral to extract names from the query.
2. For each extracted name, call resolveEntity(name).
3. Put found items into resolved.
4. Put missing items into unresolved.
```

Example:

```text
who is nolan crishtopher
```

Possible result:

```js
{
  query: "who is nolan crishtopher",
  entities: [
    {
      searchTerm: "Nolan",
      label: "Director",
      nodeName: "Christopher Nolan",
      matchType: "partial"
    }
  ],
  unresolved: ["Crishtopher"]
}
```

## 3. QueryClassifier.js

`QueryClassifier.js` decides where the query should go.

It chooses:

```text
graph
```

or:

```text
similarity
```

### graph

Use `graph` when the question is about exact facts or relationships already stored in Neo4j.

Examples:

```text
Who is Christopher Nolan?
Movies directed by Christopher Nolan
Tell me all the movies Zendaya worked on
Action movies with Tom Hardy
How many sci-fi movies are there?
Movies that won Oscar
Recommend me movies where Christopher Nolan works
```

Even if the user says "recommend", it is still graph if they give a factual condition like:

```text
where Christopher Nolan works
directed by Nolan
with Zendaya
```

Because the best answer comes from exact graph facts.

### similarity

Use `similarity` when the question asks for semantic/taste recommendations.

Examples:

```text
Movies like Inception
Recommend movies similar to Interstellar
I liked Dune, what should I watch next?
Movies with the same vibe as The Matrix
```

These need Pinecone vector search because the user is asking for meaning, taste, or vibe.

### entityContext

The classifier builds this text:

```js
const entityContext = resolvedEntities.entities.length > 0
  ? resolvedEntities.entities
      .map((e) => `"${e.searchTerm}" is a ${e.label} with database name "${e.nodeName}"`)
      .join("\n")
  : "No entities were resolved from Neo4j.";
```

Example resolved entities:

```js
[
  {
    searchTerm: "Nolan",
    label: "Director",
    nodeName: "Christopher Nolan"
  },
  {
    searchTerm: "Inception",
    label: "Movie",
    nodeName: "Inception"
  }
]
```

The text becomes:

```text
"Nolan" is a Director with database name "Christopher Nolan"
"Inception" is a Movie with database name "Inception"
```

This helps Mistral classify correctly.

Example:

```text
Movies like Inception
```

Since `Inception` is a Movie, classify as:

```text
similarity
```

Example:

```text
Movies directed by Nolan
```

Since `Nolan` is a Director, classify as:

```text
graph
```

## 4. SimilarityHandler.js

`SimilarityHandler.js` handles semantic recommendation queries.

Example:

```text
Movies like Inception
```

The flow is:

```text
Source movie/query
  -> Gemini embedding
  -> Pinecone top 30
  -> candidate movie titles
  -> Neo4j graph facts for those movies
  -> rank by genre/theme overlap and vector score
  -> Mistral final top 10 answer
```

### Why vector DB first?

Pinecone is good at semantic similarity.

Example:

```text
Movies like Inception
```

Pinecone can find movies close in meaning, even if they do not share exact words.

### Why graph DB after Pinecone?

Pinecone gives candidates.

Neo4j gives facts about those candidates:

```text
title
year
directors
actors
genres
themes
```

The handler can then compare the source movie and candidate movies by:

```text
genre overlap
theme overlap
vector similarity score
```

For `Inception`, the handler should check:

```text
Inception genres
Inception themes
candidate genres
candidate themes
```

The code does that with:

```js
sourceContext = await getMovieContext(sourceMovieTitle);
```

and:

```js
genreOverlap: overlapCount(candidate.genres, sourceContext?.genres || [])
themeOverlap: overlapCount(candidate.themes, sourceContext?.themes || [])
```

The final answer should always recommend top 10 if enough candidates exist.

## 5. GraphHander.js

`GraphHander.js` handles graph/factual questions.

This is the most important query file for exact database answers.

Examples:

```text
Who is Christopher Nolan?
Tell me about Inception
Movies directed by Christopher Nolan
Tell me all the movies Zendaya worked on
How is Leonardo DiCaprio related to Christopher Nolan?
How many sci-fi movies are there?
```

Graph handler flow:

```text
User query + resolved entities
  -> createQueryPlan()
  -> decide plan type
  -> executeDescribe OR executePath OR executeTemplateCypher
  -> Mistral formats final answer
```

## 5.1 LABEL_CONFIG

```js
const LABEL_CONFIG = {
  Movie: { variable: "m", key: "title" },
  Director: { variable: "d", key: "name" },
  Actor: { variable: "a", key: "name" },
  Genre: { variable: "g", key: "name" },
  Theme: { variable: "t", key: "name" },
  Award: { variable: "aw", key: "name" },
};
```

This maps graph labels to:

- the Cypher variable name
- the main property used to identify the node

Example:

```text
Movie uses variable m and key title.
Actor uses variable a and key name.
Director uses variable d and key name.
```

Why?

Movie nodes are stored as:

```cypher
(:Movie {title: "Inception"})
```

Actor nodes are stored as:

```cypher
(:Actor {name: "Zendaya"})
```

So when path search needs a movie, it uses:

```cypher
(a:Movie {title: $fromName})
```

For an actor, it uses:

```cypher
(a:Actor {name: $fromName})
```

## 5.2 RELATIONSHIP_PATTERNS

```js
const RELATIONSHIP_PATTERNS = {
  "Director:DIRECTED:Movie": "(d:Director)-[:DIRECTED]->(m:Movie)",
  "Actor:ACTED_IN:Movie": "(a:Actor)-[:ACTED_IN]->(m:Movie)",
  "Movie:BELONGS_TO:Genre": "(m:Movie)-[:BELONGS_TO]->(g:Genre)",
  "Movie:EXPLORES:Theme": "(m:Movie)-[:EXPLORES]->(t:Theme)",
  "Movie:WON:Award": "(m:Movie)-[:WON]->(aw:Award)",
};
```

This is the safe list of relationships the graph handler can build.

It prevents random unsafe Cypher from being generated.

For example, if the plan says:

```js
{
  type: "traversal",
  from: "Actor",
  rel: "ACTED_IN",
  to: "Movie"
}
```

then `getPatternForTraversal()` returns:

```cypher
(a:Actor)-[:ACTED_IN]->(m:Movie)
```

That pattern means:

```text
Actor acted in Movie
```

## 5.3 fieldToExpression(field)

```js
function fieldToExpression(field) {
```

This converts a plan field into a Cypher expression.

Example:

```text
Movie.title -> m.title
Movie.year -> m.year
Actor.name -> a.name
Director.name -> d.name
Award.category -> aw.category
```

It also validates that the field is allowed.

Allowed fields:

```text
Movie.title
Movie.year
Director.name
Actor.name
Genre.name
Theme.name
Award.name
Award.category
```

If the LLM tries an invalid field, the code throws an error.

This is important because the LLM creates a JSON plan, but the code must still protect the database query.

## 5.4 createQueryPlan(query, resolvedEntities)

```js
async function createQueryPlan(query, resolvedEntities) {
```

This asks Mistral to create a JSON plan.

It does not ask Mistral to write raw Cypher.

That is intentional.

Safer flow:

```text
Mistral writes structured JSON plan
Code validates the plan
Code builds Cypher from allowed templates
```

The prompt tells Mistral the schema:

```text
Movie(title, year)
Director(name)
Actor(name)
Genre(name)
Theme(name)
Award(name, category)
```

and relationships:

```text
Director-[:DIRECTED]->Movie
Actor-[:ACTED_IN]->Movie
Movie-[:BELONGS_TO]->Genre
Movie-[:EXPLORES]->Theme
Movie-[:WON]->Award
```

Example user query:

```text
Tell me all the movies Zendaya worked on
```

Possible plan:

```json
{
  "steps": [
    {
      "type": "traversal",
      "from": "Actor",
      "rel": "ACTED_IN",
      "to": "Movie"
    },
    {
      "type": "filter",
      "field": "Actor.name",
      "op": "=",
      "value": "Zendaya"
    },
    {
      "type": "projection",
      "fields": ["Movie.title", "Movie.year"],
      "distinct": true
    },
    {
      "type": "limit",
      "value": 10
    }
  ]
}
```

The plan means:

```text
Start from Actor to Movie through ACTED_IN.
Filter Actor.name = Zendaya.
Return Movie.title and Movie.year.
Limit result to 10.
```

## 5.5 buildCypher(plan)

```js
function buildCypher(plan) {
```

This is the function that turns the JSON plan into real Cypher.

It creates:

```js
const matchPatterns = [];
const whereClauses = [];
const params = {};
let returnClause = null;
let orderClause = "";
let limitClause = "LIMIT 10";
```

These parts become the final Cypher query.

### traversal step

For this step:

```json
{
  "type": "traversal",
  "from": "Actor",
  "rel": "ACTED_IN",
  "to": "Movie"
}
```

The code adds:

```cypher
MATCH (a:Actor)-[:ACTED_IN]->(m:Movie)
```

### filter step

For this step:

```json
{
  "type": "filter",
  "field": "Actor.name",
  "op": "=",
  "value": "Zendaya"
}
```

The code creates:

```cypher
WHERE a.name = $p0
```

and:

```js
params = { p0: "Zendaya" }
```

The value is not pasted directly into the Cypher string.

It uses a parameter:

```cypher
$p0
```

That is safer and handles quotes/special characters correctly.

### projection step

For this step:

```json
{
  "type": "projection",
  "fields": ["Movie.title", "Movie.year"],
  "distinct": true
}
```

The code creates:

```cypher
RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year
```

Projection means:

```text
What fields should the query return?
```

### aggregation step

For count queries:

```json
{
  "type": "aggregation",
  "function": "count",
  "field": "Movie.title",
  "alias": "total"
}
```

The code creates:

```cypher
RETURN count(DISTINCT m.title) AS total
```

Example user query:

```text
How many sci-fi movies are there?
```

### sort step

For this step:

```json
{
  "type": "sort",
  "field": "Movie.year",
  "direction": "DESC"
}
```

The code creates:

```cypher
ORDER BY m.year DESC
```

### limit step

For this step:

```json
{
  "type": "limit",
  "value": 10
}
```

The code creates:

```cypher
LIMIT 10
```

The code caps the limit at 10:

```js
limitClause = `LIMIT ${Math.min(value, 10)}`;
```

So list answers do not return too many rows.

### final Cypher example

For:

```text
Tell me all the movies Zendaya worked on
```

The final Cypher can be:

```cypher
MATCH (a:Actor)-[:ACTED_IN]->(m:Movie)
WHERE a.name = $p0
RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year
LIMIT 10
```

with params:

```js
{ p0: "Zendaya" }
```

## 5.6 executeDescribe(label, name)

```js
async function executeDescribe(label, name) {
```

This is used when the user asks:

```text
Tell me about Inception
Who is Christopher Nolan?
```

The plan is simple:

```json
{
  "steps": [
    {
      "type": "describe",
      "label": "Director",
      "name": "Christopher Nolan"
    }
  ]
}
```

Instead of building from generic traversal steps, the code uses a specific Cypher query for each label.

### Movie describe

For:

```text
Tell me about Inception
```

It runs:

```cypher
MATCH (m:Movie {title: $name})
OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
OPTIONAL MATCH (m)-[:WON]->(aw:Award)
RETURN m.title AS title, m.year AS year,
       collect(DISTINCT d.name) AS directors,
       collect(DISTINCT a.name) AS actors,
       collect(DISTINCT g.name) AS genres,
       collect(DISTINCT t.name) AS themes,
       collect(DISTINCT {name: aw.name, category: aw.category}) AS awards
```

This gives a full movie profile:

```text
title
year
directors
actors
genres
themes
awards
```

### Director describe

For:

```text
Who is Christopher Nolan?
```

It runs:

```cypher
MATCH (d:Director {name: $name})-[:DIRECTED]->(m:Movie)
OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
RETURN d.name AS name,
       collect(DISTINCT {title: m.title, year: m.year}) AS movies,
       collect(DISTINCT g.name) AS genres,
       collect(DISTINCT t.name) AS themes,
       collect(DISTINCT a.name) AS collaborators
```

This gives:

```text
director name
movies directed
genres of those movies
themes of those movies
actors who worked in those movies
```

### Actor describe

For:

```text
Who is Zendaya?
```

It runs:

```cypher
MATCH (a:Actor {name: $name})-[:ACTED_IN]->(m:Movie)
OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
RETURN a.name AS name,
       collect(DISTINCT {title: m.title, year: m.year}) AS movies,
       collect(DISTINCT d.name) AS directors,
       collect(DISTINCT g.name) AS genres,
       collect(DISTINCT t.name) AS themes
```

This gives:

```text
actor name
movies acted in
directors worked with
genres
themes
```

## 5.7 executePath(fromLabel, fromName, toLabel, toName)

```js
async function executePath(fromLabel, fromName, toLabel, toName) {
```

This is used for relationship questions.

Example:

```text
How is Leonardo DiCaprio related to Christopher Nolan?
```

The plan:

```json
{
  "steps": [
    {
      "type": "path",
      "fromLabel": "Actor",
      "fromName": "Leonardo DiCaprio",
      "toLabel": "Director",
      "toName": "Christopher Nolan"
    }
  ]
}
```

The Cypher:

```cypher
MATCH (a:Actor {name: $fromName}),
      (b:Director {name: $toName}),
      path = shortestPath((a)-[*..6]-(b))
RETURN [node IN nodes(path) | {
  labels: labels(node),
  name: coalesce(node.name, node.title),
  year: node.year
}] AS pathNodes,
[rel IN relationships(path) | type(rel)] AS pathRels
```

This finds the shortest connection between the two entities.

Example result:

```text
Leonardo DiCaprio acted in Inception.
Christopher Nolan directed Inception.
```

## 5.8 executeTemplateCypher(plan)

```js
async function executeTemplateCypher(plan) {
```

This is used for normal factual list/count/filter questions.

It does:

```js
const { cypher, params } = buildCypher(plan);
const result = await session.run(cypher, params);
return recordsToObjects(result);
```

So the real order is:

```text
JSON plan
  -> buildCypher()
  -> session.run(cypher, params)
  -> recordsToObjects()
```

## 5.9 recordsToObjects(result)

Neo4j returns records in a Neo4j-specific format.

The project converts them into normal JavaScript objects:

```js
function recordsToObjects(result) {
```

It also converts Neo4j integers into normal numbers:

```js
if (value && typeof value === "object" && typeof value.toNumber === "function") {
  return value.toNumber();
}
```

This matters because Neo4j integers are not always plain JavaScript numbers.

The final Mistral call gets clean JSON-like data.

## 5.10 handleGraphQuery(query, resolvedEntities)

This is the main exported graph function.

```js
async function handleGraphQuery(query, resolvedEntities) {
```

It does:

```text
1. createQueryPlan()
2. Look at the first plan step.
3. If first step is describe, call executeDescribe().
4. If first step is path, call executePath().
5. Otherwise call executeTemplateCypher().
6. Send results to Mistral for a plain English answer.
```

The routing logic:

```js
if (firstStep.type === "describe") {
  records = await executeDescribe(firstStep.label, firstStep.name);
} else if (firstStep.type === "path") {
  records = await executePath(...);
} else {
  records = await executeTemplateCypher(plan);
}
```

After Neo4j returns records, it checks:

```js
if (records.length === 0 || records[0]?.error) {
```

If no result exists, it returns:

```text
I could not find an answer
```

Otherwise it sends the first 10 rows to Mistral:

```js
JSON.stringify(records.slice(0, 10), null, 2)
```

The system prompt tells Mistral:

```text
Answer in plain English.
Do not mention databases, Cypher, JSON, vectors, or technical implementation.
For list-style answers, return at most 10 items unless the result is a count.
```

So the user gets a clean answer, not raw database rows.

## 6. Example End-to-End: Zendaya Query

Question:

```text
Tell me all the movies Zendaya worked on
```

### Entity resolver

Extracts:

```js
["Zendaya"]
```

Resolves:

```js
{
  searchTerm: "Zendaya",
  label: "Actor",
  nodeName: "Zendaya",
  matchType: "exact"
}
```

### Classifier

Classifies:

```js
{
  type: "graph",
  reasoning: "The query asks for movies connected to an actor."
}
```

### Graph handler plan

```json
{
  "steps": [
    {
      "type": "traversal",
      "from": "Actor",
      "rel": "ACTED_IN",
      "to": "Movie"
    },
    {
      "type": "filter",
      "field": "Actor.name",
      "op": "=",
      "value": "Zendaya"
    },
    {
      "type": "projection",
      "fields": ["Movie.title", "Movie.year"],
      "distinct": true
    },
    {
      "type": "limit",
      "value": 10
    }
  ]
}
```

### Final Cypher

```cypher
MATCH (a:Actor)-[:ACTED_IN]->(m:Movie)
WHERE a.name = $p0
RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year
LIMIT 10
```

Params:

```js
{ p0: "Zendaya" }
```

### Answer

Mistral formats the returned movie rows into a normal answer.

## 7. Example End-to-End: Similarity Query

Question:

```text
Movies like Inception
```

### Entity resolver

Resolves:

```js
{
  searchTerm: "Inception",
  label: "Movie",
  nodeName: "Inception",
  matchType: "exact"
}
```

### Classifier

Classifies:

```js
{
  type: "similarity",
  reasoning: "The query asks for movies similar to a known movie."
}
```

### Similarity handler

Does:

```text
1. Embed "Inception".
2. Search Pinecone top 30.
3. Read candidate titles from Pinecone metadata.
4. Fetch candidate facts from Neo4j.
5. Fetch Inception facts from Neo4j.
6. Compare genre/theme overlap.
7. Ask Mistral for final top 10.
```

## 8. Important Current Limitation

If the same real person exists as both Actor and Director, the resolver can return both labels.

Example:

```text
Nolan -> Director
Nolan -> Actor
```

But `GraphHander.js` may still plan only one role, depending on what Mistral returns.

For a query like:

```text
What movies did Nolan work on?
```

the best answer should combine:

```text
movies directed by Nolan
movies acted in by Nolan
```

That needs special multi-role handling. The resolver is capable of finding multiple roles, but the graph handler is not fully specialized for combining roles yet.

