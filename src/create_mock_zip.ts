import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function createMockLinkedIn() {
  const zip = new JSZip();
  
  const profileCSV = `"First Name","Last Name","Headline","Summary"\n"Jane","Doe","Senior Software Architect","Leading engineering teams and building high-performance vector search engines. Passionate about AI, RAG pipelines, and hybrid work setups."`;
  
  const sharesCSV = `"Activity Date","Share Link","Share Description"\n"2026-05-01 09:30:00","https://www.linkedin.com/posts/jane-doe-1","Remote work is here to stay. In our team, flexible hours and location autonomy improved engineering output by 25%."\n"2026-05-10 14:15:00","https://www.linkedin.com/posts/jane-doe-2","Building a vector database from scratch is a fantastic engineering exercise. Cosine similarity calculations on normalized float arrays in Node is blazingly fast."`;
  
  zip.file('Profile.csv', profileCSV);
  zip.file('Shares.csv', sharesCSV);
  
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const outputPath = path.join(process.cwd(), 'mock_linkedin_export.zip');
  fs.writeFileSync(outputPath, content);
  console.log(`Created mock LinkedIn zip: ${outputPath}`);
}

async function createMockTwitter() {
  const zip = new JSZip();
  
  const profileJS = `window.YTD.profile.part0 = [
  {
    "profile" : {
      "displayName" : "Jane Doe Tech",
      "screenName" : "janedoe_tech",
      "description" : {
        "bio" : "Software Architect | Vector DBs & RAG | Cat lover 🐈"
      }
    }
  }
]`;

  const tweetsJS = `window.YTD.tweets.part0 = [
  {
    "tweet" : {
      "id_str" : "12345001",
      "created_at" : "Sun May 03 10:00:00 +0000 2026",
      "full_text" : "I really think remote work provides engineers with the uninterrupted focus time needed for deep work. Office open layouts are distraction zones.",
      "favorite_count" : "150",
      "retweet_count" : "25"
    }
  },
  {
    "tweet" : {
      "id_str" : "12345002",
      "created_at" : "Mon May 04 11:30:00 +0000 2026",
      "full_text" : "RT @random_dev: Monoliths are underrated! Retweeting this."
    }
  }
]`;

  zip.file('data/profile.js', profileJS);
  zip.file('data/tweets.js', tweetsJS);
  
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const outputPath = path.join(process.cwd(), 'mock_twitter_export.zip');
  fs.writeFileSync(outputPath, content);
  console.log(`Created mock Twitter zip: ${outputPath}`);
}

async function createMockInstagram() {
  const zip = new JSZip();
  
  const profileJSON = `{
  "profile_user": [
    {
      "string_map_data": {
        "Username": { "value": "jane_travels" },
        "Name": { "value": "Jane D." },
        "Biography": { "value": "Exploring coffee shops & coding remotely." }
      }
    }
  ]
}`;

  const postsJSON = `[
  {
    "title": "Working from a beachside cafe in Bali today! Remote work has enabled a lifestyle where productivity meets passion.",
    "creation_timestamp": 1777896000,
    "media_metadata": {
      "photo": {
        "uri": "photos/bali.jpg"
      }
    }
  }
]`;

  zip.file('personal_information/personal_information.json', profileJSON);
  zip.file('content/posts_1.json', postsJSON);
  
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const outputPath = path.join(process.cwd(), 'mock_instagram_export.zip');
  fs.writeFileSync(outputPath, content);
  console.log(`Created mock Instagram zip: ${outputPath}`);
}

async function main() {
  try {
    await createMockLinkedIn();
    await createMockTwitter();
    await createMockInstagram();
    console.log('\nAll mock exports created successfully!');
  } catch (err) {
    console.error('Error generating zips:', err);
  }
}

main();
