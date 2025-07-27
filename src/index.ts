import { Agent, AgentNamespace, getAgentByName } from 'agents';
import { OpenAI } from 'openai';

// Import all component classes
import { ShopifyClient } from './shopify';
import { PersonaManager, AuthorPersona } from './personas';
import { WebResearcher } from './researcher';
import { KeywordManager, Keyword } from './keywords';
import { ProductIntegrator } from './integrator';

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

    async enhancedAutoBlog(blogId: number, topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', publish: boolean) {
        const contentData = await this.generateBlogContent(topic, style, wordCount, researchDepth);
        contentData.keyword = topic;
        return this.createBlogPost(blogId, contentData, publish);
    }

    async generateBlogContent(topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive') {
        const researchData = await this.researcher.researchTopic(topic, researchDepth);
        const persona = await this.personaManager.getOrCreatePersona(topic, style);
        this.setState({ ...this.state, personas: this.personaManager.getPersonas() });

        const systemPrompt = `You are ${persona.name}, a professional content writer... Return your response as a JSON object with a 'title' field (string) and a 'content' field (an array of objects, each with a 'heading' and a 'paragraph').`;
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Write the blog post about ${topic}` }],
            response_format: { type: 'json_object' },
        });
        const content = JSON.parse(response.choices[0].message.content || '{}');
        return { ...content, author_persona: persona };
    }

    /**
     * Converts the structured content array from OpenAI into an HTML string.
     * @param content The array of content objects.
     * @returns An HTML string.
     */
    private contentArrayToHtml(content: any[]): string {
        if (!Array.isArray(content)) {
            // If it's not an array, stringify it as a fallback.
            return typeof content === 'string' ? content : JSON.stringify(content);
        }
        return content.map(item => {
            let block = '';
            if (item.heading) {
                block += `<h2>${item.heading}</h2>`;
            }
            if (item.paragraph) {
                block += `<p>${item.paragraph}</p>`;
            }
            return block;
        }).join('');
    }

    async createBlogPost(blogId: number, contentData: any, published: boolean) {
        console.log('Content received from OpenAI:', JSON.stringify(contentData, null, 2));
        
        // Convert the content array to an HTML string
        const htmlContent = this.contentArrayToHtml(contentData.content);
        let enhancedContent = htmlContent;

        if (contentData.keyword) {
            try {
              const products = await this.productIntegrator.findRelevantProducts(contentData.keyword, htmlContent.substring(0, 500));
              if (products.length > 0) {
                  enhancedContent = await this.productIntegrator.generateContextualProductPlacement(enhancedContent, products);
              }
            } catch (e) {
              console.error('Error finding relevant products:', e);
            }
        }
        const articlePayload = {
            ...contentData,
            title: contentData.title || topic, // Fallback to topic if title is missing
            body_html: enhancedContent,
            published
        };
        const article = await this.shopify.createBlogPost(blogId, articlePayload);
        if (article && article.id && contentData.keyword) {
            await this.keywordManager.markKeywordUsed(contentData.keyword, article.id.toString(), article.handle);
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