# Hallucination Evaluation Report

## 1. Evaluation Overview

This evaluation compares two retrieval-augmented generation systems on the same **stratified 25-question benchmark**.

The benchmark was designed to test factual accuracy, relationship reasoning, multi-hop reasoning, and constrained recommendation ability.

### Systems Compared

| System                   | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **Vector-only RAG**      | Uses Pinecone vector retrieval contexts only.                                      |
| **Vector DB + GraphRAG** | Uses vector DB retrieval along with Neo4j GraphRAG facts for structured reasoning. |

### Evaluation Configuration

| Item                       | Value                                            |
| -------------------------- | ------------------------------------------------ |
| Evaluation judge           | RAGAS                                            |
| Completed metric mode      | Faithfulness only                                |
| Hallucination rate formula | `1 - faithfulness`                               |
| Total questions            | 25                                               |
| Dataset type               | Stratified benchmark                             |
| Domain                     | Movie knowledge graph and recommendation queries |

The same 25 questions were used for both systems to ensure a fair comparison.

---

## 2. Question Set Distribution

The benchmark contains four different query categories.

| Query Type     | Number of Questions | Purpose                                                 |
| -------------- | ------------------: | ------------------------------------------------------- |
| Simple fact    |                   5 | Tests direct factual retrieval.                         |
| Relationship   |                   5 | Tests entity-to-entity relationship retrieval.          |
| Multi-hop      |                  10 | Tests reasoning across multiple connected facts.        |
| Recommendation |                   5 | Tests constrained recommendation and list completeness. |
| **Total**      |              **25** | Full evaluation benchmark.                              |

The questions were deliberately designed to be challenging for pure vector search, especially list-style and constraint-heavy prompts such as:

> Recommend all Christopher Nolan movies that include Zendaya, and do not include Nolan movies without Zendaya.

These prompts require exact filtering, relationship traversal, and completeness, which are difficult for vector-only retrieval.

---

## 3. Overall RAGAS Result

| Metric                           | Vector-only RAG | Vector DB + GraphRAG |
| -------------------------------- | --------------: | -------------------: |
| RAGAS faithfulness               |      **61.00%** |           **79.74%** |
| RAGAS hallucination rate         |      **39.00%** |           **20.26%** |
| Relative hallucination reduction |               — |           **48.06%** |

The GraphRAG-based hybrid system reduced the RAGAS hallucination rate from **39.00%** to **20.26%** on the same 25-question benchmark.

### Relative Hallucination Reduction

```text
Relative reduction = (39.00 - 20.26) / 39.00 × 100
                   = 48.06%
```

This shows that the hybrid GraphRAG system produced significantly fewer unsupported claims compared to the vector-only baseline.

---

## 4. Category-wise Faithfulness and Hallucination Breakdown

| Category       | Question Count | Vector Faithfulness | Vector Hallucination | GraphRAG Faithfulness | GraphRAG Hallucination |
| -------------- | -------------: | ------------------: | -------------------: | --------------------: | ---------------------: |
| Simple fact    |              5 |          **20.00%** |           **80.00%** |           **100.00%** |              **0.00%** |
| Relationship   |              5 |          **80.00%** |           **20.00%** |           **100.00%** |              **0.00%** |
| Multi-hop      |             10 |          **57.50%** |           **42.50%** |            **63.33%** |             **36.67%** |
| Recommendation |              5 |          **90.00%** |           **10.00%** |            **72.05%** |             **27.95%** |

The GraphRAG system achieved perfect faithfulness on simple fact and relationship questions. It also improved multi-hop hallucination performance compared to vector-only RAG.

The recommendation score appears counterintuitive because RAGAS faithfulness only checks whether generated claims are supported by retrieved context. A system can receive a high faithfulness score by refusing to answer or by giving a very short incomplete answer. Therefore, for recommendation questions, answer completeness should also be evaluated separately.

---

## 5. Answer Coverage Check

RAGAS faithfulness measures whether claims are supported by the retrieved context. However, it does not fully measure whether the system returned every required item.

To address this, an additional movie-ID coverage check was performed. This check compares the expected movie IDs from the Neo4j-backed ground truth against the movie IDs included in each system’s answer.

This is not a RAGAS metric, but it helps evaluate actual answer completeness.

| Query Category                                         | Vector-only Coverage | Vector DB + GraphRAG Coverage |         Absolute Improvement |
| ------------------------------------------------------ | -------------------: | ----------------------------: | ---------------------------: |
| Relationship queries                                   | 16 / 32 = **50.00%** |         32 / 32 = **100.00%** | **+50.00 percentage points** |
| Multi-hop queries                                      |  7 / 36 = **19.44%** |          21 / 36 = **58.33%** | **+38.89 percentage points** |
| Recommendation queries                                 |  3 / 24 = **12.50%** |          22 / 24 = **91.67%** | **+79.17 percentage points** |
| **Overall: relationship + multi-hop + recommendation** | 26 / 92 = **28.26%** |          75 / 92 = **81.52%** | **+53.26 percentage points** |

The coverage results show that the Vector DB + GraphRAG system retrieved and returned far more of the required answers than the vector-only baseline.

Overall coverage improved from **28.26%** to **81.52%**, showing that graph-based retrieval is much stronger for relationship, multi-hop, and constrained recommendation queries.

---

## 6. Interpretation of Results

The hybrid GraphRAG system is stronger than the vector-only baseline for two main reasons:

1. **Lower hallucination rate**
   The RAGAS hallucination rate decreased from **39.00%** to **20.26%**.

2. **Higher answer completeness**
   Movie-ID coverage improved from **28.26%** to **81.52%** across relationship, multi-hop, and recommendation queries.

This means the GraphRAG system was not only more faithful, but also more complete for structured queries that required exact filtering and graph traversal.

The recommendation category clearly demonstrates this difference. Even though vector-only RAG scored higher in recommendation faithfulness, it often returned very short or incomplete answers. In contrast, GraphRAG returned far more of the expected movie IDs.

Therefore, the best interpretation is:

| Metric Type             | What it Measures                                    | Best Use                     |
| ----------------------- | --------------------------------------------------- | ---------------------------- |
| RAGAS faithfulness      | Whether generated claims are supported by context   | Hallucination detection      |
| Movie-ID coverage       | Whether all required expected answers were returned | Completeness checking        |
| Combined interpretation | Faithfulness + completeness                         | Best overall evaluation view |

---

## 7. Complete Question Set

| ID | Type           | Question                                                                                                                       |
| -: | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
|  1 | Simple fact    | Who directed Movie 0227, and what year was it released?                                                                        |
|  2 | Simple fact    | Which awards did Movie 0006 win?                                                                                               |
|  3 | Simple fact    | What genres and themes are listed for Movie 0243?                                                                              |
|  4 | Simple fact    | Which director and actors are listed for Movie 0250?                                                                           |
|  5 | Simple fact    | What genres does Movie 0040 belong to, and which Oscar did it win?                                                             |
|  6 | Relationship   | Which Christopher Nolan movies include Zendaya as an actor?                                                                    |
|  7 | Relationship   | Which movies connect James Cameron and Leonardo DiCaprio?                                                                      |
|  8 | Relationship   | Which Denis Villeneuve movies include Zendaya?                                                                                 |
|  9 | Relationship   | Which movies feature Natalie Portman and also won Oscar (Best Picture)?                                                        |
| 10 | Relationship   | Which movies have both Robert De Niro and Tom Hardy in the cast?                                                               |
| 11 | Multi-hop      | Among Christopher Nolan movies, which ones star Zendaya and explore either Dreams or Technology?                               |
| 12 | Multi-hop      | Which James Cameron movies are in either the Crime or Fantasy genre and also won at least one Oscar?                           |
| 13 | Multi-hop      | Which Denis Villeneuve movies include Zendaya and are either Psychological Thriller or Mystery?                                |
| 14 | Multi-hop      | Which Steven Spielberg movies include Leonardo DiCaprio and won an Oscar?                                                      |
| 15 | Multi-hop      | Which Christopher Nolan movies were released after 2010, include either Florence Pugh or Zendaya, and are Action or Adventure? |
| 16 | Multi-hop      | Which Ridley Scott movies include Zendaya and belong to Psychological Thriller, Crime, Fantasy, or Adventure?                  |
| 17 | Multi-hop      | Which movies include Natalie Portman, won Oscar (Best Picture), and are Romance or Fantasy?                                    |
| 18 | Multi-hop      | Which Martin Scorsese movies star Matthew McConaughey and explore either Survival or Identity?                                 |
| 19 | Multi-hop      | Which Bong Joon-ho movies are Horror or Sci-Fi and won Oscar (Best Visual Effects) or Oscar (Best Sound Mixing)?               |
| 20 | Multi-hop      | Which Denis Villeneuve movies are Mystery or Thriller, explore Time or Reality, and won at least one Oscar?                    |
| 21 | Recommendation | Recommend all Christopher Nolan movies that include Zendaya, and do not include Nolan movies without Zendaya.                  |
| 22 | Recommendation | I liked Movie 0001. Recommend five non-James-Cameron movies that share at least two themes with it.                            |
| 23 | Recommendation | Recommend five movies similar to Movie 0227, but keep only Action or Adventure movies that share Technology or Dreams.         |
| 24 | Recommendation | Recommend Oscar-winning movies similar to Movie 0006 using shared Fantasy, Technology, or Survival signals.                    |
| 25 | Recommendation | Recommend movies similar to Movie 0243 that include Zendaya and share at least two of Technology, Power, Time, and Freedom.    |

---

## 8. Key Qualitative Examples

| Question                                                                              | Vector-only RAG Behavior                                       | Vector DB + GraphRAG Behavior    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| Q21: all Christopher Nolan movies with Zendaya                                        | Returned 2 of 4 expected movies.                               | Returned all 4 expected movies.  |
| Q22: five non-James-Cameron movies sharing at least two themes with Movie 0001        | Returned 0 of 5 expected movies and included unrelated extras. | Returned all 5 expected movies.  |
| Q23: similar to Movie 0227 with Action or Adventure plus Technology or Dreams         | Returned 1 of 5 expected movies.                               | Returned 4 of 5 expected movies. |
| Q24: Oscar-winning movies similar to Movie 0006                                       | Returned 0 of 5 expected movies.                               | Returned all 5 expected movies.  |
| Q25: similar to Movie 0243, must include Zendaya and share at least two listed themes | Returned 0 of 5 expected movies.                               | Returned 4 of 5 expected movies. |

These examples show that vector-only retrieval struggled with exact constraints and list completeness, while GraphRAG performed better because it could use structured graph facts from Neo4j.

---

## 9. Generated Evaluation Files

| File                                            | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `evaluation/outputs/eval_questions.json`        | Stores the 25 evaluation questions.       |
| `evaluation/outputs/vector_results.json`        | Stores vector-only RAG answers.           |
| `evaluation/outputs/graphrag_results.json`      | Stores Vector DB + GraphRAG answers.      |
| `evaluation/outputs/vector_ragas_scores.json`   | Stores RAGAS scores for vector-only RAG.  |
| `evaluation/outputs/graphrag_ragas_scores.json` | Stores RAGAS scores for GraphRAG.         |
| `evaluation/outputs/ragas_summary.json`         | Stores the summarized evaluation results. |

---

## 10. Caveat

RAGAS faithfulness measures whether the generated answer is supported by the retrieved context. It does not guarantee that the answer contains every expected item.

Because of this, a system can sometimes receive a good faithfulness score by giving a short, incomplete, or refusal-style answer.

For this project, the best evaluation interpretation is:

| Evaluation Component     | Meaning                                |
| ------------------------ | -------------------------------------- |
| RAGAS hallucination rate | Measures unsupported claims.           |
| Movie-ID coverage check  | Measures answer completeness.          |
| Combined result          | Shows both correctness and usefulness. |

Therefore, the Vector DB + GraphRAG system is the stronger result because it reduced hallucination and significantly improved answer coverage.

---

## 11. Final Conclusion

The evaluation shows that adding Neo4j GraphRAG facts to vector retrieval significantly improves the reliability and completeness of the system.

The hybrid approach reduced hallucination rate from **39.00%** to **20.26%**, achieving a **48.06% relative hallucination reduction**. It also improved answer coverage from **28.26%** to **81.52%** across relationship, multi-hop, and recommendation queries.

This demonstrates that combining vector retrieval with graph-based reasoning is more effective than vector-only RAG for structured, constraint-heavy, and multi-hop question answering.
