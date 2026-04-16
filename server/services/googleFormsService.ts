import { google, forms_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getGeminiClientOrThrow } from "../lib/gemini";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const SCOPES = [
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export interface FormQuestion {
  id: string;
  title: string;
  type: "text" | "paragraph" | "multiple_choice" | "checkbox" | "dropdown";
  options?: string[];
  required: boolean;
}

export interface GeneratedFormStructure {
  title: string;
  description: string;
  questions: FormQuestion[];
}

export interface CreatedForm {
  formId: string;
  title: string;
  description: string;
  questions: FormQuestion[];
  responderUrl: string;
  editUrl: string;
}

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export function createOAuth2Client(redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

export function getRedirectUri(host: string): string {
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}/api/integrations/google/forms/callback`;
}

export function getAuthUrl(userId: string, host: string): string {
  const redirectUri = getRedirectUri(host);
  const oauth2Client = createOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: Buffer.from(JSON.stringify({ userId, host })).toString("base64"),
  });
}

export function parseStateParam(state: string): { userId: string; host?: string } | null {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.userId === "string") {
      return { userId: parsed.userId, host: parsed.host };
    }
    return null;
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(code: string, host: string): Promise<TokenData> {
  const redirectUri = getRedirectUri(host);
  const oauth2Client = createOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.access_token) {
    throw new Error("No access token received from Google");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000),
  };
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  
  return {
    id: data.id || "",
    email: data.email || "",
    name: data.name || "",
    picture: data.picture || undefined,
  };
}

export async function revokeTokens(accessToken: string): Promise<void> {
  const oauth2Client = createOAuth2Client();
  await oauth2Client.revokeToken(accessToken);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  
  const { credentials } = await oauth2Client.refreshAccessToken();
  
  return {
    accessToken: credentials.access_token || "",
    refreshToken: credentials.refresh_token || refreshToken,
    expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600 * 1000),
  };
}

export async function generateFormStructure(prompt: string, customTitle?: string): Promise<GeneratedFormStructure> {
  console.log("[GoogleForms] Generating form structure for prompt:", prompt.slice(0, 100));
  const genAI = getGeminiClientOrThrow();
  
  const systemPrompt = `Eres un experto en crear formularios de Google. Dado un prompt del usuario, genera un JSON con la estructura del formulario.

IMPORTANTE: Responde SOLO con un JSON válido, sin markdown, sin explicaciones.

Formato de respuesta:
{
  "title": "Título del formulario",
  "description": "Descripción breve del formulario",
  "questions": [
    {
      "id": "q1",
      "title": "Pregunta 1",
      "type": "text|paragraph|multiple_choice|checkbox|dropdown",
      "options": ["opción 1", "opción 2"] (solo para multiple_choice, checkbox, dropdown),
      "required": true|false
    }
  ]
}

Tipos de preguntas disponibles:
- text: Respuesta corta de texto
- paragraph: Respuesta larga (párrafo)
- multiple_choice: Selección única (radio buttons)
- checkbox: Selección múltiple
- dropdown: Lista desplegable

Crea entre 5-15 preguntas relevantes y bien estructuradas. Usa variedad de tipos de preguntas.`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: `${systemPrompt}\n\nPrompt del usuario: ${prompt}${customTitle ? `\nTítulo preferido: ${customTitle}` : ""}` }] }
      ],
      config: {
        temperature: 0.7,
        maxOutputTokens: 2000,
      }
    });

    const text = response.text ?? "";
    console.log("[GoogleForms] Gemini response length:", text.length);
  
    let jsonText = text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.slice(7);
    }
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith("```")) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    let formData: GeneratedFormStructure;
    try {
      formData = JSON.parse(jsonText);
    } catch (e) {
      console.error("Failed to parse form JSON:", e, jsonText);
      throw new Error("Error al generar la estructura del formulario - respuesta inválida");
    }

    if (customTitle) {
      formData.title = customTitle;
    }

    console.log("[GoogleForms] Form structure generated:", formData.title, formData.questions.length, "questions");

    return {
      title: formData.title,
      description: formData.description,
      questions: formData.questions.map((q, idx) => ({
        ...q,
        id: q.id || `q${idx + 1}`
      })),
    };
  } catch (error: any) {
    console.error("[GoogleForms] Error generating form structure:", error.message);
    throw error;
  }
}

function mapQuestionTypeToGoogleForms(type: FormQuestion["type"]): forms_v1.Schema$Item {
  const baseItem: forms_v1.Schema$Item = {};
  
  switch (type) {
    case "text":
      baseItem.questionItem = {
        question: {
          textQuestion: {
            paragraph: false,
          },
        },
      };
      break;
    case "paragraph":
      baseItem.questionItem = {
        question: {
          textQuestion: {
            paragraph: true,
          },
        },
      };
      break;
    case "multiple_choice":
      baseItem.questionItem = {
        question: {
          choiceQuestion: {
            type: "RADIO",
            options: [],
          },
        },
      };
      break;
    case "checkbox":
      baseItem.questionItem = {
        question: {
          choiceQuestion: {
            type: "CHECKBOX",
            options: [],
          },
        },
      };
      break;
    case "dropdown":
      baseItem.questionItem = {
        question: {
          choiceQuestion: {
            type: "DROP_DOWN",
            options: [],
          },
        },
      };
      break;
    default:
      baseItem.questionItem = {
        question: {
          textQuestion: {
            paragraph: false,
          },
        },
      };
  }
  
  return baseItem;
}

export async function createGoogleForm(
  accessToken: string,
  formStructure: GeneratedFormStructure
): Promise<CreatedForm> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  const forms = google.forms({ version: "v1", auth: oauth2Client });
  
  const createResponse = await forms.forms.create({
    requestBody: {
      info: {
        title: formStructure.title,
        documentTitle: formStructure.title,
      },
    },
  });
  
  const formId = createResponse.data.formId;
  if (!formId) {
    throw new Error("Failed to create form - no formId returned");
  }
  
  const requests: forms_v1.Schema$Request[] = [];
  
  if (formStructure.description) {
    requests.push({
      updateFormInfo: {
        info: {
          description: formStructure.description,
        },
        updateMask: "description",
      },
    });
  }
  
  formStructure.questions.forEach((question, index) => {
    const item = mapQuestionTypeToGoogleForms(question.type);
    
    item.title = question.title;
    
    if (item.questionItem?.question) {
      item.questionItem.question.required = question.required;
      
      if (question.options && item.questionItem.question.choiceQuestion) {
        item.questionItem.question.choiceQuestion.options = question.options.map(opt => ({
          value: opt,
        }));
      }
    }
    
    requests.push({
      createItem: {
        item,
        location: {
          index,
        },
      },
    });
  });
  
  if (requests.length > 0) {
    await forms.forms.batchUpdate({
      formId,
      requestBody: {
        requests,
      },
    });
  }
  
  const getResponse = await forms.forms.get({ formId });
  const responderUri = getResponse.data.responderUri || `https://docs.google.com/forms/d/e/${formId}/viewform`;
  
  return {
    formId,
    title: formStructure.title,
    description: formStructure.description,
    questions: formStructure.questions,
    responderUrl: responderUri,
    editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
  };
}

export async function generateGoogleForm(prompt: string, customTitle?: string): Promise<CreatedForm> {
  const formStructure = await generateFormStructure(prompt, customTitle);
  
  const formId = `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    formId,
    title: formStructure.title,
    description: formStructure.description,
    questions: formStructure.questions,
    responderUrl: `https://docs.google.com/forms/d/e/${formId}/viewform`,
    editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
  };
}
