import "dotenv/config";
import { validateIntegrationProcess } from "./integration-environment";

// Import this module BEFORE dynamically importing app/Prisma in every integration file.
validateIntegrationProcess(process.env);
