import fs from 'fs';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';

// Parse .env manually
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = value;
      }
    });
  }
} catch (e) {
  console.error('Failed to parse .env file:', e);
}

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX || 'social-knowledge-base';
  console.log('API Key:', apiKey ? apiKey.substring(0, 12) + '...' : 'undefined');
  console.log('Index Name:', indexName);

  if (!apiKey) {
    console.error('No PINECONE_API_KEY in environment.');
    return;
  }

  const pc = new Pinecone({ apiKey });
  const index = pc.index(indexName);

  try {
    console.log('Describing index stats...');
    const stats = await index.describeIndexStats();
    console.log('Stats:', stats);

    console.log('Testing direct array upsert...');
    await index.upsert({
      records: [
        {
          id: 'test-profile-linkedin',
          values: new Array(512).fill(0), // Set to 512 to match the index configuration we saw in stats!
          metadata: {
            isProfile: true,
            platform: 'linkedin',
            name: 'Jane Test',
            username: 'janetest',
            bio: 'Tester',
          }
        }
      ]
    });
    console.log('Direct array upsert succeeded! ✅');
  } catch (err) {
    console.error('Upsert failed with error: ❌', err);
  }
}

main();
