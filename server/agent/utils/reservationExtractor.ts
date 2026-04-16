export type ReservationMissingField =
    | "restaurant"
    | "date"
    | "time"
    | "partySize"
    | "contactName"
    | "contactPhone"
    | "contactEmail";

export interface ReservationDetails {
    restaurant?: string;
    date?: string;
    time?: string;
    partySize?: number;
    contactName?: string;
    phone?: string;
    email?: string;
    location?: string;
}

export const RESERVATION_FIELD_LABELS: Record<ReservationMissingField, string> = {
    restaurant: "restaurante exacto",
    date: "fecha exacta (dia/mes/anio)",
    time: "hora exacta (ej. 20:00 o 8:00 pm)",
    partySize: "cantidad de personas",
    contactName: "nombre para la reserva",
    contactPhone: "telefono de contacto",
    contactEmail: "email de contacto",
};

export function normalizeSpaces(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function isRestaurantReservationRequest(text: string): boolean {
    const normalized = normalizeSpaces(text).toLowerCase();
    if (!normalized) return false;
    const hasReservationVerb = /\b(reserva|reservar|reservacion|reservation|book|booking)\b/i.test(normalized);
    const hasRestaurantTerm = /\b(restaurante|restaurant|mesa|table)\b/i.test(normalized);

    const hasReservaEnPattern = /\breserva(?:r)?\s+(?:en|at)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+/i.test(normalized);
    const hasReservaParaPersonas = /\breserva(?:r|cion)?\b.*\b\d+\s*personas?\b/i.test(normalized);

    return hasReservationVerb && (hasRestaurantTerm || hasReservaEnPattern || hasReservaParaPersonas);
}

export function extractReservationDetails(text: string): ReservationDetails {
    const source = normalizeSpaces(text);
    const details: ReservationDetails = {};
    if (!source) return details;

    const partyMatch =
        source.match(/\b(?:para|for)\s+(\d{1,2})\s*(?:personas?|people|guests?|comensales?)\b/i) ||
        source.match(/\b(\d{1,2})\s*(?:personas?|people|guests?|comensales?)\b/i);
    if (partyMatch) {
        const parsed = Number(partyMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) details.partySize = parsed;
    }

    const monthEs = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
    const monthEn = "january|february|march|april|may|june|july|august|september|october|november|december";
    const datePatterns: RegExp[] = [
        /\b\d{4}-\d{2}-\d{2}\b/i,
        /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})\b/i,
        new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${monthEs})(?:\\s+de?\\s*\\d{4})?\\b`, "i"),
        new RegExp(`\\b(?:${monthEn})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "i"),
        /\b(?:hoy|manana|mañana|today|tomorrow)\b/i,
        /\b(?:d[ií]a|el)\s+(\d{1,2})\b/i,
    ];
    for (const pattern of datePatterns) {
        const match = source.match(pattern);
        if (match?.[0]) {
            details.date = normalizeSpaces(match[0]);
            break;
        }
    }

    const timeMatch =
        source.match(/\b(?:a las|at)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i) ||
        source.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i) ||
        source.match(/\b(\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))\b/i);
    if (timeMatch?.[1]) {
        details.time = normalizeSpaces(timeMatch[1]);
    }

    const restaurantAfterKeyword = source.match(/\b(?:restaurante|restaurant)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|$|,)/i);
    const afterKeywordCandidate = restaurantAfterKeyword?.[1]?.toLowerCase();
    const afterKeywordStopwords = new Set(["para", "for", "en", "in", "de", "del", "la", "el", "los", "las", "the", "at"]);
    const restaurantAfterKeywordValue =
        afterKeywordCandidate && afterKeywordStopwords.has(afterKeywordCandidate)
            ? undefined
            : restaurantAfterKeyword?.[1];

    const restaurantBeforeKeyword = source.match(/\b(?:reserva(?:r)?|book(?:ing)?)\s+(?:mesa|table)?\s*(?:en|at)\s+(?:el\s+|la\s+|los\s+|las\s+|the\s+)?(.+?)\s+(?:restaurante|restaurant)\b/i);
    const restaurantByReservePattern = source.match(/\b(?:reserva(?:r)?|book(?:ing)?)\s+(?:mesa|table)?\s*(?:en|at)\s+(?:el\s+|la\s+|the\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|$|,)/i);

    const restaurantRaw = restaurantAfterKeywordValue || restaurantBeforeKeyword?.[1] || restaurantByReservePattern?.[1];
    if (restaurantRaw) {
        details.restaurant = normalizeSpaces(restaurantRaw.replace(/^(?:en|el|la|los|las|the)\s+/i, "").replace(/[,;.]$/, ""));
    }

    const locationAfterRestaurant = source.match(/\b(?:restaurante|restaurant)\s+(?:en|in|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)(?:\s|,|$)/i);
    const locationGeneric = source.match(/\b(?:en|in)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+)\s+(?:para|for|el|on|a las|at)\b/i);
    const locationMatch = locationAfterRestaurant || locationGeneric;
    if (locationMatch?.[1]) {
        const loc = normalizeSpaces(locationMatch[1]);
        if (loc.toLowerCase() !== (details.restaurant || "").toLowerCase()) {
            details.location = loc;
        }
    }
    if (!details.location && details.restaurant) {
        const cityFromRestaurant = details.restaurant.match(/\bde\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\- ]{2,40})$/i);
        if (cityFromRestaurant?.[1]) {
            details.location = normalizeSpaces(cityFromRestaurant[1]);
        }
    }

    const emailMatch = source.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if (emailMatch?.[0]) details.email = emailMatch[0];

    const sourceWithoutEmails = source.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");
    const labeledPhoneMatch = sourceWithoutEmails.match(/\b(?:telefono|tel[eé]fono|phone|cel|celular|whatsapp|n[uú]mero|mi\s+numero)\b\s*(?:es|de|:|\-)?\s*(\+?\d[\d\s().-]{7,}\d)\b/i);

    if (labeledPhoneMatch?.[1]) {
        const candidate = normalizeSpaces(labeledPhoneMatch[1]);
        const digitCount = candidate.replace(/\D/g, "").length;
        if (digitCount >= 8 && digitCount <= 15) details.phone = candidate;
    }

    if (!details.phone) {
        const loosePhoneMatches = sourceWithoutEmails.match(/\+?\d[\d\s().-]{8,}\d/g) || [];
        for (const rawMatch of loosePhoneMatches) {
            const candidate = normalizeSpaces(rawMatch);
            if (/[:/]/.test(candidate)) continue;
            const digitCount = candidate.replace(/\D/g, "").length;
            if (digitCount >= 8 && digitCount <= 15) {
                details.phone = candidate;
                break;
            }
        }
    }

    const nameMatch = source.match(/\b(?:a nombre de|(?:mi\s+)?nombre(?:\s+(?:de|es))?|name(?:\s+is)?|my name is|me llamo|soy)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ'\- ]{2,60})/i);
    if (nameMatch?.[1]) {
        const cleaned = normalizeSpaces(nameMatch[1]).split(/\b(?:telefono|tel|phone|email|correo|a\s+las|para|n[uú]mero|mi\s+numero|mi\s+correo|mi\s+tel)\b/i)[0].trim();
        if (cleaned.length >= 2) details.contactName = cleaned;
    }

    return details;
}

export function getMissingReservationFields(details: ReservationDetails): ReservationMissingField[] {
    const missing: ReservationMissingField[] = [];
    if (!details.restaurant) missing.push("restaurant");
    if (!details.date) missing.push("date");
    if (!details.time) missing.push("time");
    if (!details.partySize) missing.push("partySize");
    if (!details.contactName) missing.push("contactName");
    if (!details.phone) missing.push("contactPhone");
    if (!details.email) missing.push("contactEmail");
    return missing;
}

export function formatReservationDetails(details: ReservationDetails): string {
    const parts: string[] = [];
    if (details.restaurant) parts.push(`restaurante="${details.restaurant}"`);
    if (details.location) parts.push(`ciudad="${details.location}"`);
    if (details.date) parts.push(`fecha="${details.date}"`);
    if (details.time) parts.push(`hora="${details.time}"`);
    if (details.partySize) parts.push(`personas=${details.partySize}`);
    if (details.contactName) parts.push(`nombre="${details.contactName}"`);
    if (details.phone) parts.push(`telefono="${details.phone}"`);
    if (details.email) parts.push(`email="${details.email}"`);
    return parts.join(", ");
}

export function buildReservationClarificationQuestion(
    details: ReservationDetails,
    missingFields: ReservationMissingField[]
): string {
    const knownParts: string[] = [];
    if (details.restaurant) knownParts.push(`**Restaurante:** ${details.restaurant}`);
    if (details.location) knownParts.push(`**Ciudad:** ${details.location}`);
    if (details.date) knownParts.push(`**Fecha:** ${details.date}`);
    if (details.time) knownParts.push(`**Hora:** ${details.time}`);
    if (details.partySize) knownParts.push(`**Personas:** ${details.partySize}`);
    if (details.contactName) knownParts.push(`**Nombre:** ${details.contactName}`);
    if (details.phone) knownParts.push(`**Teléfono:** ${details.phone}`);
    if (details.email) knownParts.push(`**Email:** ${details.email}`);

    const knownBlock = knownParts.length > 0
        ? `✅ **Datos detectados:**  \n${knownParts.join("  \n")}\n\n`
        : "";
    const missingList = missingFields.map((field) => `- ${RESERVATION_FIELD_LABELS[field]}`).join("\n");
    return `${knownBlock}📋 **Para completar la reserva necesito estos datos:**\n${missingList}\n\nCompártelos en un solo mensaje y continúo con la reserva real en la web.`;
}
