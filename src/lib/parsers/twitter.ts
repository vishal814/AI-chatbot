import { ParsedPost, ParsedProfile, ParsedData, PlatformParser } from './index';

export class TwitterParser implements PlatformParser {
  name = 'Twitter/X';
  platform: 'twitter' = 'twitter';

  detect(files: Record<string, string>): boolean {
    const keys = Object.keys(files).map(k => k.toLowerCase());
    return (
      keys.some(k => k.includes('tweets.js') || k.includes('tweets.json')) ||
      keys.some(k => k.includes('tweet.js') || k.includes('tweet.json'))
    );
  }

  parse(files: Record<string, string>): ParsedData {
    let profile: ParsedProfile | undefined;
    const posts: ParsedPost[] = [];

    // Parse profile
    const profileKey = Object.keys(files).find(
      k => k.toLowerCase().includes('profile.js') || k.toLowerCase().includes('profile.json')
    );

    if (profileKey) {
      try {
        const rawText = files[profileKey];
        const parsed = this.parseJSOrJSON(rawText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const profObj = parsed[0]?.profile || parsed[0];
          if (profObj) {
            profile = {
              name: profObj.displayName || 'Twitter User',
              username: profObj.screenName || 'twitter_user',
              bio: profObj.description?.bio || '',
              avatar: profObj.avatarMediaUrl || '',
            };
          }
        }
      } catch (err) {
        console.warn('Failed to parse Twitter profile:', err);
      }
    }

    // Parse tweets
    const tweetsKey = Object.keys(files).find(
      k =>
        k.toLowerCase().includes('tweets.js') ||
        k.toLowerCase().includes('tweets.json') ||
        k.toLowerCase().includes('tweet.js') ||
        k.toLowerCase().includes('tweet.json')
    );

    if (tweetsKey) {
      try {
        const rawText = files[tweetsKey];
        const parsed = this.parseJSOrJSON(rawText);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: any, idx: number) => {
            const tweet = item.tweet || item;
            if (!tweet) return;

            const text = tweet.full_text || tweet.text || '';
            const id = tweet.id_str || tweet.id || `tw-${idx}`;
            const createdAt = tweet.created_at || new Date().toISOString();

            // Discard noise: retweets (which begin with RT @)
            if (text.startsWith('RT @')) return;

            // Discard empty text
            if (!text.trim()) return;

            // Convert Twitter's date format (e.g. "Tue Dec 05 15:30:22 +0000 2017")
            let timestamp = new Date().toISOString();
            try {
              const d = new Date(createdAt);
              if (!isNaN(d.getTime())) {
                timestamp = d.toISOString();
              }
            } catch (e) {
              // use fallback now
            }

            const likes = parseInt(tweet.favorite_count || '0', 10);
            const reposts = parseInt(tweet.retweet_count || '0', 10);

            posts.push({
              id,
              platform: 'twitter',
              content: text,
              timestamp,
              url: `https://twitter.com/x/status/${id}`,
              engagement: {
                likes,
                reposts,
              },
            });
          });
        }
      } catch (err) {
        console.error('Failed to parse Twitter tweets:', err);
        throw err;
      }
    }

    // Fallback profile details if we couldn't parse profile but have tweets
    if (!profile && posts.length > 0) {
      profile = {
        name: 'Twitter User',
        username: 'twitter_user',
        bio: 'Self-authored tweets and replies.',
      };
    }

    return {
      platform: 'twitter',
      profile,
      posts,
    };
  }

  private parseJSOrJSON(text: string): any {
    const trimmed = text.trim();
    // Twitter JS archives start with "window.YTD.tweets.part0 = [" or similar
    if (trimmed.startsWith('window.')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const jsonStr = trimmed.slice(eqIdx + 1).trim();
        // Remove trailing semicolon if present
        const cleanJsonStr = jsonStr.endsWith(';') ? jsonStr.slice(0, -1) : jsonStr;
        return JSON.parse(cleanJsonStr);
      }
    }
    return JSON.parse(trimmed);
  }
}
