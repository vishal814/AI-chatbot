export interface ParsedPost {
  id: string;
  platform: 'linkedin' | 'twitter' | 'instagram';
  content: string;
  timestamp: string; // ISO Date String
  url?: string;
  media?: string[];
  engagement?: {
    likes?: number;
    reposts?: number;
    comments?: number;
  };
}

export interface ParsedProfile {
  name: string;
  username: string;
  bio?: string;
  avatar?: string;
}

export interface ParsedData {
  platform: 'linkedin' | 'twitter' | 'instagram';
  profile?: ParsedProfile;
  posts: ParsedPost[];
}

export interface PlatformParser {
  name: string;
  platform: 'linkedin' | 'twitter' | 'instagram';
  detect(files: Record<string, string>): boolean;
  parse(files: Record<string, string>): ParsedData;
}

import { LinkedInParser } from './linkedin';
import { TwitterParser } from './twitter';
import { InstagramParser } from './instagram';

export const PARSERS: PlatformParser[] = [
  new LinkedInParser(),
  new TwitterParser(),
  new InstagramParser(),
];

/**
 * Automatically detects the platform and parses the provided files.
 */
export function parseSocialExport(files: Record<string, string>): ParsedData {
  for (const parser of PARSERS) {
    if (parser.detect(files)) {
      try {
        return parser.parse(files);
      } catch (err) {
        throw new Error(`Failed to parse export for ${parser.name}: ${(err as Error).message}`);
      }
    }
  }
  throw new Error('Unsupported export format. Could not match any platform parsers.');
}
