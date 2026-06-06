# Hallucination Evaluation Report

This evaluation uses the same 25 improved movie questions for both systems:

- Baseline: vector-only RAG with Pinecone contexts.
- Hybrid: vector DB retrieval plus Neo4j GraphRAG facts.
- Judge: RAGAS.
- Completed metric mode: faithfulness only.
- Hallucination rate formula: `1 - faithfulness`.

The question set contains 10 multi-hop questions, 5 simple-fact questions, 5 relationship questions, and 5 recommendation questions. The questions were made deliberately tricky for pure vector search, especially list-style prompts such as "recommend all Christopher Nolan movies that include Zendaya" and constrained recommendation prompts.

## Overall Result

| Metric | Vector-only RAG | Vector DB + GraphRAG |
| --- | ---: | ---: |
| RAGAS faithfulness | 61.00% | 79.74% |
| RAGAS hallucination rate | 39.00% | 20.26% |
| Relative hallucination reduction | - | 48.06% |

GraphRAG reduced the RAGAS hallucination rate from 39.00% to 20.26% on the same 25 questions.

## Category Breakdown

| Category | Count | Vector faithfulness | Vector hallucination | GraphRAG faithfulness | GraphRAG hallucination |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple fact | 5 | 20.00% | 80.00% | 100.00% | 0.00% |
| Relationship | 5 | 80.00% | 20.00% | 100.00% | 0.00% |
| Multi-hop | 10 | 57.50% | 42.50% | 63.33% | 36.67% |
| Recommendation | 5 | 90.00% | 10.00% | 72.05% | 27.95% |

The recommendation RAGAS score looks counterintuitive because faithfulness only checks whether claims are supported by context. Vector-only often refused or gave very short incomplete answers, which can look faithful to RAGAS even when the answer is not useful. For recommendation quality, the movie-ID coverage below is a better sanity check.

## Answer Coverage Check

This check counts expected movie IDs from the Neo4j-backed ground truth and whether each system's answer included them. It is not a RAGAS metric, but it helps show actual answer completeness.

| Category | Vector-only coverage | Vector DB + GraphRAG coverage |
| --- | ---: | ---: |
| Relationship | 16 / 32 = 50.00% | 32 / 32 = 100.00% |
| Multi-hop | 7 / 36 = 19.44% | 21 / 36 = 58.33% |
| Recommendation | 3 / 24 = 12.50% | 22 / 24 = 91.67% |
| Relationship + multi-hop + recommendation | 26 / 92 = 28.26% | 75 / 92 = 81.52% |

This is why GraphRAG is the stronger result even where the recommendation faithfulness score is lower: the hybrid system answered far more of the required constrained movie lists.

## Question Set

| ID | Type | Question |
| ---: | --- | --- |
| 1 | Simple fact | Who directed Movie 0227, and what year was it released? |
| 2 | Simple fact | Which awards did Movie 0006 win? |
| 3 | Simple fact | What genres and themes are listed for Movie 0243? |
| 4 | Simple fact | Which director and actors are listed for Movie 0250? |
| 5 | Simple fact | What genres does Movie 0040 belong to, and which Oscar did it win? |
| 6 | Relationship | Which Christopher Nolan movies include Zendaya as an actor? |
| 7 | Relationship | Which movies connect James Cameron and Leonardo DiCaprio? |
| 8 | Relationship | Which Denis Villeneuve movies include Zendaya? |
| 9 | Relationship | Which movies feature Natalie Portman and also won Oscar (Best Picture)? |
| 10 | Relationship | Which movies have both Robert De Niro and Tom Hardy in the cast? |
| 11 | Multi-hop | Among Christopher Nolan movies, which ones star Zendaya and explore either Dreams or Technology? |
| 12 | Multi-hop | Which James Cameron movies are in either the Crime or Fantasy genre and also won at least one Oscar? |
| 13 | Multi-hop | Which Denis Villeneuve movies include Zendaya and are either Psychological Thriller or Mystery? |
| 14 | Multi-hop | Which Steven Spielberg movies include Leonardo DiCaprio and won an Oscar? |
| 15 | Multi-hop | Which Christopher Nolan movies were released after 2010, include either Florence Pugh or Zendaya, and are Action or Adventure? |
| 16 | Multi-hop | Which Ridley Scott movies include Zendaya and belong to Psychological Thriller, Crime, Fantasy, or Adventure? |
| 17 | Multi-hop | Which movies include Natalie Portman, won Oscar (Best Picture), and are Romance or Fantasy? |
| 18 | Multi-hop | Which Martin Scorsese movies star Matthew McConaughey and explore either Survival or Identity? |
| 19 | Multi-hop | Which Bong Joon-ho movies are Horror or Sci-Fi and won Oscar (Best Visual Effects) or Oscar (Best Sound Mixing)? |
| 20 | Multi-hop | Which Denis Villeneuve movies are Mystery or Thriller, explore Time or Reality, and won at least one Oscar? |
| 21 | Recommendation | Recommend all Christopher Nolan movies that include Zendaya, and do not include Nolan movies without Zendaya. |
| 22 | Recommendation | I liked Movie 0001. Recommend five non-James-Cameron movies that share at least two themes with it. |
| 23 | Recommendation | Recommend five movies similar to Movie 0227, but keep only Action or Adventure movies that share Technology or Dreams. |
| 24 | Recommendation | Recommend Oscar-winning movies similar to Movie 0006 using shared Fantasy, Technology, or Survival signals. |
| 25 | Recommendation | Recommend movies similar to Movie 0243 that include Zendaya and share at least two of Technology, Power, Time, and Freedom. |

## Key Examples

| Question | Vector-only behavior | Vector DB + GraphRAG behavior |
| --- | --- | --- |
| Q21: all Christopher Nolan movies with Zendaya | Returned 2 of 4 expected movies. | Returned all 4 expected movies. |
| Q22: five non-James-Cameron movies sharing at least two themes with Movie 0001 | Returned 0 of 5 expected movies and included unrelated extras. | Returned all 5 expected movies. |
| Q23: similar to Movie 0227 with Action or Adventure plus Technology or Dreams | Returned 1 of 5 expected movies. | Returned 4 of 5 expected movies. |
| Q24: Oscar-winning movies similar to Movie 0006 | Returned 0 of 5 expected movies. | Returned all 5 expected movies. |
| Q25: similar to Movie 0243, must include Zendaya and share at least two listed themes | Returned 0 of 5 expected movies. | Returned 4 of 5 expected movies. |

## Generated Files

- `evaluation/outputs/eval_questions.json`
- `evaluation/outputs/vector_results.json`
- `evaluation/outputs/graphrag_results.json`
- `evaluation/outputs/vector_ragas_scores.json`
- `evaluation/outputs/graphrag_ragas_scores.json`
- `evaluation/outputs/ragas_summary.json`

## Caveat

RAGAS faithfulness measures support from retrieved context, not whether the answer contains every required item. A system can score well on faithfulness by refusing to answer or giving a very short answer. For this project, the best interpretation is to use RAGAS hallucination rate for unsupported claims and the movie-ID coverage check for completeness on graph/list/recommendation questions.
