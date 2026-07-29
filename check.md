# GraphRAG Interview Preparation

Use this file in order. First learn the project overview, then architecture, then core RAG and GraphRAG concepts. Detailed code and pipeline explanation is intentionally left out for now and can be added later.

## 1. What You Should Know First

Before explaining code, you should be able to clearly explain:

1. What problem this project solves.
2. Why normal vector RAG is not enough.
3. Why GraphRAG helps.
4. Why Neo4j and Pinecone are both used.
5. How a user query moves through the system at a high level.
6. What your personal contribution was.
7. What results you achieved.
8. What the limitations are.

Short version:

> This is a hybrid GraphRAG movie question-answering and recommendation system. It combines Neo4j graph retrieval for exact factual and relationship queries with Pinecone vector search for semantic recommendation queries. The goal is to reduce hallucination and improve completeness compared with vector-only RAG.

## 2. Project Overview Questions

### Tell Me About This Project

This project is a movie-focused hybrid GraphRAG system. It lets users ask natural language questions about movies, actors, directors, genres, themes, and awards.

It supports two main types of questions:

- Factual or relationship questions, such as "Which movies did Christopher Nolan direct?"
- Semantic recommendation questions, such as "I liked Movie 0227. What should I watch next?"

The system uses Neo4j for exact graph relationships and Pinecone for semantic similarity search.

### What Problem Does It Solve?

It solves the problem that vector-only RAG is weak for exact facts, multi-hop reasoning, and complete list answers.

For example:

```text
Which Christopher Nolan movies include Zendaya and won an Oscar?
```

A vector database may retrieve similar text, but it may miss some movies or include incorrect ones. A graph database can deterministically traverse:

```text
Director -> Movie <- Actor
Movie -> Award
```

So this project combines vector search and graph retrieval to make answers more grounded and complete.

### Who Are The Intended Users?

The intended users are:

- Movie fans looking for recommendations.
- Users who want factual movie answers.
- Students or developers learning GraphRAG.
- Anyone comparing vector-only RAG with hybrid GraphRAG.

In an interview, say:

> The direct user is someone asking movie-related questions, but the technical purpose is to demonstrate a reliable GraphRAG architecture for factual QA and recommendation.

### Why Did You Choose To Build This Project?

I chose this project because movie data is naturally graph-shaped. Movies connect to actors, directors, genres, themes, and awards. That makes it a good domain to show why graph retrieval is useful.

It also allowed me to compare two retrieval styles:

- Vector retrieval for semantic similarity.
- Graph retrieval for exact relationships and multi-hop constraints.

### What Are Its Main Features?

Main features:

1. PDF-based data ingestion.
2. LLM-based structured movie entity extraction.
3. Neo4j knowledge graph creation.
4. Pinecone vector index creation.
5. Natural language query interface.
6. Entity resolution from user questions.
7. Query routing between graph and similarity paths.
8. Safe graph query planning using restricted JSON plans.
9. Graph-enriched movie recommendations.
10. RAGAS-based hallucination evaluation.

### What Makes This Project Different From A Basic Implementation?

A basic RAG implementation usually embeds documents and retrieves similar chunks from a vector database.

This project is different because:

- It uses a graph database for exact relationships.
- It routes queries based on intent.
- It does not execute raw LLM-generated Cypher.
- It validates a restricted query plan before querying Neo4j.
- It combines vector similarity with graph-based reranking.
- It evaluates hallucination and answer coverage.

Good interview answer:

> The main difference is that this is not just vector search plus an LLM. It separates factual graph retrieval from semantic recommendation retrieval, which makes the system more reliable for relationship-heavy questions.

### Is This Project Deployed And Usable?

It is usable locally through a command-line interface.

It is not currently deployed as a public web application. To run it, the user needs:

- Node.js dependencies installed.
- Neo4j credentials.
- Pinecone credentials.
- NVIDIA API key for Mistral.
- Gemini API key for embeddings.

Interview answer:

> It is not publicly deployed yet. It runs locally as a CLI-based prototype, and all external services are connected through environment variables.

### Was This An Individual Or Team Project?

Answer based on your situation. If this was your own work, say:

> This was an individual project. I designed the architecture, built the indexing flow, implemented the graph and vector retrieval paths, and created the evaluation setup.

If it was a team project, say:

> This was a team project, and my contribution was focused on the GraphRAG pipeline, query routing, Neo4j schema, and evaluation.

### What Was Your Exact Contribution?

Say:

> My contribution was end-to-end implementation of the hybrid GraphRAG system. I created the data ingestion flow, extracted structured movie entities using an LLM, built the Neo4j graph schema, indexed movie embeddings in Pinecone, implemented query classification, built the graph query path, added similarity search with graph enrichment, and evaluated hallucination using RAGAS.

If you want a shorter answer:

> I handled the full backend RAG pipeline: ingestion, graph construction, vector indexing, query routing, retrieval, answer generation, and evaluation.

### How Long Did It Take To Build?

Use the real number if you know it. If asked and you need a reasonable answer:

> The first working version took around a few days to a week. Most of the time went into designing the graph schema, making the LLM outputs reliable, adding query routing, and evaluating the results.

Avoid claiming an exact timeline if it is not true.

## 3. Architecture Questions

### Can You Draw And Explain The High-Level Architecture?

You can draw this:

```text
                 Data Preparation

        PDF Dataset
             |
             v
      Text Extraction
             |
             v
   LLM Entity Extraction
             |
       +-----+------+
       |            |
       v            v
   Neo4j Graph   Pinecone Vector DB


                  Query Time

        User Question
             |
             v
     Entity Resolution
             |
             v
     Query Classification
             |
       +-----+------+
       |            |
       v            v
 Graph Retrieval   Vector Retrieval
   with Neo4j      with Pinecone
       |            |
       |            v
       |      Graph Enrichment
       |            |
       +-----+------+
             |
             v
      Final LLM Answer
```

Explanation:

> At indexing time, the system extracts movie facts from the PDF, stores structured facts in Neo4j, and stores semantic embeddings in Pinecone. At query time, it resolves entities, classifies the query, and routes it either to Neo4j for factual questions or Pinecone for similarity questions. The final answer is generated by the LLM using retrieved context.

### What Are The Major Components Of The System?

Major components:

1. PDF parser.
2. Entity extractor.
3. Neo4j graph builder.
4. Pinecone vector indexer.
5. Entity resolver.
6. Query classifier.
7. Graph query handler.
8. Similarity recommendation handler.
9. LLM answer generator.
10. Evaluation module.

### What Responsibility Does Each Component Have?

PDF parser:

> Extracts clean text from the movie PDF.

Entity extractor:

> Uses an LLM to convert unstructured text into structured movie JSON.

Neo4j graph builder:

> Stores movies, actors, directors, genres, themes, and awards as graph nodes and relationships.

Pinecone vector indexer:

> Stores movie embeddings for semantic similarity search.

Entity resolver:

> Finds movie, actor, director, genre, theme, or award names mentioned in the user query and resolves them against Neo4j.

Query classifier:

> Decides whether the query should use graph retrieval or vector similarity retrieval.

Graph query handler:

> Converts factual questions into safe graph query plans and executes read-only Neo4j queries.

Similarity handler:

> Retrieves semantically similar movies from Pinecone, enriches them with Neo4j facts, and reranks them.

LLM answer generator:

> Converts retrieved facts into a natural language response.

Evaluation module:

> Compares vector-only RAG and hybrid GraphRAG using RAGAS and movie-ID coverage.

### How Do These Components Communicate?

They communicate through function calls inside a Node.js modular application.

At a high level:

```text
RunIndexing.js calls parser -> extractor -> graph builder -> vector indexer
RunQuery.js calls entity resolver -> classifier -> graph handler or similarity handler
```

External communication happens through API clients:

- Neo4j driver communicates with Neo4j.
- Pinecone SDK communicates with Pinecone.
- Axios calls the NVIDIA-hosted Mistral model.
- Google GenAI SDK calls Gemini embeddings.

### Why Did You Choose This Architecture?

I chose this architecture because the project has two different retrieval needs:

- Exact factual reasoning.
- Semantic recommendation.

A single vector database is not reliable enough for exact multi-hop questions. A graph database alone is not ideal for semantic similarity. So a hybrid architecture fits the problem better.

Also, separating components makes the system easier to test and explain:

- One module handles parsing.
- One handles extraction.
- One handles graph storage.
- One handles vector storage.
- One handles routing.
- One handles graph retrieval.
- One handles similarity retrieval.

### Is It A Monolith, Modular Monolith, Or Microservices Architecture?

It is a modular monolith.

It is one Node.js application, but the code is separated into modules by responsibility.

Interview answer:

> It is a modular monolith. All components run in the same application, but they are separated into files based on responsibilities like indexing, graph building, vector indexing, classification, graph retrieval, and similarity retrieval.

### Why Did You Choose A Modular Monolith?

A modular monolith is simpler for this project because:

- It is a prototype/research-style project.
- There is no need for independent deployment of each component.
- Function calls are easier than network calls.
- Debugging is simpler.
- The system still has clean separation of concerns.

Good answer:

> I did not need microservices because the project is not large enough to justify distributed deployment. A modular monolith gave me clean structure without unnecessary operational complexity.

### Why Not Microservices?

Microservices would add extra complexity:

- Service discovery.
- API contracts between services.
- More deployment work.
- More monitoring.
- Network latency.
- More failure points.

For this project, that would be overengineering.

### What Are The Disadvantages Of Your Architecture?

Disadvantages:

1. The CLI is not user-friendly for non-technical users.
2. All modules run in one process, so failures can affect the full app.
3. It depends on external services: Neo4j, Pinecone, NVIDIA API, and Gemini API.
4. LLM output can still be inconsistent.
5. Similarity constraints are not fully enforced as hard filters yet.
6. There is no public deployment or UI.
7. Scaling would require better job handling, caching, and async processing.

Good interview answer:

> The main disadvantage is that it is still a local modular prototype. It is good for demonstrating GraphRAG, but for production I would add a web API, background indexing jobs, better retries, caching, monitoring, and stricter constraint handling.

### How Would The Architecture Change At Larger Scale?

At larger scale, I would add:

1. A backend API service instead of only CLI.
2. A frontend web interface.
3. Background workers for PDF ingestion and indexing.
4. A job queue for long-running extraction and embedding tasks.
5. Caching for repeated queries and embeddings.
6. Better observability: logs, metrics, tracing.
7. Separate evaluation pipeline.
8. Authentication and rate limiting.
9. Better error handling and retries.
10. Possibly split indexing and query serving into separate services.

Possible scaled architecture:

```text
Frontend
   |
API Server
   |
   +--> Query Service
   |       +--> Neo4j
   |       +--> Pinecone
   |       +--> LLM
   |
   +--> Indexing Job Queue
           +--> Worker
           +--> Neo4j
           +--> Pinecone
```

### Which Component Is The Main Entry Point?

There are two main entry points:

For indexing:

```text
RunIndexing.js
```

For querying:

```text
RunQuery.js
```

Interview answer:

> `RunIndexing.js` is the entry point for building the graph and vector index. `RunQuery.js` is the entry point for the user-facing query CLI.

## 4. Core RAG Questions And Answers

### What Is RAG?

RAG means Retrieval-Augmented Generation. Instead of asking the LLM to answer only from its training data, the system first retrieves relevant external information and gives it to the LLM as context.

In this project:

- Neo4j retrieves graph facts.
- Pinecone retrieves semantically similar movies.
- The LLM generates the final answer using retrieved context.

### Why Did You Use RAG Here?

I used RAG because movie facts should come from the project dataset, not from the LLM's memory. RAG makes the answer grounded in retrieved data and reduces hallucination.

### What Is Vector RAG?

Vector RAG stores text as embeddings in a vector database. When the user asks a question, the query is embedded and compared against stored vectors. The closest matches are retrieved as context.

In this project, Pinecone is the vector database.

### What Is GraphRAG?

GraphRAG uses a graph database or knowledge graph as part of retrieval. Instead of retrieving only text chunks, it retrieves structured relationships.

Example:

```text
Christopher Nolan -DIRECTED-> Movie 0227
Zendaya -ACTED_IN-> Movie 0227
Movie 0227 -EXPLORES-> Technology
```

This is better for relationship and multi-hop questions.

### What Is The Difference Between Vector RAG And GraphRAG?

Vector RAG:

- Best for semantic similarity.
- Retrieves similar text.
- Good for vague recommendation questions.
- Can be incomplete for exact lists.

GraphRAG:

- Best for exact relationships.
- Retrieves structured facts.
- Good for filters, joins, and multi-hop reasoning.
- Requires a clean graph schema.

Simple answer:

> Vector RAG answers by similarity. GraphRAG answers by explicit relationships.

### Why Is Vector-Only RAG Weak For This Project?

Vector-only RAG is weak because many questions need exact constraints.

Example:

```text
Which movies feature Natalie Portman and also won Oscar Best Picture?
```

This needs exact actor and award filtering. Vector search might retrieve related movie descriptions but may not return the complete exact set.

### Why Use Neo4j?

Neo4j is used because the data is relationship-heavy. Movies connect to directors, actors, genres, themes, and awards. Neo4j makes multi-hop traversal natural and reliable.

### Why Use Pinecone?

Pinecone is used because recommendation questions need semantic similarity. If the user says "movies like Movie 0227" or "same vibe", a vector database can find similar movies based on embeddings.

### Why Use Both Neo4j And Pinecone?

Because the system needs both:

- Neo4j for exact factual answers.
- Pinecone for semantic similarity.

Together, they make a hybrid GraphRAG system.

### What Is Query Routing?

Query routing means deciding which retrieval path should answer the user question.

In this project:

- Factual/list/count/filter questions go to Neo4j.
- Similarity/recommendation questions go to Pinecone plus graph enrichment.

### Why Is Query Routing Important?

Without routing, all queries may go to vector search, which can fail on exact facts. Routing makes sure the right retrieval method is used for each question.

### Why Is The Word "Recommend" Not Always A Similarity Query?

Because some recommendation questions are actually exact factual filters.

Example:

```text
Recommend all movies directed by Christopher Nolan.
```

This should go to Neo4j because it asks for an exact list. It is not asking for semantic similarity.

Similarity requires words like:

```text
similar to
movies like
same vibe
liked
watch next
```

### What Is Entity Resolution?

Entity resolution means finding entities mentioned in the user query and matching them to database nodes.

Example:

```text
Nolan
```

can resolve to:

```text
Christopher Nolan
```

This helps the query planner use exact database names.

### What Is Hallucination?

Hallucination means the LLM produces an answer that is not supported by the retrieved data.

Example:

> Saying a movie won an Oscar when the graph does not show that award.

### How Did You Reduce Hallucination?

I reduced hallucination by grounding answers in retrieved data:

- Factual answers come from Neo4j graph results.
- Similarity answers use Pinecone candidates enriched with Neo4j facts.
- The final LLM prompt says to use only the retrieved results.
- The graph path does not allow arbitrary LLM-generated Cypher.

### What Is Faithfulness?

Faithfulness measures whether the answer is supported by the provided context.

In the evaluation:

```text
hallucination rate = 1 - faithfulness
```

### What Were The Evaluation Results?

The reported evaluation compared vector-only RAG with hybrid GraphRAG on 25 questions.

Results:

```text
Vector-only faithfulness: 61.00%
Hybrid GraphRAG faithfulness: 79.74%

Vector-only hallucination rate: 39.00%
Hybrid GraphRAG hallucination rate: 20.26%

Relative hallucination reduction: 48.06%
```

Coverage:

```text
Vector-only coverage: 26 / 92 = 28.26%
Hybrid GraphRAG coverage: 75 / 92 = 81.52%
```

### Why Can Faithfulness Be High But Answer Quality Still Be Poor?

Because faithfulness checks whether claims are supported, not whether the answer is complete.

A short answer can be faithful but incomplete.

Example:

> If five movies are expected and the system returns only one correct movie, it may still be faithful, but it is incomplete.

That is why this project also looks at movie-ID coverage.

### What Is The Main Limitation Of This Project?

Main limitations:

- It is local CLI-based, not deployed publicly.
- It depends on external APIs.
- Similarity constraints are not fully hard-filtered yet.
- LLM output can still require validation and retries.
- Partial entity matches can be ambiguous.
- Larger-scale indexing would need background jobs and caching.

### How Would You Improve It?

I would improve it by:

1. Adding a web UI and backend API.
2. Adding hard filters for recommendation constraints.
3. Adding better entity disambiguation.
4. Adding caching for embeddings and LLM responses.
5. Adding more tests around query planning.
6. Adding monitoring and structured logs.
7. Deploying the app with separate indexing and query-serving flows.

## 5. Final Interview Summary

Use this when asked to explain everything briefly:

> I built a hybrid GraphRAG movie QA and recommendation system. The problem is that vector-only RAG is good for semantic similarity but weak for exact relationship queries and multi-hop filtering. I solved that by storing movie facts in Neo4j and movie embeddings in Pinecone. At query time, the system resolves entities, classifies the question, and routes it either to graph retrieval or similarity retrieval. Neo4j handles exact factual answers, while Pinecone handles semantic recommendations with graph enrichment. The graph query path is safer because the LLM creates a restricted query plan instead of raw Cypher. In evaluation, hybrid GraphRAG improved faithfulness from 61.00% to 79.74% and reduced hallucination rate from 39.00% to 20.26%.

