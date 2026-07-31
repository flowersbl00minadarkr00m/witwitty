export const stableId = (namespace: string, value: string): string => {
  let hash = 0x811c9dc5;
  const input = `${namespace}:${value.trim().toLocaleLowerCase()}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${namespace}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
