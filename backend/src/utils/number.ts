export const isNumeric = (str: string): boolean => {
    if(str === "") return false;

    const num: number = Number(str);
    return !isNaN(num) && isFinite(num);
}