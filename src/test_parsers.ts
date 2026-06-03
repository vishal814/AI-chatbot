import { LinkedInParser } from './lib/parsers/linkedin';
import { TwitterParser } from './lib/parsers/twitter';
import { InstagramParser } from './lib/parsers/instagram';

async function testLinkedIn() {
  console.log('--- Testing LinkedIn Parser ---');
  const parser = new LinkedInParser();
  
  const files = {
    'Profile.csv': `"First Name","Last Name","Headline","Summary"\n"Jane","Doe","AI Researcher","Passionate about LLMs"`,
    'Shares.csv': `"Activity Date","Share Link","Share Description"\n"2026-05-15 10:00:00","https://linkedin.com/posts/1","Had an amazing discussion on remote work today!"\n"2026-05-16 11:00:00","https://linkedin.com/posts/2",""`
  };

  const detected = parser.detect(files);
  console.log('Detection:', detected ? 'PASSED' : 'FAILED');

  const result = parser.parse(files);
  console.log('Profile parsed:', result.profile);
  console.log('Posts count:', result.posts.length);
  if (result.posts.length > 0) {
    console.log('First post:', result.posts[0]);
  }
  
  const success = 
    detected && 
    result.profile?.name === 'Jane Doe' && 
    result.profile?.bio === 'AI Researcher. Passionate about LLMs' && 
    result.posts.length === 1 && 
    result.posts[0].content === 'Had an amazing discussion on remote work today!';
    
  console.log('Overall LinkedIn Parse:', success ? 'SUCCESS ✅' : 'FAILED ❌');
}

async function testTwitter() {
  console.log('\n--- Testing Twitter Parser ---');
  const parser = new TwitterParser();

  const files = {
    'profile.js': `window.YTD.profile.part0 = [
      {
        "profile" : {
          "displayName" : "Alex Smith",
          "screenName" : "alex_tech",
          "description" : {
            "bio" : "Builder and Developer."
          }
        }
      }
    ]`,
    'tweets.js': `window.YTD.tweets.part0 = [
      {
        "tweet" : {
          "id_str" : "11223344",
          "created_at" : "Wed May 20 14:00:00 +0000 2026",
          "full_text" : "This is my thoughts on microservices vs monoliths.",
          "favorite_count" : "42",
          "retweet_count" : "7"
        }
      },
      {
        "tweet" : {
          "id_str" : "11223345",
          "created_at" : "Thu May 21 15:00:00 +0000 2026",
          "full_text" : "RT @someone: Re-tweeting this noise."
        }
      }
    ]`
  };

  const detected = parser.detect(files);
  console.log('Detection:', detected ? 'PASSED' : 'FAILED');

  const result = parser.parse(files);
  console.log('Profile parsed:', result.profile);
  console.log('Posts count (should filter retweets):', result.posts.length);
  if (result.posts.length > 0) {
    console.log('First tweet:', result.posts[0]);
  }

  const success =
    detected &&
    result.profile?.name === 'Alex Smith' &&
    result.profile?.username === 'alex_tech' &&
    result.posts.length === 1 &&
    result.posts[0].id === '11223344' &&
    result.posts[0].content.includes('microservices') &&
    result.posts[0].engagement?.likes === 42;

  console.log('Overall Twitter Parse:', success ? 'SUCCESS ✅' : 'FAILED ❌');
}

async function testInstagram() {
  console.log('\n--- Testing Instagram Parser ---');
  const parser = new InstagramParser();

  const files = {
    'personal_information.json': `{
      "profile_user": [
        {
          "string_map_data": {
            "Username": { "value": "insta_chef" },
            "Name": { "value": "Chef G" },
            "Biography": { "value": "Cooking modern dishes" }
          }
        }
      ]
    }`,
    'posts_1.json': `[
      {
        "title": "Searing the perfect ribeye steak tonight! #cooking",
        "creation_timestamp": 1779344400,
        "media_metadata": {
          "photo": {
            "uri": "photos/ribeye.jpg"
          }
        }
      }
    ]`
  };

  const detected = parser.detect(files);
  console.log('Detection:', detected ? 'PASSED' : 'FAILED');

  const result = parser.parse(files);
  console.log('Profile parsed:', result.profile);
  console.log('Posts count:', result.posts.length);
  if (result.posts.length > 0) {
    console.log('First post:', result.posts[0]);
  }

  const success =
    detected &&
    result.profile?.name === 'Chef G' &&
    result.profile?.username === 'insta_chef' &&
    result.posts.length === 1 &&
    result.posts[0].content.includes('perfect ribeye') &&
    result.posts[0].media?.[0] === 'photos/ribeye.jpg';

  console.log('Overall Instagram Parse:', success ? 'SUCCESS ✅' : 'FAILED ❌');
}

async function main() {
  try {
    await testLinkedIn();
    await testTwitter();
    await testInstagram();
  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

main();
