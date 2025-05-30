import { OpenAI } from "openai";
import { config } from "~/config";

class aiServices {
    private static apiKey: string;
    private openai: OpenAI;
    private deepseek: OpenAI | null = null;

    constructor(apiKey: any) {
        aiServices.apiKey = apiKey;
        
        // Initialize OpenAI client
        this.openai = new OpenAI({
            apiKey: aiServices.apiKey,
        });

        // Initialize DeepSeek client if API key is provided
        if (config.DEEPSEEK_API_KEY) {
            this.deepseek = new OpenAI({
                apiKey: config.DEEPSEEK_API_KEY,
                baseURL: config.DEEPSEEK_BASE_URL,
            });
        }
    }

    async chat(prompt: string, messages: any[]): Promise<string> {
        const provider = config.AI_PROVIDER.toLowerCase();
        
        if (provider === "deepseek") {
            return this.chatWithDeepSeek(prompt, messages);
        } else {
            return this.chatWithOpenAI(prompt, messages);
        }
    }

    private async chatWithOpenAI(prompt: string, messages: any[]): Promise<string> {
        try {
            const completion = await this.openai.chat.completions.create({
                model: config.Model,
                messages: [
                    { role: "system", content: prompt },
                    ...messages,
                ],
            });
            
            const answer = completion.choices[0].message?.content || "No response";
            return answer;
        } catch (err) {
            console.error("❌ Error connecting to OpenAI:", err);
            
            // Try fallback to DeepSeek if enabled and available
            if (config.ENABLE_FALLBACK && this.deepseek) {
                console.log("🔄 Falling back to DeepSeek...");
                return this.chatWithDeepSeek(prompt, messages);
            }
            
            return "ERROR";
        }
    }

    private async chatWithDeepSeek(prompt: string, messages: any[]): Promise<string> {
        if (!this.deepseek) {
            console.error("❌ DeepSeek client not initialized. Please set DEEPSEEK_API_KEY in environment variables.");
            return "ERROR: DeepSeek not configured";
        }

        try {
            const completion = await this.deepseek.chat.completions.create({
                model: config.DEEPSEEK_MODEL,
                messages: [
                    { role: "system", content: prompt },
                    ...messages,
                ],
            });
            
            const answer = completion.choices[0].message?.content || "No response";
            return answer;
        } catch (err) {
            console.error("❌ Error connecting to DeepSeek:", err);
            return "ERROR";
        }
    }

    // Method to manually switch provider at runtime
    public switchProvider(provider: "openai" | "deepseek"): boolean {
        if (provider === "deepseek" && !this.deepseek) {
            console.error("Cannot switch to DeepSeek: API key not configured");
            return false;
        }
        
        // Update config temporarily (note: this won't persist)
        (config as any).AI_PROVIDER = provider;
        return true;
    }

    // Method to check provider health
    public async checkProviderHealth(): Promise<{ openai: boolean; deepseek: boolean }> {
        const health = { openai: false, deepseek: false };

        // Test OpenAI
        try {
            await this.openai.chat.completions.create({
                model: config.Model,
                messages: [{ role: "user", content: "test" }],
                max_tokens: 1,
            });
            health.openai = true;
        } catch (err) {
            console.log("OpenAI health check failed:", err instanceof Error ? err.message : "Unknown error");
        }

        // Test DeepSeek
        if (this.deepseek) {
            try {
                await this.deepseek.chat.completions.create({
                    model: config.DEEPSEEK_MODEL,
                    messages: [{ role: "user", content: "test" }],
                    max_tokens: 1,
                });
                health.deepseek = true;
            } catch (err) {
                console.log("DeepSeek health check failed:", err instanceof Error ? err.message : "Unknown error");
            }
        }

        return health;
    }
}

export default aiServices;