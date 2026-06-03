import { ParsedPost, ParsedProfile, ParsedData, PlatformParser } from './index';

export class LinkedInParser implements PlatformParser {
  name = 'LinkedIn';
  platform: 'linkedin' = 'linkedin';

  detect(files: Record<string, string>): boolean {
    const keys = Object.keys(files).map(k => k.toLowerCase());
    // Check if we have LinkedIn export files
    return (
      keys.some(k => k.includes('shares.csv') || k.includes('posts.csv')) ||
      keys.some(k => k.includes('profile.csv'))
    );
  }

  parse(files: Record<string, string>): ParsedData {
    let profile: ParsedProfile | undefined;
    const posts: ParsedPost[] = [];

    // Find profile file
    const profileFileKey = Object.keys(files).find(k => k.toLowerCase().includes('profile.csv'));
    if (profileFileKey) {
      const csvData = this.parseCSV(files[profileFileKey]);
      if (csvData.length > 1) {
        const headers = csvData[0].map(h => h.toLowerCase());
        const row = csvData[1];
        
        const firstName = this.getColValue(headers, row, ['first name', 'firstname']) || '';
        const lastName = this.getColValue(headers, row, ['last name', 'lastname']) || '';
        const headline = this.getColValue(headers, row, ['headline']) || '';
        const summary = this.getColValue(headers, row, ['summary']) || '';

        profile = {
          name: `${firstName} ${lastName}`.trim() || 'LinkedIn User',
          username: `${firstName.toLowerCase()}${lastName.toLowerCase()}` || 'linkedin_user',
          bio: headline ? `${headline}. ${summary}` : summary,
        };
      }
    }

    // Find shares/posts file
    const sharesFileKey = Object.keys(files).find(
      k => k.toLowerCase().includes('shares.csv') || k.toLowerCase().includes('posts.csv')
    );

    if (sharesFileKey) {
      const csvData = this.parseCSV(files[sharesFileKey]);
      if (csvData.length > 1) {
        const headers = csvData[0].map(h => h.toLowerCase());
        
        // Find column indices
        const dateIdx = this.findColIndex(headers, ['date', 'activity date', 'timestamp']);
        const contentIdx = this.findColIndex(headers, ['description', 'share description', 'content', 'post content']);
        const urlIdx = this.findColIndex(headers, ['link', 'share link', 'url']);
        const mediaIdx = this.findColIndex(headers, ['media url', 'media', 'image url']);

        for (let i = 1; i < csvData.length; i++) {
          const row = csvData[i];
          if (row.length === 0) continue;

          const content = contentIdx !== -1 ? row[contentIdx] : '';
          const dateStr = dateIdx !== -1 ? row[dateIdx] : new Date().toISOString();
          const url = urlIdx !== -1 ? row[urlIdx] : undefined;
          const mediaUrl = mediaIdx !== -1 && row[mediaIdx] ? [row[mediaIdx]] : undefined;

          // Filter out noise or empty posts
          if (!content || content.trim() === '') continue;

          // Convert date to standard ISO
          let timestamp = new Date().toISOString();
          try {
            if (dateStr) {
              const d = new Date(dateStr);
              if (!isNaN(d.getTime())) {
                timestamp = d.toISOString();
              }
            }
          } catch (e) {
            // Fallback to now
          }

          posts.push({
            id: `li-${sharesFileKey}-${i}`,
            platform: 'linkedin',
            content: content.trim(),
            timestamp,
            url,
            media: mediaUrl,
          });
        }
      }
    }

    return {
      platform: 'linkedin',
      profile,
      posts,
    };
  }

  private parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(cell.trim());
        cell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (cell || row.length > 0) {
      row.push(cell.trim());
      rows.push(row);
    }
    return rows.filter(r => r.length > 0 && r.some(c => c !== ''));
  }

  private findColIndex(headers: string[], alternates: string[]): number {
    return headers.findIndex(h => alternates.includes(h.toLowerCase()));
  }

  private getColValue(headers: string[], row: string[], alternates: string[]): string | undefined {
    const idx = this.findColIndex(headers, alternates);
    if (idx !== -1 && idx < row.length) {
      return row[idx];
    }
    return undefined;
  }
}
