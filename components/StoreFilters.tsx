"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Category = { id: string; slug: string; name: string };

type Filters = { q: string; categoria: string; sort: string };

const SORT_ITEMS = [
  { value: "recent", label: "Mais recentes" },
  { value: "price-asc", label: "Preço: menor primeiro" },
  { value: "price-desc", label: "Preço: maior primeiro" },
];

export function StoreFilters({
  categories,
  defaultValues,
}: {
  categories: Category[];
  defaultValues: Filters;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValues.q);
  const [categoria, setCategoria] = useState(defaultValues.categoria);
  const [sort, setSort] = useState(defaultValues.sort);

  function applyFilters(next: Partial<Filters>) {
    const values = { q, categoria, sort, ...next };
    const params = new URLSearchParams();
    if (values.q) params.set("q", values.q);
    if (values.categoria) params.set("categoria", values.categoria);
    if (values.sort) params.set("sort", values.sort);
    router.push(`/loja?${params.toString()}`);
  }

  // The trigger shows the item label only when the Select knows the items.
  const categoryItems = [
    { value: "all", label: "Todas as categorias" },
    ...categories.map((category) => ({ value: category.slug, label: category.name })),
  ];

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timeout = setTimeout(() => {
      applyFilters({ q });
    }, 400);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        applyFilters({});
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <Input
        placeholder="Pesquisar produtos..."
        value={q}
        onChange={(event) => setQ(event.target.value)}
        className="sm:max-w-xs"
      />

      <Select
        items={categoryItems}
        value={categoria || "all"}
        onValueChange={(value) => {
          const next = !value || value === "all" ? "" : value;
          setCategoria(next);
          applyFilters({ categoria: next });
        }}
      >
        <SelectTrigger className="sm:w-48">
          <SelectValue placeholder="Categoria" />
        </SelectTrigger>
        <SelectContent>
          {categoryItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={SORT_ITEMS}
        value={sort || "recent"}
        onValueChange={(value) => {
          const next = !value || value === "recent" ? "" : value;
          setSort(next);
          applyFilters({ sort: next });
        }}
      >
        <SelectTrigger className="sm:w-48">
          <SelectValue placeholder="Ordenar" />
        </SelectTrigger>
        <SelectContent>
          {SORT_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  );
}
