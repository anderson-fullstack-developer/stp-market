import { describe, expect, it } from "vitest";
import { buildCheckout, type PricedProduct } from "@/lib/pricing";
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from "@/lib/shipping";

const coffee: PricedProduct = { id: "coffee", name: "Café", price: 7.5, stock: 10, imageUrl: "https://img/coffee" };
const cocoa: PricedProduct = { id: "cocoa", name: "Cacau", price: 3.2, stock: 2, imageUrl: "https://img/cocoa" };

describe("buildCheckout", () => {
  it("prices every line from the database, in cents", () => {
    const { lineItems } = buildCheckout([{ productId: "coffee", quantity: 2 }], [coffee]);
    expect(lineItems).toEqual([
      {
        quantity: 2,
        price_data: {
          currency: "eur",
          unit_amount: 750,
          product_data: { name: "Café", images: ["https://img/coffee"], metadata: { productId: "coffee" } },
        },
      },
    ]);
  });

  it("ignores any price sent by the browser", () => {
    const tampered = [{ productId: "coffee", quantity: 1, price: 0.01 }];
    const { lineItems, subtotal } = buildCheckout(tampered, [coffee]);
    expect(lineItems[0].price_data.unit_amount).toBe(750);
    expect(subtotal).toBe(7.5);
  });

  it("charges shipping below the free-shipping threshold", () => {
    const { subtotal, shippingAmount } = buildCheckout([{ productId: "cocoa", quantity: 1 }], [cocoa]);
    expect(subtotal).toBeLessThan(FREE_SHIPPING_THRESHOLD);
    expect(shippingAmount).toBe(SHIPPING_FEE);
  });

  it("ships for free from the threshold up", () => {
    const { subtotal, shippingAmount } = buildCheckout(
      [
        { productId: "coffee", quantity: 1 },
        { productId: "cocoa", quantity: 1 },
      ],
      [coffee, cocoa],
    );
    expect(subtotal).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD);
    expect(shippingAmount).toBe(0);
  });

  it("rejects a product that is no longer available", () => {
    expect(() => buildCheckout([{ productId: "gone", quantity: 1 }], [coffee])).toThrow(/já não está disponível/);
  });

  it("rejects quantities above the available stock", () => {
    expect(() => buildCheckout([{ productId: "cocoa", quantity: 3 }], [cocoa])).toThrow(/Stock insuficiente/);
  });
});
