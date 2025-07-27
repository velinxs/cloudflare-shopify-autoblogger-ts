import { OpenAI } from 'openai';
import { ShopifyClient, ShopifyProduct } from './shopify';

export class ProductIntegrator {
  private shopifyClient: ShopifyClient;
  private openai: OpenAI;

  constructor(shopifyClient: ShopifyClient, openai: OpenAI) {
    this.shopifyClient = shopifyClient;
    this.openai = openai;
  }

  async findRelevantProducts(keyword: string, context: string, maxProducts: number = 2): Promise<ShopifyProduct[]> {
    const products = await this.shopifyClient.getProducts();
    const productList = products.map((p) => ({ id: p.id, title: p.title, handle: p.handle, product_type: p.product_type }));

    const prompt = `Given the keyword "${keyword}" and the context "${context}", which of the following products are most relevant? Return a JSON array of product IDs. Products: ${JSON.stringify(productList)}`;

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
    const productLinks = products.map((p) => `- ${p.title}: [View Product](${p.handle})`).join('\n');
    const prompt = `Integrate the following product links naturally into the blog post content:\n\n${productLinks}\n\nContent:\n${content}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content || content;
  }

  addInternalLinks(content: string, internalLinks: { keyword: string; url: string }[]): string {
    let newContent = content;
    for (const link of internalLinks) {
      const regex = new RegExp(`\\b(${link.keyword})\\b`, 'gi');
      newContent = newContent.replace(regex, `<a href="${link.url}">$1</a>`);
    }
    return newContent;
  }
}