
import { z } from 'zod';

const shopifyAPIResponseValidator = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  body_html: z.string().optional(),
  published: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  tags: z.string().optional(),
  author: z.string().optional(),
  blog_id: z.number().optional(),
});

export type ShopifyProduct = z.infer<typeof shopifyAPIResponseValidator> & {
    variants: { price: string }[];
    image: { src: string };
};

export class ShopifyClient {
  private shopifyToken: string;
  private shopifyShopUrl: string;

  constructor(shopifyToken: string, shopifyShopUrl: string) {
    this.shopifyToken = shopifyToken;
    if (!shopifyShopUrl.endsWith('.myshopify.com')) {
      this.shopifyShopUrl = `${shopifyShopUrl}.myshopify.com`;
    } else {
      this.shopifyShopUrl = shopifyShopUrl;
    }
  }

  private async makeShopifyRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
    const url = `https://${this.shopifyShopUrl}/admin/api/2024-10/${endpoint}`;
    const headers = {
      'X-Shopify-Access-Token': this.shopifyToken,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async getBlogs(): Promise<any> {
    return this.makeShopifyRequest('blogs.json');
  }

  async createBlogPost(blogId: number, article: any): Promise<any> {
    return this.makeShopifyRequest(`blogs/${blogId}/articles.json`, 'POST', { article });
  }

  async getArticles(blogId: number): Promise<any[]> {
    const response = await this.makeShopifyRequest(`blogs/${blogId}/articles.json`);
    return response.articles;
  }

  async getProducts(): Promise<ShopifyProduct[]> {
    const response = await this.makeShopifyRequest('products.json');
    return response.products;
  }

  async uploadImage(imageData: ArrayBuffer, filename: string): Promise<string> {
    console.log(`📤 SHOPIFY IMAGE UPLOAD STARTED`);
    console.log(`📁 Filename: ${filename}`);
    console.log(`📊 Size: ${Math.round(imageData.byteLength / 1024)}KB`);
    
    try {
      console.log(`🔄 Converting image to base64...`);
      const conversionStart = Date.now();
      // Convert ArrayBuffer to base64
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageData)));
      console.log(`✅ Base64 conversion complete (${Date.now() - conversionStart}ms)`);
      console.log(`📏 Base64 length: ${base64.length} characters`);
      
      const imagePayload = {
        image: {
          attachment: base64,
          filename: filename
        }
      };

      console.log(`🚀 Sending to Shopify API: themes/assets.json`);
      const uploadStart = Date.now();
      const response = await this.makeShopifyRequest('themes/assets.json', 'PUT', imagePayload);
      console.log(`✅ Shopify upload complete (${Date.now() - uploadStart}ms)`);
      
      const finalUrl = `https://${this.shopifyShopUrl.replace('.myshopify.com', '.com')}/files/${filename}`;
      console.log(`🔗 Final image URL: ${finalUrl}`);
      
      return finalUrl;
    } catch (error) {
      console.error(`❌ SHOPIFY IMAGE UPLOAD FAILED:`, error);
      console.error(`   • Filename: ${filename}`);
      console.error(`   • Size: ${Math.round(imageData.byteLength / 1024)}KB`);
      console.error(`   • Shop URL: ${this.shopifyShopUrl}`);
      throw error;
    }
  }

  async createBlogPostWithImage(blogId: number, article: any, imageUrl?: string): Promise<any> {
    if (imageUrl) {
      article.image = {
        src: imageUrl
      };
    }
    
    return this.makeShopifyRequest(`blogs/${blogId}/articles.json`, 'POST', { article });
  }
}
