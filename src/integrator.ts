
import { OpenAI } from 'openai';
import { ShopifyClient, ShopifyProduct } from './shopify';

export class ProductIntegrator {
  private shopifyClient: ShopifyClient;
  private openai: OpenAI;

  constructor(shopifyClient: ShopifyClient, openai: OpenAI) {
    this.shopifyClient = shopifyClient;
    this.openai = openai;
  }

  async findRelevantProducts(keyword: string, context: string, maxProducts: number = 1): Promise<ShopifyProduct[]> {
    const products = await this.shopifyClient.getProducts();
    const productList = products.map((p) => ({ id: p.id, title: p.title, handle: p.handle, product_type: p.product_type }));

    const prompt = `Given the keyword "${keyword}" and the context "${context}", which of the following products are most relevant? Return a JSON object with a "product_ids" key containing an array of product IDs. Products: ${JSON.stringify(productList)}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    try {
      const relevantIds = JSON.parse(response.choices[0].message.content || '{}').product_ids || [];
      return products.filter((p) => relevantIds.includes(p.id)).slice(0, maxProducts);
    } catch (e) {
      console.error('Error parsing product IDs from OpenAI response:', e);
      return [];
    }
  }

  async generateContextualProductPlacement(content: string, products: ShopifyProduct[]): Promise<string> {
    const product = products[0]; // We'll just use the most relevant product for the ad
    const adHtml = `
<div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin: 2rem 0; display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
  <img src="${product.image?.src}" alt="${product.title}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 8px;">
  <div style="flex: 1; min-width: 200px;">
    <h3 style="margin-top: 0;">${product.title}</h3>
    <p>Unlock your potential with our top-rated formula.</p>
    <p style="font-size: 1.5rem; font-weight: bold; margin: 0.5rem 0;">${product.variants[0]?.price}</p>
    <a href="https://royalpheromones.com/products/${product.handle}" style="display: inline-block; background-color: #2563eb; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 8px; font-weight: bold;">Shop Now</a>
  </div>
</div>
`;

    const prompt = `You are an expert content editor. Your task is to seamlessly and cohesively insert the following HTML ad block into the middle of the blog post. Find the most natural break between sections for the ad.

**HTML Ad Block:**
${adHtml}

**Blog Content (Markdown):**
${content}

Return the full, modified blog post as a single Markdown string with the HTML ad block inserted.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content || content;
  }

  }
