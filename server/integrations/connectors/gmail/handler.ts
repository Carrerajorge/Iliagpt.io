import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { gmailManifest } from "./manifest";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const handler = createRestHandler(gmailManifest, API_BASE);
