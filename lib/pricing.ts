import { calculateShipping } from "@/lib/shipping";

export type CartItem = { productId: string; quantity: number };

export type PricedProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  imageUrl: string;
};

/**
 * Constrói as linhas do checkout a partir dos produtos lidos da base de dados.
 * O preço vem sempre da base de dados, nunca do carrinho do browser, e o
 * pedido é recusado se um produto já não estiver disponível ou faltar stock.
 * `products` deve conter apenas produtos ativos e aprovados.
 */
export function buildCheckout(items: CartItem[], products: PricedProduct[]) {
  const lines = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      throw new Error("Um dos produtos do carrinho já não está disponível.");
    }
    if (item.quantity > product.stock) {
      throw new Error(`Stock insuficiente para "${product.name}".`);
    }
    return { product, quantity: item.quantity };
  });

  const lineItems = lines.map(({ product, quantity }) => ({
    quantity,
    price_data: {
      currency: "eur",
      unit_amount: Math.round(product.price * 100),
      product_data: {
        name: product.name,
        images: [product.imageUrl],
        metadata: { productId: product.id },
      },
    },
  }));

  const subtotal = lines.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);

  return { lineItems, subtotal, shippingAmount: calculateShipping(subtotal) };
}
