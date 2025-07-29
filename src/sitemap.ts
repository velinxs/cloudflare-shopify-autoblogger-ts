
import { z } from 'zod';

// Zod schema for parsing the <url> elements from the sitemap
const urlSchema = z.object({
  loc: z.string().url(),
  lastmod: z.string().optional(),
});

type SitemapUrl = z.infer<typeof urlSchema>;

/**
 * Fetches and parses an XML sitemap, returning a list of URLs.
 * @param url The URL of the sitemap to fetch.
 * @returns A promise that resolves to an array of SitemapUrl objects.
 */
async function parseSitemap(url: string): Promise<SitemapUrl[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch sitemap: ${url} - Status: ${response.status}`);
      return [];
    }
    const xmlText = await response.text();
    
    // Basic XML parsing with regex to avoid heavy dependencies
    const urlBlocks = xmlText.match(/<url>([\s\S]*?)<\/url>/g);
    if (!urlBlocks) {
      return [];
    }

    const urls: SitemapUrl[] = urlBlocks.map(block => {
      const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
      const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
      return {
        loc: locMatch ? locMatch[1] : '',
        lastmod: lastmodMatch ? lastmodMatch[1] : undefined,
      };
    }).filter(url => url.loc); // Filter out any empty locations

    return urls;
  } catch (error) {
    console.error(`Error parsing sitemap ${url}:`, error);
    return [];
  }
}

/**
 * Fetches all pages from the Royal Pheromones sitemaps.
 * @returns A promise that resolves to an object containing lists of blog posts, products, and collections.
 */
export async function fetchAllSiteUrls() {
  const sitemapUrls = {
    blogs: 'https://royalpheromones.com/sitemap_blogs_1.xml',
    products: 'https://royalpheromones.com/sitemap_products_1.xml',
    collections: 'https://royalpheromones.com/sitemap_collections_1.xml?from=272732946526&to=276353908830',
  };

  const [blogPosts, products, collections] = await Promise.all([
    parseSitemap(sitemapUrls.blogs),
    parseSitemap(sitemapUrls.products),
    parseSitemap(sitemapUrls.collections),
  ]);

  return {
    blogPosts,
    products,
    collections,
  };
}
