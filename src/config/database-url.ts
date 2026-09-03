const supportedProtocols = new Set(["postgres:", "postgresql:"]);

export const parseDatabaseUrl = (value: string) => {
  const url = new URL(value);
  if (!supportedProtocols.has(url.protocol)) {
    throw new Error("Database URL must use the postgres or postgresql protocol");
  }

  const schema = url.searchParams.get("schema")?.trim();
  return { url, schema: schema || null };
};
