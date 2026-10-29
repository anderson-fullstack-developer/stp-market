import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), create: vi.fn() },
  product: { findMany: vi.fn(), update: vi.fn() },
  customer: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
const stripe = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  checkout: { sessions: { listLineItems: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/email/send", () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendNewOrderAdminEmail: vi.fn(),
  sendVendorSaleEmail: vi.fn(),
}));

const { POST } = await import("@/app/api/stripe/webhook/route");

function webhookRequest(signature: string | null = "t=1,v1=valid") {
  const headers = new Headers();
  if (signature) headers.set("stripe-signature", signature);
  return new Request("https://shop.test/api/stripe/webhook", { method: "POST", headers, body: "{}" });
}

const session = {
  id: "cs_test_1",
  payment_intent: "pi_123",
  client_reference_id: null,
  amount_total: 2997,
  shipping_cost: { amount_total: 0 },
  customer_details: { name: "Maria", email: "maria@example.com", phone: "", address: null },
  collected_information: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COMMISSION_RATE = "10";
  stripe.webhooks.constructEvent.mockReturnValue({
    type: "checkout.session.completed",
    data: { object: session },
  });
  stripe.checkout.sessions.listLineItems.mockResolvedValue({
    data: [
      {
        quantity: 3,
        price: { unit_amount: 999, product: { name: "Café", metadata: { productId: "coffee" } } },
      },
    ],
  });
  prisma.product.findMany.mockResolvedValue([
    { id: "coffee", vendorId: "vendor_1", vendor: { name: "Roça", email: "roca@example.com" } },
  ]);
  prisma.customer.upsert.mockResolvedValue({ id: "cust_1", name: "Maria", email: "maria@example.com" });
  prisma.order.create.mockReturnValue({ id: "order_1" });
  prisma.product.update.mockReturnValue({});
  prisma.$transaction.mockImplementation(async (operations: unknown[]) => Promise.all(operations));
});

describe("Stripe webhook", () => {
  it("rejects requests without a signature", async () => {
    const response = await POST(webhookRequest(null));
    expect(response.status).toBe(400);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid signature", async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const response = await POST(webhookRequest("t=1,v1=forged"));
    expect(response.status).toBe(400);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("creates the order, splits the commission and decrements stock after payment", async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.order.create.mock.calls[0][0];
    expect(data).toMatchObject({ stripePaymentId: "pi_123", status: "PAID", total: 29.97 });
    expect(data.items.create).toEqual([
      { productId: "coffee", quantity: 3, price: 9.99, vendorId: "vendor_1", commissionAmount: 3, vendorAmount: 26.97 },
    ]);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "coffee" },
      data: { stock: { decrement: 3 } },
    });
  });

  it("is idempotent: a retried event for the same payment creates no second order", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "order_1", stripePaymentId: "pi_123" });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { stripePaymentId: "pi_123" } });
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("ignores event types it does not handle", async () => {
    stripe.webhooks.constructEvent.mockReturnValue({ type: "payment_intent.created", data: { object: {} } });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });
});
