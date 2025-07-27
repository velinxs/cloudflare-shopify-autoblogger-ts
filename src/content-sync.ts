import { z } from 'zod';

// Zod schema for parsing the <item> elements from the RSS feed
const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string().url(),
  description: z.string(), // This will contain the content
  pubDate: z.string(),
  h1: z.string().optional(), // The extracted H1 tag
});

type RssItem = z.infer<typeof itemSchema>;

/**
 * Fetches and parses the RSS feed, returning a list of blog post items.
 * @param url The URL of the RSS feed.
 * @returns A promise that resolves to an array of RssItem objects.
 */
async function parseRssFeed(url: string): Promise<RssItem[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch RSS feed: ${url} - Status: ${response.status}`);
      return [];
    }
    const xmlText = await response.text();
    
    const itemBlocks = xmlText.match(/<item>([\s\S]*?)<\/item>/g);
    if (!itemBlocks) return [];

    const items: RssItem[] = itemBlocks.map(block => {
      const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = block.match(/<link>([^<]+)<\/link>/);
      const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/);
      const pubDateMatch = block.match(/<pubDate>([^<]+)<\/pubDate>/);
      
      let title = titleMatch ? titleMatch[1].replace('<![CDATA[', '').replace(']]>', '') : 'Untitled';
      let description = descriptionMatch ? descriptionMatch[1].replace('<![CDATA[', '').replace(']]>', '') : '';

      // Extract H1 from the description (which contains the HTML content)
      const h1Match = description.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const h1 = h1Match ? h1Match[1].trim() : title; // Fallback to title if H1 not found

      return {
        id: guidMatch ? guidMatch[1] : '',
        title: title,
        link: linkMatch ? linkMatch[1] : '',
        description: description,
        pubDate: pubDateMatch ? pubDateMatch[1] : new Date().toISOString(),
        h1: h1,
      };
    }).filter(item => item.id && item.link && item.description);

    return items;
  } catch (error) {
    console.error(`Error parsing RSS feed ${url}:`, error);
    return [];
  }
}

/**
 * The main function for the /sync-posts endpoint.
 */
export async function syncPosts(env: any): Promise<Response> {
  console.log('Starting content sync process from RSS feed...');
  const feedUrl = 'https://royalpheromones.com/a/rssfeed';
  const posts = await parseRssFeed(feedUrl);
  let upsertedCount = 0;

  if (posts.length === 0) {
    return new Response(JSON.stringify({ success: true, upsertedCount: 0, message: 'No posts found in feed.' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const chunkSize = 20;
  for (let i = 0; i < posts.length; i += chunkSize) {
    const chunk = posts.slice(i, i + chunkSize);
    
    const vectors: VectorizeVector[] = [];

    const embeddingResponses = await Promise.all(
        chunk.map(post => env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [post.description] }))
    );

    for (let j = 0; j < chunk.length; j++) {
        const post = chunk[j];
        const embedding = embeddingResponses[j].data[0];
        
        vectors.push({
          id: post.link,
          values: embedding,
          metadata: {
            url: post.link,
            title: post.title,
            primaryKeyword: post.h1, // Store the H1 as the primary keyword
            pubDate: post.pubDate,
          },
        });
    }

    if (vectors.length > 0) {
      await env.VECTORIZE_INDEX.upsert(vectors);
      upsertedCount += vectors.length;
    }
  }

  console.log(`Content sync completed. Upserted ${upsertedCount} articles from the RSS feed.`);
  return new Response(JSON.stringify({ success: true, upsertedCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
}