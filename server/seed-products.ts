import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  console.log('Creating iliagpt subscription plans...');

  // Plan Go - $5/month
  const goProduct = await stripe.products.create({
    name: 'Go',
    description: 'Logra más con una IA más avanzada',
    metadata: {
      plan_type: 'go',
      features: 'Explora preguntas complejas, más tiempo de chat, imágenes realistas, más contexto'
    }
  });

  const goPrice = await stripe.prices.create({
    product: goProduct.id,
    unit_amount: 500, // $5.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan_type: 'go' }
  });

  console.log(`Created Go plan: ${goProduct.id} with price ${goPrice.id}`);

  // Plan Plus - $20/month
  const plusProduct = await stripe.products.create({
    name: 'Plus',
    description: 'Descubre toda la experiencia',
    metadata: {
      plan_type: 'plus',
      features: 'Resuelve problemas complejos, charlas largas, más imágenes, modo Agente, videos Sora'
    }
  });

  const plusPrice = await stripe.prices.create({
    product: plusProduct.id,
    unit_amount: 2000, // $20.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan_type: 'plus' }
  });

  console.log(`Created Plus plan: ${plusProduct.id} with price ${plusPrice.id}`);

  // Plan Pro - $200/month
  const proProduct = await stripe.products.create({
    name: 'Pro',
    description: 'Maximiza tu productividad',
    metadata: {
      plan_type: 'pro',
      features: 'Mensajes ilimitados, imágenes de alta calidad, memoria máxima, agentes, videos Sora, Codex'
    }
  });

  const proPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 20000, // $200.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan_type: 'pro' }
  });

  console.log(`Created Pro plan: ${proProduct.id} with price ${proPrice.id}`);

  console.log('\nAll products created successfully!');
  console.log('\nPrice IDs for checkout:');
  console.log(`Go: ${goPrice.id}`);
  console.log(`Plus: ${plusPrice.id}`);
  console.log(`Pro: ${proPrice.id}`);
}

createProducts().catch(console.error);
