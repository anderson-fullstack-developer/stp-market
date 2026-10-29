import { afterEach, describe, expect, it } from "vitest";
import { getCommissionRate, splitSale } from "@/lib/commission";

describe("splitSale", () => {
  it("splits a sale between platform commission and vendor", () => {
    expect(splitSale(100, 0.1, true)).toEqual({ commissionAmount: 10, vendorAmount: 90 });
  });

  it("rounds to cents so both parts always add up to the line total", () => {
    // 3 × 9.99 € at 10% would be 2.997 € / 26.973 € without rounding.
    const { commissionAmount, vendorAmount } = splitSale(3 * 9.99, 0.1, true);
    expect(commissionAmount).toBe(3);
    expect(vendorAmount).toBe(26.97);
    expect(commissionAmount! + vendorAmount!).toBeCloseTo(29.97, 10);
  });

  it("never loses or creates a cent across many prices and rates", () => {
    for (let cents = 1; cents <= 5000; cents += 37) {
      for (const rate of [0, 0.05, 0.1, 0.125, 0.3333, 1]) {
        const total = cents / 100;
        const { commissionAmount, vendorAmount } = splitSale(total, rate, true);
        expect(Math.round((commissionAmount! + vendorAmount!) * 100)).toBe(cents);
        expect(Number.isInteger(Math.round(commissionAmount! * 100 * 1e6) / 1e6)).toBe(true);
      }
    }
  });

  it("does not split sales of products without a vendor", () => {
    expect(splitSale(50, 0.1, false)).toEqual({ commissionAmount: null, vendorAmount: null });
  });
});

describe("getCommissionRate", () => {
  const original = process.env.COMMISSION_RATE;
  afterEach(() => {
    process.env.COMMISSION_RATE = original;
  });

  it("reads the percentage from COMMISSION_RATE", () => {
    process.env.COMMISSION_RATE = "15";
    expect(getCommissionRate()).toBe(0.15);
  });

  it("falls back to 10% when the value is missing or invalid", () => {
    for (const value of ["", "abc", "-5", "150"]) {
      process.env.COMMISSION_RATE = value;
      expect(getCommissionRate()).toBe(0.1);
    }
  });
});
