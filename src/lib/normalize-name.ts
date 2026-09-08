export const normalizeName = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ");
