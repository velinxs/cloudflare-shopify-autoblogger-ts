import { Agent, AgentNamespace, getAgentByName } from 'agents';
import { OpenAI } from 'openai';

// Import all component classes
import { ShopifyClient } from './shopify';
import { PersonaManager, AuthorPersona } from './personas';
import { WebResearcher } from './researcher';
import { KeywordManager, Keyword } from './keywords';
import { ProductIntegrator } from './integrator';
import { syncPosts } from './content-sync';
import { fetchAllSiteUrls } from './sitemap';


// --- Type Definitions ---

interface Env {
  ShopifyAutobloggerAgent: AgentNamespace<ShopifyAutobloggerAgent>;
  OPENAI_API_KEY: string;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_SHOP_URL: string;
  API_KEY: string; // Secret for securing the worker
  VECTORIZE_INDEX: VectorizeIndex;
  BROWSER: Fetcher;
  AI: any;
}

interface AgentState {
  personas: AuthorPersona[];
}

// --- Agent Class ---

export class ShopifyAutobloggerAgent extends Agent<Env, AgentState> {
    initialState: AgentState = {
        personas: [],
    };

    // Component instances
    private openai: OpenAI;
    private shopify: ShopifyClient;
    private researcher: WebResearcher;
    private personaManager!: PersonaManager;
    private keywordManager!: KeywordManager;
    private productIntegrator: ProductIntegrator;

    constructor(ctx: any, env: Env) {
        super(ctx, env);
        this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        this.shopify = new ShopifyClient(env.SHOPIFY_ACCESS_TOKEN, env.SHOPIFY_SHOP_URL);
        this.researcher = new WebResearcher(this.openai);
        this.productIntegrator = new ProductIntegrator(this.shopify, this.openai);
    }

    async onStart() {
        this.personaManager = new PersonaManager(this.openai, this.state.personas);
        this.keywordManager = new KeywordManager(this.openai, this);
        await this.keywordManager.initSchema();
    }

    onStateUpdate(state: AgentState) {
        this.personaManager = new PersonaManager(this.openai, state.personas);
    }
    
    onError(error: any) {
        console.error('Agent error:', error);
        // Ensure we throw a real error object
        throw new Error(error.stack || error.message || 'An unknown error occurred in the agent.');
    }

    async onRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);
        console.log(`Agent received request: ${request.method} ${url.pathname}`);

        try {
            // Router for agent methods
            const path = url.pathname;

            if ((path === '/blogs' || path === '/blog') && request.method === 'GET') {
                const blogs = await this.getBlogs();
                return new Response(JSON.stringify(blogs), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/post' && request.method === 'POST') {
                const { blogId, topic, style, words, research, draft, userPrompt } = await request.json();
                const result = await this.enhancedAutoBlog(blogId, topic, style, words, research, !draft, userPrompt);
                return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/keywords/research' && request.method === 'POST') {
                const { topic, count, niche } = await request.json();
                const keywords = await this.keywordManager.researchKeywords(topic, count, niche);
                await this.keywordManager.addKeywords(keywords);
                return new Response(JSON.stringify(keywords), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/keywords/next' && request.method === 'GET') {
                const keywords = await this.keywordManager.getNextKeywords(10, 5);
                return new Response(JSON.stringify(keywords), { headers: { 'Content-Type': 'application/json' } });
            }

            return new Response('Not found in agent', { status: 404 });
        } catch (e: any) {
            console.error("Error in agent onRequest:", e);
            return new Response(e.stack, { status: 500 });
        }
    }

    // --- Core Agent Logic ---

    async getBlogs() {
        return this.shopify.getBlogs();
    }

    /**
     * Creates and returns the static "Alexa Velinxs" persona.
     * This ensures a consistent and strong brand voice for the blog.
     * @returns The Alexa Velinxs persona object.
     */
    private getAlexaVelinxsPersona(): AuthorPersona {
        return {
            id: "static-alexa-velinxs",
            name: "Alexa Velinxs",
            background: "A 15-year veteran pheromone researcher and passionate advocate who has witnessed the transformative power of pheromone science firsthand. As a relationship and attraction expert, she helps people understand how pheromones can naturally enhance their appeal and confidence. Alexa Velinxs is pro-pheromones and works for royalpheromones.com which sells Liquid Alchemy Labs products - the gold standard in pheromone technology.",
            expertise: ["pheromone research", "relationship psychology", "attraction science", "social confidence", "Liquid Alchemy Labs formulations", "dating enhancement"],
            experience_years: "15+",
            education: "Ph.D. in Pheromone Research & Human Behavior",
            achievements: ["15 years of pheromone research breakthroughs", "Helped thousands improve their dating success with pheromone strategies", "Pioneer in practical pheromone applications for everyday confidence"],
            writing_voice: "Passionate, confident, and genuinely helpful. She writes in accessible, straightforward language about the power of pheromones, combining scientific knowledge with practical advice. Enthusiastically promotes the effectiveness of quality pheromone products while being relatable and encouraging.",
            signature_style: "Enthusiastic advocate who addresses pheromone questions with evidence and real results. Combines practical relationship advice with cutting-edge pheromone science to help readers build genuine confidence and natural attraction.",
            created_at: new Date().toISOString(),
            topic_area: "all",
            style: "informative-edgy"
        };
    }

    async enhancedAutoBlog(blogId: number, topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', publish: boolean, userPrompt?: string) {
        const persona = this.getAlexaVelinxsPersona();
        const contentData = await this.generateBlogContent(topic, style, wordCount, researchDepth, persona, userPrompt);
        contentData.keyword = topic;
        return this.createBlogPost(blogId, contentData, publish, topic);
    }

    async generateBlogContent(topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', persona: AuthorPersona, userPrompt?: string) {
        const researchData = await this.researcher.researchTopic(topic, researchDepth);
        
        // Generate an embedding for the new topic to find similar articles
        const embeddingResponse = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [topic]
        });
        const topicEmbedding = embeddingResponse.data[0];

        // Query Vectorize for the most similar content (blogs, products, collections)
        const similarContent = await this.env.VECTORIZE_INDEX.query(topicEmbedding, { 
            topK: 20,
            filter: { contentType: { $in: ['blog', 'product', 'collection'] } }
        });
        
        // Validate and filter results
        const validLinks = similarContent.matches
            .filter(match => {
                const url = match.vector.metadata?.url;
                const contentType = match.vector.metadata?.contentType;
                // Basic URL validation and ensure we have required metadata
                return url && 
                       url.startsWith('https://royalpheromones.com') && 
                       contentType &&
                       match.vector.metadata?.title &&
                       match.vector.metadata?.primaryKeyword;
            })
            .map(match => ({
                url: match.vector.metadata.url,
                title: match.vector.metadata.title,
                primaryKeyword: match.vector.metadata.primaryKeyword,
                contentType: match.vector.metadata.contentType,
                score: match.score,
            }))
            .slice(0, 10); // Take top 10 after filtering
        
        // Add fallback links if vectorize is empty or has few results
        const fallbackLinks = [];
        if (validLinks.length < 5) {
            fallbackLinks.push(
                {
                    url: 'https://royalpheromones.com/collections/mens-pheromone-colognes',
                    title: 'Men\'s Pheromone Colognes',
                    primaryKeyword: 'pheromone colognes for men',
                    contentType: 'collection',
                    score: 0.7
                },
                {
                    url: 'https://royalpheromones.com/collections/womens-pheromone-perfumes', 
                    title: 'Women\'s Pheromone Perfumes',
                    primaryKeyword: 'pheromone perfumes for women',
                    contentType: 'collection',
                    score: 0.6
                }
            );
        }
        
        const internalLinks = [...validLinks, ...fallbackLinks].slice(0, 10);

        const systemPrompt = `
You are a ghostwriter, fully embodying the persona of ${persona.name}. Your task is to write a comprehensive, SEO-optimized, 1500-word blog post for the Royal Pheromones blog on the topic of "${topic}".

**Brand Context:**
The blog is for Royal Pheromones, the premier destination for Liquid Alchemy Labs pheromone products. Your content must be strongly PRO-PHEROMONE and enthusiastically promote the effectiveness of quality pheromone products. You are a passionate advocate, not a skeptic. Present pheromones as powerful, scientifically-backed tools for attraction and social success. Build excitement and confidence in pheromone technology.

**Your Persona: Alexa Velinxs**
- **Background:** ${persona.background}
- **Expertise:** ${persona.expertise.join(', ')}
- **Writing Voice & Style:** ${persona.writing_voice} ${persona.signature_style}

${userPrompt ? `**Additional User Guidance:**
${userPrompt}

Please incorporate this guidance throughout your writing while maintaining your persona and the brand voice.` : ''}

**Primary Source Material:**
You MUST use the following web research as the primary source for your article.
<research>
${JSON.stringify(researchData.research_content)}
</research>

**Internal Linking Strategy - CRITICAL:**
You MUST include multiple contextual internal links throughout your article. Here are contextually relevant pages from the Royal Pheromones site identified by semantic similarity:

- **Homepage** (ALWAYS AVAILABLE) - Link to https://royalpheromones.com when introducing the site, mentioning "Royal Pheromones," or discussing the brand generally. Use anchor text like "Royal Pheromones," "our site," "we offer," etc.
- **Collection pages** (HIGH PRIORITY) - Link when discussing product categories, types of pheromones, or shopping recommendations
- **Product pages** (HIGH PRIORITY) - Link when mentioning specific products, ingredients, or making recommendations  
- **Blog articles** - Link when referencing topics, research, or providing additional reading

Each link includes a 'primaryKeyword' and 'contentType'. Use the primaryKeyword to create natural, context-aware anchor text that fits the flow. You should include at least 8-12 contextual internal links throughout the article, including at least one homepage link. Be very aggressive about linking - every relevant mention should have a link. Include links in every major section of your article. NEVER use the same URL more than once in a single article.

CRITICAL: ONLY use URLs from the provided links list below, plus https://royalpheromones.com for homepage links. Do NOT create or guess URLs. All links have been validated and are guaranteed to work. If you need more variety, be creative with different anchor text for the same categories.

<links>
${JSON.stringify(internalLinks)}
</links>

**Content Requirements:**
1.  **Length:** ~1500 words.
2.  **SEO OPTIMIZATION (CRITICAL):** 
   - Use "${topic}" as the primary keyword throughout the article (aim for 1-2% density)
   - Include the primary keyword in: H1 title, first paragraph, at least 2 H2 headings, and conclusion
   - Sprinkle related secondary keywords naturally throughout: variations of the main topic, synonyms, and LSI keywords from your research
   - Use semantic keyword variations (e.g., "pheromone cologne" → "pheromone fragrance", "attraction scent", "magnetic cologne")
   - Include long-tail keyword variations in subheadings and body text
   - Use a clear heading structure (H1, H2, H3) with keywords in headings where natural
3.  **Formatting:** The 'content' field must be a single HTML string with proper tags (h1, h2, h3, p, strong, em, a, img).
4.  **Tone:** Write from your persona's first-person perspective ("I", "my").
5.  **Images:** Include 2-3 relevant images using this format: <img src="https://images.unsplash.com/photo-PHOTOID?w=800&h=400&fit=crop" alt="Alt text" style="width: 100%; max-width: 800px; height: auto; margin: 20px 0; border-radius: 8px;">. Use search terms like "cologne", "perfume", "attraction", "confidence", "dating" to find appropriate photo IDs from Unsplash.
6.  **Stance:** Be enthusiastically PRO-PHEROMONE. Present pheromones as effective, scientifically-backed tools. Counter skepticism with confidence and results.

**JSON Output Structure:**
- "title": SEO-friendly title.
- "meta_description": 150-160 character meta description.
- "summary": 2-3 sentence compelling summary/excerpt of the article.
- "handle": Short, clean URL slug based on primary keyword (e.g., "best-pheromone-cologne" for "best pheromone cologne for men").
- "content": The full 1500-word blog post as a single HTML string (no markdown, pure HTML).
- "tags": An array of 5-7 relevant SEO tags.
`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Write the blog post about ${topic}, ensuring it is at least 1500 words and follows all instructions.` }],
            response_format: { type: 'json_object' },
        });
        const content = JSON.parse(response.choices[0].message.content || '{}');
        return { ...content, author_persona: persona };
    }

    /**
     * Creates a clean URL handle from a topic/keyword.
     * @param topic The topic/keyword to convert to a handle.
     * @returns Clean URL handle.
     */
    private createHandle(topic: string): string {
        return topic
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single
            .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
            .substring(0, 50); // Limit length
    }

    /**
     * Sanitizes HTML content to remove unnecessary elements and keep only blog post content.
     * @param html The HTML content from OpenAI.
     * @returns Clean HTML string suitable for Shopify blog posts.
     */
    private sanitizeHtml(html: string): string {
        if (typeof html !== 'string') {
            return JSON.stringify(html); // Fallback for unexpected types
        }
        
        let cleanHtml = html
            // Remove doctype, html, head, body tags if present
            .replace(/<!DOCTYPE[^>]*>/gi, '')
            .replace(/<\/?html[^>]*>/gi, '')
            .replace(/<\/?head[^>]*>/gi, '')
            .replace(/<\/?body[^>]*>/gi, '')
            .replace(/<\/?meta[^>]*>/gi, '')
            .replace(/<\/?title[^>]*>/gi, '')
            .replace(/<\/?link[^>]*>/gi, '')
            .replace(/<\/?script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<\/?style[^>]*>[\s\S]*?<\/style>/gi, '')
            // Remove markdown code block wrappers if they exist
            .replace(/^```[\s\S]*?\n/, '')
            .replace(/\n```$/, '')
            .replace(/^```html\s*/, '')
            .replace(/^```markdown\s*/, '')
            .replace(/^```\s*/, '')
            // Clean up extra whitespace
            .trim();
            
        return cleanHtml;
    }

    async createBlogPost(blogId: number, contentData: any, published: boolean, topic: string) {
        console.log('Content received from OpenAI:', JSON.stringify(contentData, null, 2));
        
        // 1. Sanitize HTML content to remove unnecessary elements
        let htmlContent = this.sanitizeHtml(contentData.content);

        // 2. Add product ad contextually using AI
        const products = await this.productIntegrator.findRelevantProducts(contentData.keyword, htmlContent.substring(0, 500), 1);
        if (products.length > 0) {
            htmlContent = await this.productIntegrator.generateContextualProductPlacement(htmlContent, products);
        } else {
            console.warn(`No relevant products found for keyword: ${contentData.keyword}.`);
        }

        const articlePayload = {
            title: contentData.title || topic, // Fallback to topic if title is missing
            body_html: htmlContent,
            summary_html: contentData.summary || contentData.meta_description || 'Discover the power of pheromones with Royal Pheromones.',
            handle: contentData.handle || this.createHandle(topic), // Clean URL slug
            tags: Array.isArray(contentData.tags) ? contentData.tags.join(', ') : (contentData.tags || ''),
            published
        };
        const article = await this.shopify.createBlogPost(blogId, articlePayload);
        
        // 5. Mark keyword as used with the new article URL
        if (article && article.id && contentData.keyword) {
            // Assuming a standard Shopify URL structure
            const articleUrl = `https://royalpheromones.com/blogs/articles/${article.handle}`;
            await this.keywordManager.markKeywordUsed(contentData.keyword, article.id.toString(), articleUrl);
        }
        return article;
    }
}

import { syncPosts } from './content-sync';

// --- Worker Entrypoint ---

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    console.log(`Main worker received request: ${request.method} ${request.url}`);

    // --- Authentication Check ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Missing or invalid Authorization header', { status: 401 });
    }
    const providedKey = authHeader.substring(7); // Remove "Bearer " prefix
    if (providedKey !== env.API_KEY) {
      return new Response('Invalid API Key', { status: 403 });
    }
    // --- End Authentication Check ---

    const url = new URL(request.url);
    if (url.pathname === '/sync-posts' && request.method === 'POST') {
        // Pass the request to be handled in the background
        ctx.waitUntil(syncPosts(env));
        return new Response(JSON.stringify({ success: true, message: 'Content sync process started in the background.' }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
      const agent = await getAgentByName<Env, ShopifyAutobloggerAgent>(env.ShopifyAutobloggerAgent, 'singleton');
      return await agent.fetch(request);
    } catch (e: any) {
      console.error("Error in main fetch handler:", e);
      return new Response(e.stack, { status: 500 });
    }
  },
};