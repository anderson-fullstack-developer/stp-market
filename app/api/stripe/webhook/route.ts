import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCommissionRate, splitSale } from "@/lib/commission";
import { getSiteUrl } from "@/lib/site-url";
import {
  sendNewOrderAdminEmail,
  sendOrderConfirmationEmail,
  sendVendorSaleEmail,
} from "@/lib/email/send";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Assinatura em falta" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object, getSiteUrl(new URL(request.url).origin));
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, siteUrl: string) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) return;

  const existing = await prisma.order.findUnique({
    where: { stripePaymentId: paymentIntentId },
  });
  if (existing) return;

  const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, {
    expand: ["data.price.product"],
  });

  const lineItemsData = lineItems.data.flatMap((line) => {
    const product = line.price?.product;
    if (!product || typeof product === "string" || !("metadata" in product)) return [];
    const productId = product.metadata.productId;
    if (!productId) return [];

    return [
      {
        productId,
        name: product.name,
        quantity: line.quantity ?? 1,
        price: (line.price?.unit_amount ?? 0) / 100,
      },
    ];
  });

  if (lineItemsData.length === 0) return;

  const products = await prisma.product.findMany({
    where: { id: { in: lineItemsData.map((item) => item.productId) } },
    select: { id: true, vendorId: true, vendor: { select: { name: true, email: true } } },
  });
  const vendorByProductId = new Map(products.map((product) => [product.id, product.vendorId]));
  const vendorInfoById = new Map(
    products
      .filter((product) => product.vendorId && product.vendor)
      .map((product) => [product.vendorId as string, product.vendor!])
  );
  const commissionRate = getCommissionRate();

  const orderItemsData = lineItemsData.map(({ productId, quantity, price }) => {
    const vendorId = vendorByProductId.get(productId) ?? null;
    const { commissionAmount, vendorAmount } = splitSale(price * quantity, commissionRate, vendorId !== null);

    return { productId, quantity, price, vendorId, commissionAmount, vendorAmount };
  });

  const shippingDetails = session.collected_information?.shipping_details;
  const customerDetails = session.customer_details;

  const customerData = {
    name: shippingDetails?.name ?? customerDetails?.name ?? "Cliente",
    email: customerDetails?.email ?? "",
    phone: customerDetails?.phone ?? "",
    address:
      [shippingDetails?.address.line1, shippingDetails?.address.line2]
        .filter(Boolean)
        .join(", ") || (customerDetails?.address?.line1 ?? ""),
    city: shippingDetails?.address.city ?? customerDetails?.address?.city ?? "",
    postalCode:
      shippingDetails?.address.postal_code ?? customerDetails?.address?.postal_code ?? "",
    country: shippingDetails?.address.country ?? customerDetails?.address?.country ?? "",
  };

  // O checkout envia o id do Customer em client_reference_id — liga a encomenda à conta
  // certa mesmo que o email na Stripe seja diferente. O email da conta não é alterado aqui.
  const referencedCustomer = session.client_reference_id
    ? await prisma.customer.findUnique({ where: { id: session.client_reference_id } })
    : null;

  const customer = referencedCustomer
    ? await prisma.customer.update({
        where: { id: referencedCustomer.id },
        data: { ...customerData, email: referencedCustomer.email },
      })
    : customerData.email
    ? await prisma.customer.upsert({
        where: { email: customerData.email },
        create: customerData,
        update: customerData,
      })
    : await prisma.customer.create({ data: customerData });

  const productsTotal = orderItemsData.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingAmount = (session.shipping_cost?.amount_total ?? 0) / 100;
  const total = (session.amount_total ?? 0) / 100 || productsTotal + shippingAmount;

  const [order] = await prisma.$transaction([
    prisma.order.create({
      data: {
        customerId: customer.id,
        shippingAmount,
        stripePaymentId: paymentIntentId,
        total,
        status: "PAID",
        items: { create: orderItemsData },
      },
    }),
    ...orderItemsData.map((item) =>
      prisma.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      })
    ),
  ]);

  const emailItems = lineItemsData.map(({ name, quantity, price }) => ({
    name,
    quantity,
    price,
  }));

  try {
    if (customer.email) {
      await sendOrderConfirmationEmail({
        customerName: customer.name,
        customerEmail: customer.email,
        orderId: order.id,
        items: emailItems,
        shippingAmount,
        total,
        siteUrl,
      });
    }

    await sendNewOrderAdminEmail({
      orderId: order.id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      address: customer.address,
      city: customer.city,
      postalCode: customer.postalCode,
      country: customer.country,
      items: emailItems,
      shippingAmount,
      total,
      siteUrl,
    });
  } catch (error) {
    console.error("Falha ao enviar emails de confirmação de encomenda:", error);
  }

  const vendorIds = [...new Set(orderItemsData.map((item) => item.vendorId).filter(Boolean))] as string[];

  for (const vendorId of vendorIds) {
    const vendorInfo = vendorInfoById.get(vendorId);
    if (!vendorInfo) continue;

    const vendorItems = orderItemsData
      .map((item, index) => ({ ...item, ...lineItemsData[index] }))
      .filter((item) => item.vendorId === vendorId);

    const vendorAmount = vendorItems.reduce((sum, item) => sum + (item.vendorAmount ?? 0), 0);

    try {
      await sendVendorSaleEmail({
        vendorName: vendorInfo.name,
        vendorEmail: vendorInfo.email,
        orderId: order.id,
        items: vendorItems.map((item) => ({ name: item.name, quantity: item.quantity, price: item.price })),
        vendorAmount,
        siteUrl,
      });
    } catch (error) {
      console.error("Falha ao enviar email de venda ao fornecedor:", error);
    }
  }
}
