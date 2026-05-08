const symbolCache = new Map<string, symbol>();

// this exists to avoid an import cycle (Registry -> Counter/Gauge/Histogram -> Metric -> Registry)
export function getSymbol(name: string) {
    const existing = symbolCache.get(name);
    if (existing) return existing;
    const newSymbol = Symbol(name);
    symbolCache.set(name, newSymbol);
    return newSymbol;
}
