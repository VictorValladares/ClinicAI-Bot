import { createFlow } from "@builderbot/bot";
import { mainFlow } from "./mainFlow";
import { faqFlow } from "./faqFlow";
import { registerFlow } from "./registerFlow";
import { DetectIntention } from "./intentionFlow";
import { citaFlow } from "./citaFlow";
import { employeeFlow } from "./employeeFlow";
import { confirmationFlow } from "./confirmationFlow";
import { reminderResponseFlow } from "./reminderResponseFlow";

export default createFlow([
    mainFlow,
    faqFlow,
    registerFlow,
    DetectIntention,
    citaFlow,
    employeeFlow,
    confirmationFlow,
    reminderResponseFlow
])