import "dotenv/config"

export const config = {
    PORT: process.env.PORT ?? 3008,
    META_JWT_TOKEN: process.env.META_JWT_TOKEN,
    META_NUMBER_ID: process.env.META_NUMBER_ID,
    META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN,
    META_VERSION: process.env.META_VERSION ?? "v21.0",
    Model: process.env.Model ?? "gpt-4o-mini",
    apiKey: process.env.apiKey,

    // AI Provider Configuration
    AI_PROVIDER: process.env.AI_PROVIDER ?? "openai", // "openai" or "deepseek"
    ENABLE_FALLBACK: process.env.ENABLE_FALLBACK === "true", // Enable fallback to DeepSeek when OpenAI fails
    
    // DeepSeek Configuration
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? "deepseek-chat", // cheapest model
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",

    // Chatwoot
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_TOKEN: process.env.CHATWOOT_TOKEN,
    CHATWOOT_ENDPOINT: process.env.CHATWOOT_ENDPOINT ?? "https://app.chatwoot.com",
    BOT_URL: process.env.BOT_URL ?? "http://localhost:3098",
    INBOX_NAME: process.env.INBOX_NAME ?? "ClinicAI",
};