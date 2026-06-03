import crypto from 'crypto';
import { Pinecone } from '@pinecone-database/pinecone';

export interface VectorNode {
  id: string;
  postId: string;
  platform: 'linkedin' | 'twitter' | 'instagram';
  content: string;
  timestamp: string;
  url?: string;
  media?: string[];
  author: string;
  hash: string;
  embedding: number[];
}

export interface PlatformProfile {
  name: string;
  username: string;
  bio?: string;
  avatar?: string;
}

export class LocalVectorStore {
  private pc: Pinecone;
  private index: any;
  private indexName: string;
  private cachedDimension: number | null = null;

  constructor() {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error('PINECONE_API_KEY is not defined in environment variables. Please check your .env file.');
    }
    this.indexName = process.env.PINECONE_INDEX || 'social-knowledge-base';
    this.pc = new Pinecone({ apiKey });
    this.index = this.pc.index(this.indexName);
  }

  /**
   * Dynamically retrieves the index's dimension size to support whatever dimension (1536, 512, 384) 
   * the user's Pinecone index is configured with.
   */
  public async getDimension(): Promise<number> {
    if (this.cachedDimension !== null) {
      return this.cachedDimension;
    }
    try {
      const stats = await this.index.describeIndexStats();
      const dim = stats.dimension || 1536;
      this.cachedDimension = dim;
      return dim;
    } catch (e) {
      console.warn('Failed to query Pinecone index stats for dimension, using default 1536:', e);
      return 1536;
    }
  }

  /**
   * Computes SHA-256 hash of a string.
   */
  public static computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Smart-chunk a post into smaller semantic units.
   */
  public static chunkPost(content: string, maxChunkLen = 600, overlap = 100): string[] {
    const text = content.trim();
    if (text.length <= maxChunkLen) {
      return [text];
    }

    const chunks: string[] = [];
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
   * Batch checks which posts are new and filters out duplicates.
   * Leverages Pinecone's batch fetch to check existance of chunk IDs (e.g. hash-0) in 1 network call.
   */
  public async filterNewPosts(posts: any[]): Promise<any[]> {
    if (posts.length === 0) return [];
    
    const chunkIdsToCheck = posts.map(post => {
      const postHash = LocalVectorStore.computeHash(post.content + post.platform + post.timestamp);
      return `${postHash}-0`;
    });

    const existingHashes = new Set<string>();
    const batchSize = 1000;

    try {
      for (let i = 0; i < chunkIdsToCheck.length; i += batchSize) {
        const batch = chunkIdsToCheck.slice(i, i + batchSize);
        const fetchResult = await this.index.fetch(batch);
        
        if (fetchResult.records) {
          Object.keys(fetchResult.records).forEach(id => {
            const hash = id.split('-')[0];
            existingHashes.add(hash);
          });
        }
      }
    } catch (err) {
      console.warn('Pinecone fetch warning (index might be empty or uninitialized):', err);
    }

    return posts.filter(post => {
      const postHash = LocalVectorStore.computeHash(post.content + post.platform + post.timestamp);
      return !existingHashes.has(postHash);
    });
  }

  /**
   * Add a profile to Pinecone (stored as a special metadata document with a non-zero vector).
   */
  public async addProfile(platform: 'linkedin' | 'twitter' | 'instagram', profile: PlatformProfile): Promise<void> {
    try {
      const dim = await this.getDimension();
      const dummyVector = new Array(dim).fill(0);
      dummyVector[0] = 1.0; // Dense vectors must contain at least one non-zero value in Pinecone Serverless

      await this.index.upsert({
        records: [{
          id: `profile-${platform}`,
          values: dummyVector,
          metadata: {
            isProfile: true,
            platform,
            name: profile.name,
            username: profile.username,
            bio: profile.bio || '',
            avatar: profile.avatar || '',
          }
        }]
      });
    } catch (err) {
      console.error('Failed to add profile to Pinecone:', err);
      throw new Error(`Pinecone profile update failed: ${(err as Error).message}`);
    }
  }

  /**
   * Get all registered platform profiles.
   */
  public async getProfiles(): Promise<Record<string, PlatformProfile>> {
    const profiles: Record<string, PlatformProfile> = {};
    try {
      const fetchResult = await this.index.fetch(['profile-linkedin', 'profile-twitter', 'profile-instagram']);
      if (fetchResult.records) {
        Object.entries(fetchResult.records).forEach(([_, record]: [string, any]) => {
          const meta = record.metadata;
          if (meta && meta.isProfile) {
            profiles[meta.platform] = {
              name: meta.name,
              username: meta.username,
              bio: meta.bio,
              avatar: meta.avatar,
            };
          }
        });
      }
    } catch (err) {
      console.warn('Failed to retrieve profiles from Pinecone:', err);
    }
    return profiles;
  }

  /**
   * Upsert vector nodes into Pinecone.
   */
  public async upsertNodes(nodes: VectorNode[]): Promise<void> {
    const batchSize = 100;
    try {
      for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        const records = batch.map(node => ({
          id: node.id,
          values: node.embedding,
          metadata: {
            isProfile: false,
            postId: node.postId,
            platform: node.platform,
            content: node.content,
            timestamp: node.timestamp,
            url: node.url || '',
            media: node.media || [],
            author: node.author,
            hash: node.hash,
          }
        }));
        await this.index.upsert({ records });
      }
    } catch (err) {
      console.error('Failed to upsert nodes to Pinecone:', err);
      throw new Error(`Pinecone upsert failed: ${(err as Error).message}. Verify that the index exists and matches dimensions.`);
    }
  }

  /**
   * Search for similar nodes in Pinecone.
   */
  public async search(
    queryEmbedding: number[],
    limit = 5,
    filters?: {
      platform?: 'linkedin' | 'twitter' | 'instagram';
    }
  ): Promise<Array<{ node: Omit<VectorNode, 'embedding'>; similarity: number }>> {
    try {
      const queryFilter: any = { isProfile: { $ne: true } };
      if (filters?.platform) {
        queryFilter.platform = { $eq: filters.platform };
      }

      const queryResponse = await this.index.query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
        filter: queryFilter,
      });

      const matches = queryResponse.matches || [];
      return matches.map((match: any) => {
        const meta = match.metadata;
        return {
          node: {
            id: match.id,
            postId: meta.postId || '',
            platform: meta.platform,
            content: meta.content || '',
            timestamp: meta.timestamp || '',
            url: meta.url || undefined,
            media: meta.media || undefined,
            author: meta.author || '',
            hash: meta.hash || '',
          },
          similarity: match.score || 0,
        };
      });
    } catch (err) {
      console.error('Pinecone search error:', err);
      throw new Error(`Pinecone query failed: ${(err as Error).message}. Make sure your index name is correct and active.`);
    }
  }

  /**
   * Get database statistics.
   */
  public async stats(): Promise<{
    totalChunks: number;
    totalUniquePosts: number;
    platformStats: Record<string, { chunks: number; posts: number }>;
  }> {
    try {
      const stats = await this.index.describeIndexStats();
      const totalRecords = stats.totalRecordCount || 0;
      
      const totalChunks = Math.max(0, totalRecords - 3);

      return {
        totalChunks,
        totalUniquePosts: totalChunks,
        platformStats: {
          linkedin: { chunks: 0, posts: 0 },
          twitter: { chunks: 0, posts: 0 },
          instagram: { chunks: 0, posts: 0 },
        }
      };
    } catch (e) {
      return {
        totalChunks: 0,
        totalUniquePosts: 0,
        platformStats: {
          linkedin: { chunks: 0, posts: 0 },
          twitter: { chunks: 0, posts: 0 },
          instagram: { chunks: 0, posts: 0 },
        }
      };
    }
  }

  /**
   * Clear the entire Pinecone database.
   */
  public async clear(): Promise<void> {
    try {
      await this.index.deleteAll();
    } catch (err) {
      console.error('Failed to wipe Pinecone index:', err);
      throw new Error(`Pinecone wipe failed: ${(err as Error).message}`);
    }
  }
}
