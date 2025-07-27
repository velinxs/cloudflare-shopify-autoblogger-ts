import { Agent, AgentNamespace, getAgentByName } from 'agents';
import { OpenAI } from 'openai';

// Import all component classes
import { ShopifyClient } from './shopify';
import { PersonaManager, AuthorPersona } from './personas';
import { WebResearcher } from './researcher';
import { KeywordManager, Keyword } from './keywords';
import { ProductIntegrator } from './integrator';

import { fetchAllSiteUrls } from './sitemap';

// --- Type Definitions ---

interface Env {
  ShopifyAutobloggerAgent: AgentNamespace<ShopifyAutobloggerAgent>;
  OPENAI_API_KEY: string;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_SHOP_URL: string;
  API_KEY: string; // Secret for securing the worker
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
                const { blogId, topic, style, words, research, draft } = await request.json();
                const result = await this.enhancedAutoBlog(blogId, topic, style, words, research, !draft);
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
            background: "A seasoned biochemist and no-nonsense dating coach who grew disillusioned with mainstream advice. She now focuses on the raw, unfiltered science of attraction and social dynamics.",
            expertise: ["pheromone science", "attraction psychology", "social dynamics", "dating strategy"],
            experience_years: "10+",
            education: "M.S. in Biochemistry",
            achievements: ["Published research on olfactory signals", "Founder of a successful dating consultancy"],
            writing_voice: "Direct, witty, and unapologetically honest with a touch of dark humor. She writes for a smart, discerning audience, making complex science accessible and actionable without sugar-coating.",
            signature_style: "Cuts through the noise with sharp analysis and a confident, slightly provocative tone. Blends scientific evidence with real-world, often blunt, advice.",
            created_at: new Date().toISOString(),
            topic_area: "all",
            style: "informative-edgy"
        };
    }

    async enhancedAutoBlog(blogId: number, topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', publish: boolean) {
        const persona = this.getAlexaVelinxsPersona();
        const contentData = await this.generateBlogContent(topic, style, wordCount, researchDepth, persona);
        contentData.keyword = topic;
        return this.createBlogPost(blogId, contentData, publish, topic);
    }

    async generateBlogContent(topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', persona: AuthorPersona) {
        const researchData = await this.researcher.researchTopic(topic, researchDepth);
        
        // Fetch all site URLs from sitemaps for a comprehensive linking strategy
        const siteUrls = await fetchAllSiteUrls();
        const allLinks = [
            ...siteUrls.blogPosts.map(p => p.loc),
            ...siteUrls.products.map(p => p.loc),
            ...siteUrls.collections.map(p => p.loc),
        ];

        const systemPrompt = `
You are a ghostwriter, fully embodying the persona of ${persona.name}. Your task is to write a comprehensive, SEO-optimized, 1500-word blog post for the Royal Pheromones blog on the topic of "${topic}".

**Brand Context:**
The blog is for Royal Pheromones. The content must be informative, engaging, and build trust, while aligning with the company's mission. Your writing should be natural, realistic, and human.

**Your Persona: Alexa Velinxs**
- **Background:** ${persona.background}
- **Expertise:** ${persona.expertise.join(', ')}
- **Writing Voice & Style:** ${persona.writing_voice} ${persona.signature_style}

**Primary Source Material:**
You MUST use the following web research as the primary source for your article.
<research>
${JSON.stringify(researchData.research_content)}
</research>

**Internal Linking Strategy:**
This is crucial. You must naturally weave in numerous contextual internal links to other pages on the Royal Pheromones site. Here is a complete list of all available pages from the site's sitemaps. Link to at least 5-7 relevant pages (a mix of blog posts, products, and collections) where it provides the most value to the reader.
<links>
${JSON.stringify(allLinks)}
</links>

**Content Requirements:**
1.  **Length:** ~1500 words.
2.  **SEO:** Use "${topic}" as the primary keyword. Include related keywords from your research. Use a clear heading structure (H1, H2, H3).
3.  **Formatting:** The 'content' field must be a single Markdown string.
4.  **Tone:** Write from your persona's first-person perspective ("I", "my").

**JSON Output Structure:**
- "title": SEO-friendly title.
- "meta_description": 150-160 character meta description.
- "content": The full 1500-word blog post as a single Markdown string.
- "tags": An array of 5-7 relevant SEO tags.
`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Write the blog post about ${topic}, ensuring it is at least 1500 words and follows all instructions.` }],
            response_format: { type: 'json_object' },
        });
        const content = JSON.parse(response.choices[0].message.content || '{}');
        return { ...content, author_persona: persona };
    }

    /**
     * Converts a Markdown string into a basic HTML string.
     * @param markdown The Markdown content from OpenAI.
     * @returns An HTML string.
     */
    private markdownToHtml(markdown: string): string {
        if (typeof markdown !== 'string') {
            return JSON.stringify(markdown); // Fallback for unexpected types
        }
        return markdown
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>')
            .replace(/\n/gim, '<br>');
    }

    async createBlogPost(blogId: number, contentData: any, published: boolean, topic: string) {
        console.log('Content received from OpenAI:', JSON.stringify(contentData, null, 2));
        
        // 1. Convert the markdown content to an HTML string for product integration context
        const markdownContent = contentData.content;
        let enhancedContent = markdownContent;

        // 2. Add product ad contextually using AI
        const products = await this.productIntegrator.findRelevantProducts(contentData.keyword, markdownContent.substring(0, 500), 1);
        if (products.length > 0) {
            enhancedContent = await this.productIntegrator.generateContextualProductPlacement(enhancedContent, products);
        } else {
            console.warn(`No relevant products found for keyword: ${contentData.keyword}.`);
        }
        
        // 4. Convert the final Markdown to HTML for Shopify
        const finalHtmlContent = this.markdownToHtml(enhancedContent);

        const articlePayload = {
            ...contentData,
            title: contentData.title || topic, // Fallback to topic if title is missing
            body_html: finalHtmlContent,
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

    try {
      const agent = await getAgentByName<Env, ShopifyAutobloggerAgent>(env.ShopifyAutobloggerAgent, 'singleton');
      return await agent.fetch(request);
    } catch (e: any) {
      console.error("Error in main fetch handler:", e);
      return new Response(e.stack, { status: 500 });
    }
  },
};