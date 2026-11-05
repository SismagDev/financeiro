// Somente expressões SQL definidas no código, nunca texto recebido da API.
export function alphabeticalOrder(expression: string) {
    return `translate(lower(btrim(${expression})), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') COLLATE "C"`;
}
