import { describe, expect, it } from "vitest";
import { evaluateWhatsAppPolicy, getWhatsAppOutOfScopeReply } from "../../channels/whatsappCloud/whatsappPolicy";

describe("WhatsApp Cloud policy", () => {
  it("allows greeting", () => {
    const d = evaluateWhatsAppPolicy("Hola");
    expect(d.allowed).toBe(true);
  });

  it("allows reservation intents", () => {
    const d = evaluateWhatsAppPolicy("Quiero reservar una mesa hoy a las 8pm");
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.category).toBe("reservation");
  });

  it("denies filesystem/computer-control requests", () => {
    const d1 = evaluateWhatsAppPolicy("Mandame el archivo CV.pdf del escritorio");
    expect(d1.allowed).toBe(false);

    const d2 = evaluateWhatsAppPolicy("Ejecuta un comando en mi terminal");
    expect(d2.allowed).toBe(false);
  });

  it("denies general assistant requests by default", () => {
    const d = evaluateWhatsAppPolicy("Cuentame un chiste");
    expect(d.allowed).toBe(false);
  });

  it("out-of-scope reply can include base url", () => {
    const reply = getWhatsAppOutOfScopeReply("https://example.com");
    expect(reply).toContain("https://example.com");
  });
});

