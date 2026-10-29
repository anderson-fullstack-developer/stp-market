const DEFAULT_COMMISSION_RATE = 10;

/** Percentagem da plataforma sobre cada venda de um vendedor, como fração (ex: 0.10 para 10%). */
export function getCommissionRate(): number {
  const raw = process.env.COMMISSION_RATE;
  const parsed = raw ? Number(raw) : NaN;
  const rate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_COMMISSION_RATE;
  return rate / 100;
}

const roundToCents = (value: number) => Math.round(value * 100) / 100;

/**
 * Divide o valor de uma linha de encomenda entre a plataforma e o vendedor.
 * A comissão é arredondada ao cêntimo e o vendedor fica com o resto, para que
 * as duas partes somem sempre exatamente o total da linha.
 * Produtos sem vendedor (vendidos pela própria loja) não têm divisão.
 */
export function splitSale(lineTotal: number, commissionRate: number, hasVendor: boolean) {
  if (!hasVendor) {
    return { commissionAmount: null, vendorAmount: null };
  }
  const total = roundToCents(lineTotal);
  const commissionAmount = roundToCents(total * commissionRate);
  return { commissionAmount, vendorAmount: roundToCents(total - commissionAmount) };
}
