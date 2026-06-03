# Social Knowledge Base & Persona RAG Chat

This system ingests data exports from LinkedIn, Twitter/X, and Instagram, processes them through a custom local vector knowledge base, and provides a premium dark-themed React chat interface to query the persona's thoughts using Retrieval-Augmented Generation (RAG).

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- NPM

### Installation & Run
1. Navigate to the project directory:
   ```bash
   cd "d:/AI chatbot"
   ```
2. Install dependencies (if not already done):
   ```bash
   npm install
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.
5. Enter your OpenAI API key in the **API Settings** panel in the bottom-left of the page.
6. Click **Ingest Data Export** to upload your CSV/JSON/JS files or a `.zip` export, then start querying!

---

## Architecture Write-up

### 1. What does your system do, and what are the two or three most important architecture decisions you made?
The system parses diverse social media exports (LinkedIn CSVs, Twitter JS/JSON files, Instagram JSON/HTML files), extracts self-authored content, indexes it in a vector store, and provides a RAG chatbot that answers questions while linking answers back to original posts. The three key architecture decisions are:
* **Custom, File-Backed In-Memory Vector Store**: Choosing a lightweight, pure-JS in-memory vector store that serializes to a local JSON file (`data/vector_db.json`) rather than spawning a heavy local Docker container (e.g. pgvector, Qdrant) or using external cloud SaaS. At the target scale (e.g., 10,000 chunks), a Cosine Similarity search over flat arrays in JS takes under 10ms with zero runtime dependencies.
* **Unified Registry Parser Pattern**: Using a platform-agnostic interface (`PlatformParser`) where adding a new platform export simply requires writing a class that exposes `detect()` and `parse()` methods and adding it to the parser list. This keeps ingestion modular and clean.
* **Aggressive Deduping & Batching**: Before embedding chunk texts, we check content hashes (SHA-256) of each post against our database's indexed post hashes. We skip already indexed posts, and then batch all new chunks in sizes of 100 before calling the OpenAI API. This optimizes speed, network payload, and API token cost.

### 2. Where is the bottleneck at 10x data volume? What breaks first?
At 10x data volume (e.g., 100,000+ chunks / 500MB+ exports), the bottlenecks will occur in **memory footprint** and **blocking file I/O**:
* **In-Memory Store Memory & I/O Limit**: Since the entire vector store is loaded in memory from a single JSON file and written back synchronously, parsing a huge dataset will cause high RAM usage, and writing a 500MB+ JSON file back to disk blockingly will freeze the Node.js event loop, causing API timeouts.
* **Browser Upload Timeout**: Uploading a single 500MB export zip directly via a standard HTTP POST request will exhaust memory buffers on the server side and cause browser upload timeouts.
* **Embeddings API Rate Limits**: Naive batching will hit OpenAI's tokens-per-minute (TPM) or requests-per-minute (RPM) limits when processing 100,000 chunks at once.

### 3. What did you consciously cut to stay in the 4 to 6 hour window, and what would you build next?
To deliver a high-quality product within the timeframe, I cut:
* **Local Embedding Models**: Instead of importing heavy local transformers (`ONNX` or `@xenova/transformers`) which would require downloading a 150MB+ model on first start and slow down the local CPU, I used OpenAI's cloud embeddings (`text-embedding-3-small`).
* **HNSW/Hierarchical Indexing**: I used linear flat scan (exact search) since it is simple and extremely fast for < 20,000 vectors.
* **What I would build next**: A chunk-streaming engine for uploads to handle ZIP files as file streams instead of buffering them in memory, and migrating the storage to an embedded database like SQLite with a SQLite-vec extension to handle queries on disk rather than keeping everything in memory.

### 4. If you had to make this architecture 10x better (not iterate on it, but rethink it), what would you change and why? (10x Rethink Plan)
To make this system truly production-scale (handling millions of records efficiently), I would implement the following 10x Rethink architecture:
1. **Move to a Stream-based, Worker-threaded Ingestion Pipeline**: Implement a queue-based ingestion model (e.g. BullMQ with Redis, or local SQLite-based queue). When a user uploads a large file, the server returns a task ID instantly. Worker threads stream-parse the ZIP (using `unzipper` or `yauzl` with stream parsing) and process chunks incrementally.
2. **Local Vector Search on Disk (SQLite-vec / DuckDB)**: Replace the JSON store with an embedded SQLite or DuckDB database. SQLite with `sqlite-vec` performs vector search on disk using indexed tables, keeping RAM usage near-zero regardless of database size, and allows transactional writes so concurrent operations don't corrupt the store.
3. **Semantic Chunking with Layout Awareness**: Instead of plain sentence-splitting, parse HTML and formatting layouts (headings, paragraphs, bullet lists) to respect context boundaries, and add parent-child chunk retrieval (retrieve small sentence chunks for accuracy, but feed their surrounding paragraph to the LLM for context).
4. **Offline Local Embeddings & Model Serving**: Integrate an embedded runtime like ONNX or llama.cpp to run embeddings locally. This makes the ingestion free, offline, and private, eliminating API keys and rate limits.
