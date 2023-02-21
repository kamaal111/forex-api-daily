export default function uniques<Element>(array: Element[]) {
  return [...new Set(array)];
}
