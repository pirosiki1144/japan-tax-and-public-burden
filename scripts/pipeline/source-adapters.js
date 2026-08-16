import { normalizeNtaConsumptionTaxRates } from "../normalize/nta-consumption-tax-rates.js";

const adapters = new Map([
  ["nta_consumption_tax_rates", { normalize: normalizeNtaConsumptionTaxRates }]
]);

export function getSourceAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) throw new Error(`No implemented adapter: ${name}`);
  return adapter;
}
