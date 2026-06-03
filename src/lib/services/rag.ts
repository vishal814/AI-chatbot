import { OpenAI } from 'openai';
import { LocalVectorStore, VectorNode } from '../vectorStore';

export interface RAGResponse {
  answer: string;
  citations: Omit<VectorNode, 'embedding'>[];
}

export class RAGService {
  /**
   * Generates embeddings in batches for a set of text chunks.
   * Batching is crucial for speed and rate-limit safety when handling thousands of chunks.
   */
  public static async getEmbeddingsBatch(
    texts: string[],
    apiKey: string,
    batchSize = 100
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    const openai = new OpenAI({ apiKey });
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small', // 1536-dimensional, highly cost-effective and accurate
          input: batch,
        });

        // Ensure order matches the input
        const sortedData = [...response.data].sort((a, b) => a.index - b.index);
        sortedData.forEach(item => {
          embeddings.push(item.embedding);
        });
      } catch (err) {
        console.error(`Error fetching embeddings batch starting at index ${i}:`, err);
        throw new Error(`Embedding API call failed: ${(err as Error).message}`);
      }
    }

    return embeddings;
  }

  /**
   * Executes the RAG pipeline.
   * 1. Embeds the user query.
   * 2. Retrieves top similar documents.
   * 3. Sends grounded prompt to LLM.
   */
  public static async queryRAG(
    query: string,
    localStore: LocalVectorStore,
    apiKey: string,
    modelName = 'gpt-4o-mini',
    topK = 6
  ): Promise<RAGResponse> {
    const openai = new OpenAI({ apiKey });

    // Step 1: Embed query
    let queryEmbedding: number[];
    try {
      const embedResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: [query],
      });
      queryEmbedding = embedResp.data[0].embedding;
    } catch (err) {
      throw new Error(`Failed to embed query: ${(err as Error).message}`);
    }

    // Step 2: Retrieve relevant chunks
    const results = await localStore.search(queryEmbedding, topK);

    if (results.length === 0) {
      return {
        answer: "I couldn't find any relevant information in the ingested data. Please upload some exports first!",
        citations: [],
      };
    }

    // Step 3: Format context
    const contextStr = results
      .map((res, index) => {
        const { node } = res;
        return `[Source ${index + 1}]
Platform: ${node.platform}
Author: ${node.author}
Date: ${node.timestamp}
Content: ${node.content}
${node.url ? `Link: ${node.url}` : ''}`;
      })
      .join('\n\n---\n\n');

    // Step 4: Build prompts
    const systemPrompt = `You are a helpful AI assistant analyzing a person's social media content exports (LinkedIn, Twitter/X, Instagram).
Your goal is to answer the user's question about what this person thinks, believes, or has posted, strictly grounding your answer in the provided context sources.

Rules:
1. Ground your response STRICTLY in the provided context sources. Do not assume, hallucinate, or extrapolate beyond what is explicitly stated.
2. Cite your sources using bracketed numbers matching the source index (e.g., [1], [2], [1, 3]) inline at the end of the sentence or paragraph it supports.
3. If the context does not contain enough information to answer the query, state clearly that you do not have enough data in the ingestion exports to answer.
4. Keep the tone helpful, objective, and clear.`;

    const userMessage = `Context sources:\n${contextStr}\n\nQuestion: ${query}`;

    // Step 5: Query Chat Completion
    try {
      const completion = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1, // very low temperature for strict grounding
      });

      const answer = completion.choices[0].message.content || 'No response generated.';
      
      // Return the answer along with matching source nodes for client citations
      return {
        answer,
        citations: results.map(r => r.node),
      };
    } catch (err) {
      throw new Error(`Failed to query LLM: ${(err as Error).message}`);
    }
  }

  /**
   * Executes the streaming RAG pipeline.
   */
  public static async queryRAGStream(
    query: string,
    localStore: LocalVectorStore,
    apiKey: string,
    modelName = 'gpt-4o-mini',
    topK = 6
  ): Promise<{
    citations: Omit<VectorNode, 'embedding'>[];
    stream: AsyncIterable<any>;
  }> {
    const openai = new OpenAI({ apiKey });

    // Step 1: Embed query
    let queryEmbedding: number[];
    try {
      const embedResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: [query],
      });
      queryEmbedding = embedResp.data[0].embedding;
    } catch (err) {
      throw new Error(`Failed to embed query: ${(err as Error).message}`);
    }

    // Step 2: Retrieve relevant chunks
    const results = await localStore.search(queryEmbedding, topK);

    // Step 3: Format context
    const contextStr = results
      .map((res, index) => {
        const { node } = res;
        return `[Source ${index + 1}]
Platform: ${node.platform}
Author: ${node.author}
Date: ${node.timestamp}
Content: ${node.content}
${node.url ? `Link: ${node.url}` : ''}`;
      })
      .join('\n\n---\n\n');

    // Step 4: Build prompts
    const systemPrompt = `You are a helpful AI assistant analyzing a person's social media content exports (LinkedIn, Twitter/X, Instagram).
Your goal is to answer the user's question about what this person thinks, believes, or has posted, strictly grounding your answer in the provided context sources.

Rules:
1. Ground your response STRICTLY in the provided context sources. Do not assume, hallucinate, or extrapolate beyond what is explicitly stated.
2. Cite your sources using bracketed numbers matching the source index (e.g., [1], [2], [1, 3]) inline at the end of the sentence or paragraph it supports.
3. If the context does not contain enough information to answer the query, state clearly that you do not have enough data in the ingestion exports to answer.
4. Keep the tone helpful, objective, and clear.`;

    const userMessage = `Context sources:\n${contextStr}\n\nQuestion: ${query}`;

    // Step 5: Query Chat Completion Stream
    try {
      const stream = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        stream: true,
      });

      return {
        citations: results.map(r => r.node),
        stream,
      };
    } catch (err) {
      throw new Error(`Failed to query LLM Stream: ${(err as Error).message}`);
    }
  }
}
