# BEL_PROJECT V-2.0

Hybrid GraphRAG movie recommendation and factual query system built with Neo4j, Pinecone, Mistral, and Gemini embeddings.

## Problem

Movie recommendation systems need to answer two different kinds of questions:

- Exact factual questions, such as "Which movies did Christopher Nolan direct?" or "Which Oscar-winning movies include Natalie Portman?"
- Semantic recommendation questions, such as "I liked Movie 0001. What should I watch next?"

A vector-only RAG system works for broad similarity, but it struggles with exact relationship filters, multi-hop reasoning, and complete list answers. This project solves that by combining:

- Neo4j graph traversal for deterministic facts and relationships.
- Pinecone vector search for semantic similarity.
- LLM-based routing and response generation for a natural language interface.

## Architecture
<img width="652" height="724" alt="image" src="https://github.com/user-attachments/assets/b426b03d-6dfa-4bec-ba9a-de13fb632300" />



## Why This Stack

- Neo4j: represents movies, directors, actors, genres, themes, and awards as explicit nodes and relationships, making multi-hop factual queries reliable.
- Pinecone: provides fast semantic retrieval for "similar to" and taste-based recommendation queries.
- Gemini embeddings: converts movie summaries and user queries into vectors for Pinecone search.
- Mistral through NVIDIA API: performs structured extraction, query classification, query planning, and final answer generation.
- RAGAS: measures answer faithfulness and estimates hallucination rate across vector-only and hybrid GraphRAG systems.

## Data Model

The Neo4j graph uses these nodes:

- `Movie(title, year)`
- `Director(name)`
- `Actor(name)`
- `Genre(name)`
- `Theme(name)`
- `Award(name, category)`

Relationships:

- `(Director)-[:DIRECTED]->(Movie)`
- `(Actor)-[:ACTED_IN]->(Movie)`
- `(Movie)-[:BELONGS_TO]->(Genre)`
- `(Movie)-[:EXPLORES]->(Theme)`
- `(Movie)-[:WON]->(Award)`

## Data Flow

1. `RunIndexing.js` starts the indexing pipeline.
2. `PdfParse.js` extracts raw text from `movie.pdf`.
3. `Entity_Extractor.js` batches the PDF text and asks Mistral to return validated JSON movie entities.
4. `GraphBuilder.js` writes entities into Neo4j with `MERGE`, which deduplicates repeated movies, people, genres, themes, and awards.
5. `Vector.js` creates compact movie text summaries, embeds them with Gemini, and stores vectors in Pinecone.
6. `RunQuery.js` starts the query CLI.
7. `Entity_Resolver.js` extracts entity mentions from the user query and resolves them to existing Neo4j nodes.
8. `QueryClassifier.js` routes the query:
   - `graph` for exact facts, filters, lists, counts, relationships, and multi-hop questions.
   - `similarity` for "similar to", "movies like", "liked", and "watch next" queries.
9. `GraphHander.js` converts graph questions into a restricted query plan and compiles that plan into read-only Cypher.
10. `SimilarityHandler.js` runs Pinecone top-k retrieval, enriches candidates with Neo4j graph facts, reranks by graph overlap, and asks the LLM for the final recommendation list.

## Query Flow

### Factual or Relationship Query

```text
User query
 -> entity extraction
 -> Neo4j entity resolution
 -> graph classification
 -> restricted JSON query plan
 -> whitelist validation
 -> read-only Cypher
 -> Neo4j results
 -> final answer
```

Example:

```text
Which Christopher Nolan movies include Zendaya as an actor?
```

This is routed to Neo4j because it requires an exact director-to-movie and actor-to-movie relationship join.

### Similarity or Recommendation Query

```text
User query
 -> entity extraction
 -> similarity classification
 -> Pinecone vector search
 -> Neo4j candidate enrichment
 -> graph-aware reranking
 -> final recommendation answer
```

Example:

```text
Recommend five movies similar to Movie 0227, but keep only Action or Adventure movies that share Technology or Dreams.
```

This starts with vector search, then uses graph facts to keep recommendations grounded in genres and themes.

## Security and Query Safety

The graph query path does not directly execute arbitrary LLM-generated Cypher. Instead:

- The LLM returns a JSON query plan.
- The plan is validated against known labels, properties, relationship types, operators, projections, sorting, and limits.
- Only supported traversal templates are compiled into Cypher.
- Neo4j sessions use read access for query execution.
- Unsupported labels, fields, operators, or relationships are rejected before execution.

This reduces prompt injection risk because user text cannot directly become a database command.

## Hard Parts

- Extracting reliable structured entities from unstructured PDF text while handling LLM JSON formatting errors.
- Keeping vector search useful for recommendations without letting it answer exact graph questions incorrectly.
- Designing a router that treats "recommend all movies by Christopher Nolan" as a graph/list query, not a semantic similarity query.
- Constraining LLM-generated query plans so the system can use language models without trusting arbitrary generated Cypher.
- Evaluating hallucination correctly: RAGAS faithfulness measures unsupported claims, but list-style recommendation quality also needs answer completeness checks.

## Hallucination Evaluation

The evaluation in `hallucination.md` compares the same 25 questions across vector-only RAG and vector DB + GraphRAG:

- 10 multi-hop questions
- 5 simple-fact questions
- 5 relationship questions
- 5 recommendation questions

Summary:

| System | RAGAS faithfulness | Hallucination rate |
| --- | ---: | ---: |
| Vector-only RAG | 61.00% | 39.00% |
| Vector DB + GraphRAG | 79.74% | 20.26% |

The hybrid system reduced hallucination by 48.06% on the completed faithfulness evaluation. On graph/list/recommendation movie-ID coverage, vector-only retrieved 26 / 92 expected movies, while vector DB + GraphRAG retrieved 75 / 92.

## Project Structure

```text
Config.js                         API clients and shared helpers
PdfParse.js                       PDF text extraction
Entity_Extractor.js               Mistral-based structured extraction
GraphBuilder.js                   Neo4j graph ingestion
Vector.js                         Pinecone indexing with Gemini embeddings
RunIndexing.js                    End-to-end indexing pipeline
Entity_Resolver.js                Query entity extraction and Neo4j resolution
QueryClassifier.js                Graph vs similarity routing
GraphHander.js                    Graph query planning and safe Cypher execution
SimilarityHandler.js              Vector retrieval, graph enrichment, reranking
RunQuery.js                       Interactive query CLI
TestConnections.js                Neo4j, Pinecone, LLM, and embedding checks
evaluation/                       RAGAS evaluation scripts
hallucination.md                  Evaluation report
movie.pdf                         Source dataset
```

## How To Run

### 1. Install dependencies

```bash
npm install
```

For RAGAS evaluation, use the Python environment used by the project and install the required Python packages if they are not already available.

### 2. Configure environment variables

Create a `.env` file with:

```bash
NEO4J_URI=your_neo4j_uri
NEO4J_USERNAME=your_neo4j_username
NEO4J_PASSWORD=your_neo4j_password
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_pinecone_index_name
NVIDIA_API_KEY=your_nvidia_api_key
GEMINI_API_KEY=your_gemini_api_key
```

The Pinecone index dimension must match `gemini-embedding-001`.

### 3. Test external services

```bash
npm test
```

This checks Neo4j, Pinecone, the NVIDIA-hosted Mistral model, and Gemini embeddings.

### 4. Build the graph and vector index

```bash
npm run index
```

This reads `movie.pdf`, extracts movie entities, writes the Neo4j graph, and builds the Pinecone vector store.

### 5. Run the query CLI

```bash
npm run query
```

Example questions:

```text
Which Christopher Nolan movies include Zendaya as an actor?
Which movies feature Natalie Portman and also won Oscar (Best Picture)?
Recommend five movies similar to Movie 0227, but keep only Action or Adventure movies that share Technology or Dreams.
Tell me about Movie 0243.
```

Type `exit` to close the CLI.

### 6. Run the evaluation

Generate the improved 25-question evaluation set and answers:

```bash
node evaluation/generate_eval_results.js --limit=25 --question-set=improved
```

Run RAGAS faithfulness evaluation for both systems:

```bash
python evaluation/run_ragas_eval.py --metrics=faithfulness --systems=both
```

Outputs are written under `evaluation/outputs/`. The final report is in `hallucination.md`.

