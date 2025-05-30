import { MetaProvider as Provider } from "@builderbot/provider-meta";
import { createProvider } from "@builderbot/bot";
import { config } from "../config";

export const provider = createProvider(Provider, {
    jwtToken: config.META_JWT_TOKEN,
    numberId: config.META_NUMBER_ID,
    verifyToken: config.META_VERIFY_TOKEN,
    version: config.META_VERSION,
});