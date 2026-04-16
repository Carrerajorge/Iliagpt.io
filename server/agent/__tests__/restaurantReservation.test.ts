import { describe, it, expect } from "vitest";
import {
  isRestaurantReservationRequest,
  extractReservationDetails,
  getMissingReservationFields,
  formatReservationDetails,
  buildReservationClarificationQuestion,
  normalizeSpaces,
  collectRecentUserText,
} from "../agentExecutor";
import type { ReservationDetails, ReservationMissingField } from "../agentExecutor";

/* ------------------------------------------------------------------ */
/*  normalizeSpaces                                                    */
/* ------------------------------------------------------------------ */
describe("normalizeSpaces", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeSpaces("  hello  ")).toBe("hello");
  });

  it("collapses multiple internal spaces", () => {
    expect(normalizeSpaces("hello   world")).toBe("hello world");
  });

  it("handles tabs and newlines", () => {
    expect(normalizeSpaces("hello\t\nworld")).toBe("hello world");
  });

  it("returns empty string for falsy input", () => {
    expect(normalizeSpaces("")).toBe("");
    expect(normalizeSpaces(undefined as any)).toBe("");
    expect(normalizeSpaces(null as any)).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  collectRecentUserText                                              */
/* ------------------------------------------------------------------ */
describe("collectRecentUserText", () => {
  it("collects text from user messages only", () => {
    const msgs = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "respuesta" },
      { role: "user", content: "reservar mesa" },
    ];
    const result = collectRecentUserText(msgs);
    expect(result).toContain("hola");
    expect(result).toContain("reservar mesa");
    expect(result).not.toContain("respuesta");
  });

  it("only considers the last 4 user messages", () => {
    const msgs = [
      { role: "user", content: "msg1" },
      { role: "user", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "user", content: "msg4" },
      { role: "user", content: "msg5" },
    ];
    const result = collectRecentUserText(msgs);
    expect(result).not.toContain("msg1");
    expect(result).toContain("msg2");
    expect(result).toContain("msg5");
  });

  it("returns empty string for empty array", () => {
    expect(collectRecentUserText([])).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  isRestaurantReservationRequest                                     */
/* ------------------------------------------------------------------ */
describe("isRestaurantReservationRequest", () => {
  describe("detects valid reservation requests (Spanish)", () => {
    it.each([
      "Quiero reservar un restaurante para 4 personas",
      "Hacer una reserva en restaurante Cala",
      "Reservar mesa en restaurante Maido para mañana",
      "Necesito una reservacion en un restaurante",
      "reserva restaurante para hoy",
    ])('detects: "%s"', (text) => {
      expect(isRestaurantReservationRequest(text)).toBe(true);
    });
  });

  describe("detects valid reservation requests (English)", () => {
    it.each([
      "Book a table at a restaurant",
      "I need a reservation at a restaurant for tonight",
      "Restaurant booking for 6 people",
    ])('detects: "%s"', (text) => {
      expect(isRestaurantReservationRequest(text)).toBe(true);
    });
  });

  describe("rejects non-reservation requests", () => {
    it.each([
      "Quiero buscar un restaurante",
      "Recomienda un restaurante bueno",
      "Reservar un vuelo a Lima",
      "Reserva de hotel en Cusco",
      "",
      "hola como estas",
    ])('rejects: "%s"', (text) => {
      expect(isRestaurantReservationRequest(text)).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  extractReservationDetails                                          */
/* ------------------------------------------------------------------ */
describe("extractReservationDetails", () => {
  describe("party size extraction", () => {
    it("extracts 'para N personas'", () => {
      const d = extractReservationDetails("reservar mesa para 4 personas en restaurante Cala");
      expect(d.partySize).toBe(4);
    });

    it("extracts 'for N people'", () => {
      const d = extractReservationDetails("book restaurant for 6 people");
      expect(d.partySize).toBe(6);
    });

    it("extracts 'N comensales'", () => {
      const d = extractReservationDetails("reservar para 2 comensales");
      expect(d.partySize).toBe(2);
    });

    it("does not extract zero or negative party size", () => {
      const d = extractReservationDetails("para 0 personas");
      expect(d.partySize).toBeUndefined();
    });
  });

  describe("date extraction", () => {
    it("extracts ISO date yyyy-mm-dd", () => {
      const d = extractReservationDetails("reservar restaurante el 2026-03-15");
      expect(d.date).toBe("2026-03-15");
    });

    it("extracts dd/mm/yyyy", () => {
      const d = extractReservationDetails("reservar restaurante el 15/03/2026");
      expect(d.date).toBe("15/03/2026");
    });

    it("extracts Spanish date 'N de mes'", () => {
      const d = extractReservationDetails("reservar restaurante para el 15 de marzo");
      expect(d.date).toBe("15 de marzo");
    });

    it("extracts Spanish date with year", () => {
      const d = extractReservationDetails("reservar restaurante el 20 de febrero de 2026");
      expect(d.date).toBe("20 de febrero de 2026");
    });

    it("extracts English date 'Month N'", () => {
      const d = extractReservationDetails("book restaurant March 15");
      expect(d.date).toBe("March 15");
    });

    it("extracts 'hoy'", () => {
      const d = extractReservationDetails("reservar restaurante para hoy");
      expect(d.date).toBe("hoy");
    });

    it("extracts 'mañana'", () => {
      const d = extractReservationDetails("reservar restaurante para mañana");
      expect(d.date).toBe("mañana");
    });

    it("extracts 'tomorrow'", () => {
      const d = extractReservationDetails("book restaurant for tomorrow");
      expect(d.date).toBe("tomorrow");
    });
  });

  describe("time extraction", () => {
    it("extracts 'a las HH:MM'", () => {
      const d = extractReservationDetails("reservar restaurante a las 20:00");
      expect(d.time).toBe("20:00");
    });

    it("extracts 'a las N pm'", () => {
      const d = extractReservationDetails("reservar restaurante a las 8 pm");
      expect(d.time).toBe("8 pm");
    });

    it("extracts 'at HH:MM'", () => {
      const d = extractReservationDetails("book restaurant at 7:30pm");
      expect(d.time).toBe("7:30pm");
    });

    it("extracts standalone HH:MM", () => {
      const d = extractReservationDetails("reservar restaurante 19:30");
      expect(d.time).toBe("19:30");
    });
  });

  describe("restaurant name extraction", () => {
    it("extracts 'restaurante [Name]' pattern", () => {
      const d = extractReservationDetails("reservar mesa en restaurante Maido");
      expect(d.restaurant?.toLowerCase()).toContain("maido");
    });

    it("extracts 'en [Name] restaurante' pattern", () => {
      const d = extractReservationDetails("reservar mesa en Cala restaurante para 4 personas");
      expect(d.restaurant?.toLowerCase()).toContain("cala");
    });

    it("extracts 'reserva en [Name]' pattern", () => {
      const d = extractReservationDetails("reservar en Astrid para 2 personas");
      expect(d.restaurant?.toLowerCase()).toContain("astrid");
    });
  });

  describe("email extraction", () => {
    it("extracts a valid email address", () => {
      const d = extractReservationDetails("reservar restaurante email juan@gmail.com");
      expect(d.email).toBe("juan@gmail.com");
    });

    it("extracts complex email addresses", () => {
      const d = extractReservationDetails("reservar restaurante correo jorge.perez+test@empresa.com.pe");
      expect(d.email).toBe("jorge.perez+test@empresa.com.pe");
    });
  });

  describe("phone extraction", () => {
    it("extracts labeled phone number", () => {
      const d = extractReservationDetails("reservar restaurante telefono 987654321");
      expect(d.phone).toBe("987654321");
    });

    it("extracts phone with country code", () => {
      const d = extractReservationDetails("reservar restaurante telefono +51 987 654 321");
      expect(d.phone).toContain("987");
    });

    it("extracts unlabeled phone number (loose match)", () => {
      // Loose pattern requires 10+ digit sequence: \+?\d[\d\s().-]{8,}\d
      const d = extractReservationDetails("reservar restaurante 9876543210");
      expect(d.phone).toBe("9876543210");
    });
  });

  describe("contact name extraction", () => {
    it("extracts 'a nombre de [Name]'", () => {
      const d = extractReservationDetails("reservar restaurante a nombre de Juan Perez");
      expect(d.contactName).toBe("Juan Perez");
    });

    it("extracts 'nombre: [Name]'", () => {
      const d = extractReservationDetails("reservar restaurante nombre: María García");
      expect(d.contactName).toBe("María García");
    });

    it("extracts 'my name is [Name]'", () => {
      const d = extractReservationDetails("book restaurant my name is Carlos Lopez");
      expect(d.contactName).toBe("Carlos Lopez");
    });
  });

  describe("location extraction", () => {
    it("extracts location from 'restaurante en [City]'", () => {
      const d = extractReservationDetails("reservar restaurante en Lima para 4 personas");
      expect(d.location).toBeTruthy();
    });
  });

  describe("complete reservation request", () => {
    it("extracts all fields from a complete request", () => {
      const text =
        "Reservar mesa en restaurante Maido para 4 personas el 15 de marzo a las 20:00 " +
        "a nombre de Juan Perez telefono 987654321 email juan@gmail.com";
      const d = extractReservationDetails(text);

      expect(d.restaurant?.toLowerCase()).toContain("maido");
      expect(d.partySize).toBe(4);
      expect(d.date).toBe("15 de marzo");
      expect(d.time).toBe("20:00");
      expect(d.contactName).toBe("Juan Perez");
      expect(d.phone).toBe("987654321");
      expect(d.email).toBe("juan@gmail.com");
    });

    it("returns empty object for empty input", () => {
      const d = extractReservationDetails("");
      expect(d).toEqual({});
    });
  });
});

/* ------------------------------------------------------------------ */
/*  getMissingReservationFields                                        */
/* ------------------------------------------------------------------ */
describe("getMissingReservationFields", () => {
  it("returns all fields when details are empty", () => {
    const missing = getMissingReservationFields({});
    expect(missing).toHaveLength(7);
    expect(missing).toContain("restaurant");
    expect(missing).toContain("date");
    expect(missing).toContain("time");
    expect(missing).toContain("partySize");
    expect(missing).toContain("contactName");
    expect(missing).toContain("contactPhone");
    expect(missing).toContain("contactEmail");
  });

  it("returns empty array when all fields are present", () => {
    const complete: ReservationDetails = {
      restaurant: "Maido",
      date: "15 de marzo",
      time: "20:00",
      partySize: 4,
      contactName: "Juan",
      phone: "987654321",
      email: "juan@test.com",
    };
    const missing = getMissingReservationFields(complete);
    expect(missing).toHaveLength(0);
  });

  it("identifies only missing fields", () => {
    const partial: ReservationDetails = {
      restaurant: "Cala",
      partySize: 2,
    };
    const missing = getMissingReservationFields(partial);
    expect(missing).toContain("date");
    expect(missing).toContain("time");
    expect(missing).toContain("contactName");
    expect(missing).toContain("contactPhone");
    expect(missing).toContain("contactEmail");
    expect(missing).not.toContain("restaurant");
    expect(missing).not.toContain("partySize");
  });
});

/* ------------------------------------------------------------------ */
/*  formatReservationDetails                                           */
/* ------------------------------------------------------------------ */
describe("formatReservationDetails", () => {
  it("formats all present fields", () => {
    const details: ReservationDetails = {
      restaurant: "Maido",
      location: "Lima",
      date: "15 de marzo",
      time: "20:00",
      partySize: 4,
      contactName: "Juan",
      phone: "987654321",
      email: "juan@test.com",
    };
    const formatted = formatReservationDetails(details);
    expect(formatted).toContain('restaurante="Maido"');
    expect(formatted).toContain('ciudad="Lima"');
    expect(formatted).toContain('fecha="15 de marzo"');
    expect(formatted).toContain('hora="20:00"');
    expect(formatted).toContain("personas=4");
    expect(formatted).toContain('nombre="Juan"');
    expect(formatted).toContain('telefono="987654321"');
    expect(formatted).toContain('email="juan@test.com"');
  });

  it("omits absent fields", () => {
    const details: ReservationDetails = { restaurant: "Cala" };
    const formatted = formatReservationDetails(details);
    expect(formatted).toBe('restaurante="Cala"');
    expect(formatted).not.toContain("fecha");
    expect(formatted).not.toContain("hora");
  });

  it("returns empty string for empty details", () => {
    expect(formatReservationDetails({})).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  buildReservationClarificationQuestion                              */
/* ------------------------------------------------------------------ */
describe("buildReservationClarificationQuestion", () => {
  it("includes detected fields in the known block", () => {
    const details: ReservationDetails = {
      restaurant: "Maido",
      partySize: 4,
    };
    const missing: ReservationMissingField[] = ["date", "time", "contactName", "contactPhone", "contactEmail"];
    const question = buildReservationClarificationQuestion(details, missing);

    expect(question).toContain("**Restaurante:** Maido");
    expect(question).toContain("**Personas:** 4");
  });

  it("lists all missing fields", () => {
    const details: ReservationDetails = { restaurant: "Cala" };
    const missing: ReservationMissingField[] = ["date", "time", "partySize", "contactName", "contactPhone", "contactEmail"];
    const question = buildReservationClarificationQuestion(details, missing);

    expect(question).toContain("fecha exacta");
    expect(question).toContain("hora exacta");
    expect(question).toContain("cantidad de personas");
    expect(question).toContain("nombre para la reserva");
    expect(question).toContain("telefono de contacto");
    expect(question).toContain("email de contacto");
  });

  it("shows no known block when details are empty", () => {
    const missing: ReservationMissingField[] = ["restaurant", "date", "time", "partySize", "contactName", "contactPhone", "contactEmail"];
    const question = buildReservationClarificationQuestion({}, missing);

    expect(question).not.toContain("Datos detectados");
    expect(question).toContain("Para completar la reserva");
  });

  it("includes final instruction text", () => {
    const question = buildReservationClarificationQuestion({}, ["restaurant"]);
    expect(question).toContain("Compártelos en un solo mensaje");
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: full reservation flow                                 */
/* ------------------------------------------------------------------ */
describe("Reservation flow integration", () => {
  it("detects reservation, extracts details, finds missing fields, and builds clarification", () => {
    const userText = "Quiero reservar mesa en restaurante Cala para 4 personas mañana a las 8 pm";

    // Step 1: detect
    expect(isRestaurantReservationRequest(userText)).toBe(true);

    // Step 2: extract
    const details = extractReservationDetails(userText);
    expect(details.restaurant?.toLowerCase()).toContain("cala");
    expect(details.partySize).toBe(4);
    expect(details.date).toBe("mañana");
    expect(details.time).toBe("8 pm");

    // Step 3: find missing
    const missing = getMissingReservationFields(details);
    expect(missing).toContain("contactName");
    expect(missing).toContain("contactPhone");
    expect(missing).toContain("contactEmail");
    expect(missing).not.toContain("restaurant");
    expect(missing).not.toContain("date");
    expect(missing).not.toContain("time");
    expect(missing).not.toContain("partySize");

    // Step 4: clarification
    const question = buildReservationClarificationQuestion(details, missing);
    expect(question).toContain("Cala");
    expect(question).toContain("mañana");
    expect(question).toContain("8 pm");
    expect(question).toContain("4");
    expect(question).toContain("nombre para la reserva");
    expect(question).toContain("telefono de contacto");
    expect(question).toContain("email de contacto");
  });

  it("returns no missing fields when all data is provided", () => {
    const userText =
      "Reservar mesa en restaurante Maido para 2 personas el 20 de febrero de 2026 " +
      "a las 19:30 a nombre de María García telefono +51 987 654 321 email maria@test.com";

    expect(isRestaurantReservationRequest(userText)).toBe(true);

    const details = extractReservationDetails(userText);
    const missing = getMissingReservationFields(details);

    expect(missing).toHaveLength(0);
    expect(details.restaurant?.toLowerCase()).toContain("maido");
    expect(details.partySize).toBe(2);
    expect(details.date).toBe("20 de febrero de 2026");
    expect(details.time).toBe("19:30");
    expect(details.contactName).toBe("María García");
    expect(details.email).toBe("maria@test.com");
    expect(details.phone).toBeTruthy();
  });

  it("collects details across multiple messages", () => {
    const messages = [
      { role: "user", content: "Quiero reservar mesa en restaurante Cala" },
      { role: "assistant", content: "Necesito más datos..." },
      { role: "user", content: "para 4 personas mañana a las 8 pm a nombre de Juan telefono 987654321 email juan@test.com" },
    ];

    const recentText = collectRecentUserText(messages);
    expect(isRestaurantReservationRequest(recentText)).toBe(true);

    const details = extractReservationDetails(recentText);
    expect(details.restaurant?.toLowerCase()).toContain("cala");
    expect(details.partySize).toBe(4);
    expect(details.date).toBe("mañana");
    expect(details.time).toBe("8 pm");
    expect(details.contactName).toBe("Juan");
    expect(details.phone).toBe("987654321");
    expect(details.email).toBe("juan@test.com");

    const missing = getMissingReservationFields(details);
    expect(missing).toHaveLength(0);
  });
});
