"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getCurrentCustomer } from "@/lib/customer";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { buildCheckout } from "@/lib/pricing";

const checkoutInputSchema = z
  .array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  )
  .min(1, "O carrinho está vazio");

export async function createCheckoutSession(input: unknown) {
  const customer = await getCurrentCustomer({ syncEmail: true });
  if (!customer) {
    throw new Error("Tens de iniciar sessão para finalizar a compra.");
  }

  const items = checkoutInputSchema.parse(input);

  const products = await prisma.product.findMany({
    where: {
      id: { in: items.map((item) => item.productId) },
      active: true,
      approvalStatus: "APPROVED",
    },
  });

  const { lineItems, shippingAmount } = buildCheckout(items, products);

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  const checkoutSession = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: Math.round(shippingAmount * 100), currency: "eur" },
          display_name: shippingAmount === 0 ? "Envio grátis" : "Envio",
        },
      },
    ],
    success_url: `${origin}/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/carrinho`,
    customer_email: customer.email,
    client_reference_id: customer.id,
    billing_address_collection: "required",
    shipping_address_collection: { allowed_countries: ["PT"] },
    phone_number_collection: { enabled: true },
  });

  if (!checkoutSession.url) {
    throw new Error("Não foi possível criar a sessão de pagamento.");
  }

  return { url: checkoutSession.url };
}
