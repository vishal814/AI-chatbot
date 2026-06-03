import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface VectorNode {
  id: string;
  postId: string;
  platform: 'linkedin' | 'twitter' | 'instagram';
  content: string;
  timestamp: string;
  url?: string;
  media?: string[];
  author: string;
  hash: string; // Hash of original content to prevent duplicate indexing
  embedding: number[];
}

export interface PlatformProfile {
  name: string;
  username: string;
  bio?: string;
  avatar?: string;
}

export interface VectorStoreData {
  nodes: VectorNode[];
  processedHashes: string[]; // For O(1) deduplication checking
  profiles: Record<string, PlatformProfile>;
}

export class LocalVectorStore {
  private filePath: string;
  private data: VectorStoreData;

  constructor() {
    // Save database file in the workspace directory under "data/vector_db.json"
    this.filePath = path.join(process.cwd(), 'data', 'vector_db.json');
    this.data = this.load();
  }

  /**
   * Load the vector store database from disk.
   */
  private load(): VectorStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(fileContent);
      }
    } catch (err) {
      console.error('Failed to load local vector store. Initializing new one.', err);
    }
    return {
      nodes: [],
      processedHashes: [],
      profiles: {},
    };
  }

  /**
   * Persist the database to disk.
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save vector store database to disk:', err);
      throw new Error(`Disk write failed: ${(err as Error).message}`);
    }
  }

  /**
   * Computes SHA-256 hash of a string.
   */
  public static computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Checks if content is already indexed.
   */
  public hasContent(hash: string): boolean {
    return this.data.processedHashes.includes(hash);
  }

  /**
   * Smart-chunk a post into smaller semantic units.
   * If the post is short, keep it as a single chunk.
   * If the post is long, split it by paragraphs and sentences with sliding window overlaps.
   */
  public static chunkPost(content: string, maxChunkLen = 600, overlap = 100): string[] {
    const text = content.trim();
    if (text.length <= maxChunkLen) {
      return [text];
    }

    const chunks: string[] = [];
    // Split by paragraph first
    const paragraphs = text.split(/\n\s*\n/);
    
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxChunkLen) {
        if (currentChunk.length + paragraph.length + 2 <= maxChunkLen) {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = paragraph;
        }
      } else {
        // If a single paragraph is too long, split it by sentences
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let tempChunk = '';
        for (const sentence of sentences) {
          if (tempChunk.length + sentence.length + 1 <= maxChunkLen) {
            tempChunk += (tempChunk ? ' ' : '') + sentence;
          } else {
            if (tempChunk) chunks.push(tempChunk);
            // Overlap: take a portion of the previous chunk if possible
            const overlapPart = tempChunk.slice(-overlap);
            const spaceIdx = overlapPart.indexOf(' ');
            const overlappingPrefix = spaceIdx !== -1 ? overlapPart.slice(spaceIdx + 1) : '';
            tempChunk = (overlappingPrefix ? overlappingPrefix + ' ' : '') + sentence;
          }
        }
        if (tempChunk) {
          currentChunk = tempChunk;
        }
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  /**
   * Add a profile to the vector database.
   */
  public addProfile(platform: 'linkedin' | 'twitter' | 'instagram', profile: PlatformProfile): void {
    this.data.profiles[platform] = profile;
    this.save();
  }

  /**
   * Get all registered platform profiles.
   */
  public getProfiles(): Record<string, PlatformProfile> {
    return this.data.profiles;
  }

  /**
   * Upsert vector nodes into the database.
   */
  public upsertNodes(nodes: VectorNode[]): void {
    nodes.forEach(node => {
      // Avoid duplicate chunk IDs
      const existingIdx = this.data.nodes.findIndex(n => n.id === node.id);
      if (existingIdx !== -1) {
        this.data.nodes[existingIdx] = node;
      } else {
        this.data.nodes.push(node);
      }

      // Add to processed hashes
      if (!this.data.processedHashes.includes(node.hash)) {
        this.data.processedHashes.push(node.hash);
      }
    });

    this.save();
  }

  /**
   * Search for similar nodes using cosine similarity.
   */
  public search(
    queryEmbedding: number[],
    limit = 5,
    filters?: {
      platform?: 'linkedin' | 'twitter' | 'instagram';
      dateRange?: { start?: string; end?: string };
    }
  ): Array<{ node: Omit<VectorNode, 'embedding'>; similarity: number }> {
    let candidates = this.data.nodes;

    // Apply metadata filters
    if (filters) {
      if (filters.platform) {
        candidates = candidates.filter(n => n.platform === filters.platform);
      }
      if (filters.dateRange) {
        const { start, end } = filters.dateRange;
        if (start) {
          const startTime = new Date(start).getTime();
          candidates = candidates.filter(n => new Date(n.timestamp).getTime() >= startTime);
        }
        if (end) {
          const endTime = new Date(end).getTime();
          candidates = candidates.filter(n => new Date(n.timestamp).getTime() <= endTime);
        }
      }
    }

    // Compute similarity scores
    const scored = candidates.map(node => {
      const similarity = LocalVectorStore.cosineSimilarity(queryEmbedding, node.embedding);
      // Remove embedding from search results to save payload transfer size
      const { embedding, ...nodeWithoutEmbedding } = node;
      return {
        node: nodeWithoutEmbedding,
        similarity,
      };
    });

    // Sort descending and return top K
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Computes the cosine similarity of two vectors.
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get database statistics.
   */
  public stats(): {
    totalChunks: number;
    totalUniquePosts: number;
    platformStats: Record<string, { chunks: number; posts: number }>;
  } {
    const stats: Record<string, { chunks: number; posts: Set<string> }> = {
      linkedin: { chunks: 0, posts: new Set() },
      twitter: { chunks: 0, posts: new Set() },
      instagram: { chunks: 0, posts: new Set() },
    };

    this.data.nodes.forEach(n => {
      if (stats[n.platform]) {
        stats[n.platform].chunks++;
        stats[n.platform].posts.add(n.postId);
      }
    });

    return {
      totalChunks: this.data.nodes.length,
      totalUniquePosts: this.data.processedHashes.length,
      platformStats: {
        linkedin: { chunks: stats.linkedin.chunks, posts: stats.linkedin.posts.size },
        twitter: { chunks: stats.twitter.chunks, posts: stats.twitter.posts.size },
        instagram: { chunks: stats.instagram.chunks, posts: stats.instagram.posts.size },
      },
    };
  }

  /**
   * Clear the entire database.
   */
  public clear(): void {
    this.data = {
      nodes: [],
      processedHashes: [],
      profiles: {},
    };
    this.save();
  }
}
