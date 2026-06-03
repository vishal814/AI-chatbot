import { ParsedPost, ParsedProfile, ParsedData, PlatformParser } from './index';

export class InstagramParser implements PlatformParser {
  name = 'Instagram';
  platform: 'instagram' = 'instagram';

  detect(files: Record<string, string>): boolean {
    const keys = Object.keys(files).map(k => k.toLowerCase());
    return (
      keys.some(k => k.includes('posts_1.json') || k.includes('media.json') || k.includes('posts.html')) ||
      keys.some(k => k.includes('personal_information.json') || k.includes('personal_information.html'))
    );
  }

  parse(files: Record<string, string>): ParsedData {
    let profile: ParsedProfile | undefined;
    const posts: ParsedPost[] = [];

    // 1. Try to parse profile (JSON or HTML)
    const profileJsonRef = Object.keys(files).find(k => k.toLowerCase().includes('personal_information.json'));
    if (profileJsonRef) {
      try {
        const data = JSON.parse(files[profileJsonRef]);
        // Profile user details are usually under profile_user or nested in string_map_data
        const userArray = data.profile_user || data.profile_info || [];
        const userObj = Array.isArray(userArray) ? userArray[0] : userArray;
        
        if (userObj) {
          const map = userObj.string_map_data || {};
          const name = map.Name?.value || map['Full Name']?.value || '';
          const username = map.Username?.value || '';
          const bio = map.Biography?.value || '';
          
          profile = {
            name: name || username || 'Instagram User',
            username: username || 'instagram_user',
            bio,
          };
        }
      } catch (err) {
        console.warn('Failed to parse Instagram profile JSON:', err);
      }
    }

    // Fallback/alternative profile parse from HTML
    const profileHtmlRef = Object.keys(files).find(k => k.toLowerCase().includes('personal_information.html'));
    if (!profile && profileHtmlRef) {
      const html = files[profileHtmlRef];
      const usernameMatch = html.match(/Username<\/th><td>([^<]+)</i) || html.match(/Username:\s*([^<]+)/i);
      const nameMatch = html.match(/Name<\/th><td>([^<]+)</i) || html.match(/Full Name:\s*([^<]+)/i);
      const bioMatch = html.match(/Biography<\/th><td>([^<]+)</i) || html.match(/Bio:\s*([^<]+)/i);

      if (usernameMatch || nameMatch) {
        profile = {
          name: nameMatch?.[1]?.trim() || usernameMatch?.[1]?.trim() || 'Instagram User',
          username: usernameMatch?.[1]?.trim() || 'instagram_user',
          bio: bioMatch?.[1]?.trim() || '',
        };
      }
    }

    // 2. Parse Posts (JSON or HTML)
    // Find all JSON post files
    const jsonPostKeys = Object.keys(files).filter(
      k => k.toLowerCase().includes('posts_1.json') || k.toLowerCase().includes('media.json')
    );

    jsonPostKeys.forEach((key, fileIdx) => {
      try {
        const raw = JSON.parse(files[key]);
        const list = Array.isArray(raw) ? raw : (raw.media || []);
        
        list.forEach((item: any, idx: number) => {
          // Instagram stores post caption in "title" of the media object
          const content = item.title || item.caption || '';
          const timestampSec = item.creation_timestamp || item.taken_at || 0;
          
          if (!content.trim()) return;

          let timestamp = new Date().toISOString();
          if (timestampSec) {
            timestamp = new Date(timestampSec * 1000).toISOString();
          }

          const mediaUrls: string[] = [];
          if (item.media_metadata?.photo?.uri) {
            mediaUrls.push(item.media_metadata.photo.uri);
          } else if (item.uri) {
            mediaUrls.push(item.uri);
          }

          posts.push({
            id: `ig-json-${fileIdx}-${idx}`,
            platform: 'instagram',
            content: content.trim(),
            timestamp,
            media: mediaUrls.length > 0 ? mediaUrls : undefined,
          });
        });
      } catch (err) {
        console.error('Failed to parse Instagram posts JSON:', err);
      }
    });

    // Parse HTML post files if no JSON posts were parsed
    if (posts.length === 0) {
      const htmlPostKeys = Object.keys(files).filter(k => k.toLowerCase().includes('posts.html'));
      htmlPostKeys.forEach((key, fileIdx) => {
        try {
          const html = files[key];
          // Look for blocks that represent a post.
          // Typical structure: a container containing date/time and caption.
          // Let's use a regex to extract text and dates.
          const postBlockRegex = /<div class="[^"]*post[^"]*">([\s\S]*?)<\/div>/gi;
          let match;
          let idx = 0;

          // If no specific container matches, try to extract paragraphs or divs containing text
          while ((match = postBlockRegex.exec(html)) !== null) {
            const block = match[1];
            const dateMatch = block.match(/_item_date[^>]*>([^<]+)</i) || block.match(/([a-zA-Z]+ \d+, \d{4}, \d+:\d+ [APM]+)/i);
            const captionMatch = block.match(/_item_caption[^>]*>([\s\S]*?)<\/div>/i) || block.match(/<div class="[^"]*content[^"]*">([\s\S]*?)<\/div>/i) || block.match(/<p>([\s\S]*?)<\/p>/i);

            const content = this.stripHtmlTags(captionMatch?.[1] || block).trim();
            if (!content) continue;

            let timestamp = new Date().toISOString();
            if (dateMatch) {
              const d = new Date(dateMatch[1]);
              if (!isNaN(d.getTime())) {
                timestamp = d.toISOString();
              }
            }

            posts.push({
              id: `ig-html-${fileIdx}-${idx++}`,
              platform: 'instagram',
              content,
              timestamp,
            });
          }

          // Fallback if no structured blocks found: match paragraphs
          if (posts.length === 0) {
            const pRegex = /<p>([\s\S]*?)<\/p>/gi;
            let pMatch;
            while ((pMatch = pRegex.exec(html)) !== null) {
              const content = this.stripHtmlTags(pMatch[1]).trim();
              if (content && content.length > 5) {
                posts.push({
                  id: `ig-html-p-${fileIdx}-${idx++}`,
                  platform: 'instagram',
                  content,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
        } catch (err) {
          console.error('Failed to parse Instagram posts HTML:', err);
        }
      });
    }

    if (!profile) {
      profile = {
        name: 'Instagram User',
        username: 'instagram_user',
        bio: 'Self-authored posts and media descriptions.',
      };
    }

    return {
      platform: 'instagram',
      profile,
      posts,
    };
  }

  private stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
