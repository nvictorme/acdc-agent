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

const SYNONYMS: Record<string, string[]> = {
  breaker: ["termomagnetico", "interruptor", "disyuntor"],
  termomagnetico: ["breaker", "interruptor", "disyuntor"],
  interruptor: ["termomagnetico", "breaker", "disyuntor"],
  disyuntor: ["termomagnetico", "breaker", "interruptor"],
  protector: ["supervisor", "protector"],
  supervisor: ["protector"],
  diferencial: ["diferencial", "disyuntor diferencial"],
  contactor: ["contactor"],
  tablero: ["tablero", "panel", "riel"],
  panel: ["tablero", "riel"],
  rele: ["rele", "relay", "relé"],
  relay: ["rele", "relé"],
  relé: ["rele", "relay"],
  variador: ["variador", "vfd", "drive", "frecuencia"],
  vfd: ["variador", "frecuencia"],
  drive: ["variador", "frecuencia"],
  fuente: ["fuente"],
  piloto: ["piloto", "botoneria", "botonería"],
  boton: ["piloto", "botoneria"],
  supresor: ["supresor", "pico", "supresores"],
  transferencia: ["transferencia"],
  temporizador: ["temporizador", "timer", "rele"],
  timer: ["temporizador"],
  herramienta: ["herramienta"],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) syns.forEach((s) => expanded.add(s));
  }
  return [...expanded];
}

export async function searchProducts(query: string, limit = 10): Promise<Product[]> {
  const products = await loadProducts();
  const queryTokens = expandTokens(tokenize(query));

  const scored = products.map((p) => {
    const haystack = normalize(`${p.nombre} ${p.categoria}`);
    const haystackTokens = tokenize(haystack);
    let score = 0;
    for (const qt of queryTokens) {
      if (haystack.includes(qt)) score += 2;
      else if (haystackTokens.some((ht) => ht.startsWith(qt) || qt.startsWith(ht))) score += 1;
    }
    return { product: p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.product.mostrar - a.product.mostrar;
    })
    .slice(0, limit)
    .map((s) => s.product);
}
