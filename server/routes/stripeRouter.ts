import { Router } from "express";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const PLAN_PRICE_MAPPING: Record<string, { name: string; amount: number; interval?: string }> = {
  price_go_monthly: { name: "Go", amount: 500, interval: "month" },      // $5/mes
  price_plus_monthly: { name: "Plus", amount: 2000, interval: "month" }, // $20/mes
  price_pro_monthly: { name: "Pro", amount: 20000, interval: "month" },  // $200/mes
};

export function createStripeRouter() {
  const router = Router();

  router.get("/api/stripe/publishable-key", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error: any) {
      console.error("Error getting Stripe publishable key:", error);
      res.status(500).json({ error: "Failed to get publishable key" });
    }
  });

  router.get("/api/stripe/products", async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring
          });
        }
      }

      res.json({ products: Array.from(productsMap.values()) });
    } catch (error: any) {
      console.error("Error fetching products:", error);
      res.json({ products: [] });
    }
  });

  router.get("/api/stripe/price-ids", async (req, res) => {
    try {
      const priceMapping: Record<string, string> = {};
      
      try {
        const result = await db.execute(sql`
          SELECT 
            p.name as product_name,
            pr.id as price_id,
            pr.unit_amount
          FROM stripe.products p
          LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
          WHERE p.active = true
          ORDER BY pr.unit_amount ASC
        `);

        for (const row of result.rows as any[]) {
          const productName = (row.product_name || "").toLowerCase();
          const amount = row.unit_amount;
          
          if (productName.includes("go") || amount === 500) {
            priceMapping.price_go_monthly = row.price_id;
          } else if (productName.includes("plus") || amount === 2000) {
            priceMapping.price_plus_monthly = row.price_id;
          } else if (productName.includes("pro") || amount === 20000) {
            priceMapping.price_pro_monthly = row.price_id;
          }
        }
      } catch (dbError) {
        console.log("DB lookup failed, trying Stripe API directly");
      }

      if (Object.keys(priceMapping).length === 0) {
        try {
          const stripe = await getUncachableStripeClient();
          const prices = await stripe.prices.list({ active: true, limit: 100 });
          
          for (const price of prices.data) {
            const amount = price.unit_amount;
            const interval = price.recurring?.interval;
            
            if (amount === 500 && interval === "month") {
              priceMapping.price_go_monthly = price.id;
            } else if (amount === 2000 && interval === "month") {
              priceMapping.price_plus_monthly = price.id;
            } else if (amount === 20000 && interval === "month") {
              priceMapping.price_pro_monthly = price.id;
            }
          }
        } catch (stripeError: any) {
          console.error("Stripe API lookup failed:", stripeError.message);
        }
      }

      res.json({ priceMapping });
    } catch (error: any) {
      console.error("Error fetching price IDs:", error);
      res.json({ priceMapping: {} });
    }
  });

  router.post("/api/checkout", async (req, res) => {
    try {
      const { priceId } = req.body;
      if (!priceId) {
        return res.status(400).json({ error: "priceId is required" });
      }

      const stripe = await getUncachableStripeClient();
      
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      let customerId: string | undefined;

      if (userId) {
        const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
        if (dbUser?.stripeCustomerId) {
          customerId = dbUser.stripeCustomerId;
        } else if (dbUser) {
          const customer = await stripe.customers.create({
            email: dbUser.email || undefined,
            metadata: { userId }
          });
          customerId = customer.id;
          await db.update(users)
            .set({ stripeCustomerId: customerId })
            .where(eq(users.id, userId));
        }
      }

      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const protocol = domain.includes('localhost') ? 'http' : 'https';

      const sessionConfig: any = {
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${protocol}://${domain}/?subscription=success`,
        cancel_url: `${protocol}://${domain}/?subscription=cancelled`,
      };

      if (customerId) {
        sessionConfig.customer = customerId;
        sessionConfig.metadata = { userId };
      } else {
        sessionConfig.customer_creation = 'always';
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  router.post("/api/stripe/create-products", async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      const createdProducts: any[] = [];

      const productsToCreate = [
        {
          name: "IliaGPT Go",
          description: "Logra más con una IA más avanzada - 50 solicitudes por día",
          priceAmount: 500,
          interval: "month" as const,
          metadata: { plan: "go" }
        },
        {
          name: "IliaGPT Plus",
          description: "Descubre toda la experiencia - 200 solicitudes por día",
          priceAmount: 1000,
          interval: "month" as const,
          metadata: { plan: "plus" }
        },
        {
          name: "IliaGPT Pro",
          description: "Maximiza tu productividad - Mensajes ilimitados",
          priceAmount: 2000,
          interval: "year" as const,
          metadata: { plan: "pro" }
        }
      ];

      for (const productData of productsToCreate) {
        const existingProducts = await stripe.products.search({
          query: `name:'${productData.name}'`
        });

        let product;
        if (existingProducts.data.length > 0) {
          product = existingProducts.data[0];
        } else {
          product = await stripe.products.create({
            name: productData.name,
            description: productData.description,
            metadata: productData.metadata
          });
        }

        const existingPrices = await stripe.prices.list({
          product: product.id,
          active: true
        });

        let price;
        const matchingPrice = existingPrices.data.find(
          p => p.unit_amount === productData.priceAmount && 
               p.recurring?.interval === productData.interval
        );

        if (matchingPrice) {
          price = matchingPrice;
        } else {
          price = await stripe.prices.create({
            product: product.id,
            unit_amount: productData.priceAmount,
            currency: "usd",
            recurring: { interval: productData.interval }
          });
        }

        createdProducts.push({
          productId: product.id,
          productName: product.name,
          priceId: price.id,
          amount: price.unit_amount,
          interval: price.recurring?.interval
        });
      }

      res.json({ 
        success: true, 
        message: "Productos creados exitosamente",
        products: createdProducts 
      });
    } catch (error: any) {
      console.error("Error creating products:", error);
      res.status(500).json({ error: error.message || "Failed to create products" });
    }
  });

  router.post("/api/stripe/portal", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser?.stripeCustomerId) {
        return res.status(400).json({ error: "No subscription found" });
      }

      const stripe = await getUncachableStripeClient();
      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const protocol = domain.includes('localhost') ? 'http' : 'https';

      const session = await stripe.billingPortal.sessions.create({
        customer: dbUser.stripeCustomerId,
        return_url: `${protocol}://${domain}/`
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Portal error:", error);
      res.status(500).json({ error: "Failed to create portal session" });
    }
  });

  return router;
}
