import { z } from 'zod';
import { fetchAllSiteUrls } from './sitemap';

// Zod schema for parsing RSS feed items
const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string().url(),
  description: z.string(),
  pubDate: z.string(),
  h1: z.string().optional(),
});

// Schema for different content types
const contentItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  description: z.string(),
  pubDate: z.string(),
  primaryKeyword: z.string(),
  contentType: z.enum(['blog', 'product', 'collection']),
});

type RssItem = z.infer<typeof itemSchema>;
type ContentItem = z.infer<typeof contentItemSchema>;

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
 * Converts collection URLs to ContentItems
 */
async function processCollections(collections: Array<{loc: string, lastmod?: string}>): Promise<ContentItem[]> {
  return collections.map(collection => {
    const pathSegments = collection.loc.split('/');
    const collectionName = pathSegments[pathSegments.length - 1];
    const title = collectionName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    return {
      id: collection.loc,
      title: title,
      url: collection.loc,
      description: `Shop our ${title} collection`,
      pubDate: collection.lastmod || new Date().toISOString(),
      primaryKeyword: title,
      contentType: 'collection' as const,
    };
  });
}

/**
 * Converts RSS items to ContentItems
 */
function convertRssToContentItems(rssItems: RssItem[], contentType: 'blog' | 'product'): ContentItem[] {
  return rssItems.map(item => {
    const h1 = item.h1 || item.title;
    return {
      id: item.id,
      title: item.title,
      url: item.link,
      description: item.description,
      pubDate: item.pubDate,
      primaryKeyword: h1,
      contentType,
    };
  });
}

/**
 * The main function for the /sync-posts endpoint.
 */
export async function syncPosts(env: any): Promise<Response> {
  console.log('Starting comprehensive content sync process...');
  
  // Fetch content from multiple sources
  const [blogPosts, productPosts, sitemapData] = await Promise.all([
    parseRssFeed('https://royalpheromones.com/a/rssfeed?type=blog&key=articles'),
    parseRssFeed('https://royalpheromones.com/a/rssfeed'),
    fetchAllSiteUrls()
  ]);
  
  // Convert all content to unified format
  const blogItems = convertRssToContentItems(blogPosts, 'blog');
  const productItems = convertRssToContentItems(productPosts, 'product');
  const collectionItems = await processCollections(sitemapData.collections);
  
  const allContent = [...blogItems, ...productItems, ...collectionItems];
  let upsertedCount = 0;

  if (allContent.length === 0) {
    return new Response(JSON.stringify({ success: true, upsertedCount: 0, message: 'No content found to sync.' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  console.log(`Found ${blogItems.length} blogs, ${productItems.length} products, ${collectionItems.length} collections`);

  const chunkSize = 20;
  for (let i = 0; i < allContent.length; i += chunkSize) {
    const chunk = allContent.slice(i, i + chunkSize);
    
    const vectors: VectorizeVector[] = [];

    const embeddingResponses = await Promise.all(
        chunk.map(item => env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [item.description] }))
    );

    for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const embedding = embeddingResponses[j].data[0];
        
        vectors.push({
          id: item.url,
          values: embedding,
          metadata: {
            url: item.url,
            title: item.title,
            primaryKeyword: item.primaryKeyword,
            pubDate: item.pubDate,
            contentType: item.contentType,
          },
        });
    }

    if (vectors.length > 0) {
      await env.VECTORIZE_INDEX.upsert(vectors);
      upsertedCount += vectors.length;
    }
  }

  console.log(`Content sync completed. Upserted ${upsertedCount} items (${blogItems.length} blogs, ${productItems.length} products, ${collectionItems.length} collections).`);
  return new Response(JSON.stringify({ 
    success: true, 
    upsertedCount,
    breakdown: {
      blogs: blogItems.length,
      products: productItems.length,
      collections: collectionItems.length
    }
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}