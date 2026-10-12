/** Поточний час у секундах: єдина точка читання годинника екрана «Сьогодні». */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
