import path from "node:path";

export interface Product {
  sku: string;
  codigo: number;
  nombre: string;
  categoria: string;
  bcv_g: number;
  mostrar: number;
}

interface RawProduct {
  SKU: string;
  Codigo: number;
  Descripcion: string;
  Categoria: string;
  BcvG: number;
  Mostrar: number;
}

const catalogPath = path.join(import.meta.dir, "productos.json");

let _products: Product[] | null = null;

export async function loadProducts(): Promise<Product[]> {
  if (_products) return _products;
  const raw: RawProduct[] = await Bun.file(catalogPath).json();
  _products = raw.map((p) => ({
    sku: p.SKU,
    codigo: p.Codigo,
    nombre: p.Descripcion,
    categoria: p.Categoria,
    bcv_g: p.BcvG,
    mostrar: p.Mostrar,
  }));
  return _products;
}

export async function buildCatalogBlock(): Promise<string> {
  const products = await loadProducts();
  return JSON.stringify(products, null, 0);
}
