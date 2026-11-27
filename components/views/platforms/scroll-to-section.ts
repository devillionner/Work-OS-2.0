/**
 * Гортає до блоку картки автопосту за id («autopost-decisions», «thread-choices»). На ПК блок лежить у правій колонці, що гортається окремо:
 * `scrollIntoView` гортає саме її; на телефоні — сторінку. Без плавності, як і решта переходів до блоків.
 */
export function scrollToSection(id: string): boolean {
  const node = typeof document === 'undefined' ? null : document.getElementById(id);
  if (!node) return false;
  node.scrollIntoView({ block: 'start' });
  return true;
}
