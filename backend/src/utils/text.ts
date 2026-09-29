export const removerPontuacaoCPFCNPJ = (v: string): string =>
  v.replace(/\D/g, '');

export function removerEspacos(valor: string | null) {
  return valor?.trim().replace(/\s+/g, '') ?? null;
}