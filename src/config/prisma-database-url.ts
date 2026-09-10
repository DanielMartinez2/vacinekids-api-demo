type PrismaDatabaseEnvironment = {
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
};

export const resolvePrismaDatabaseUrl = (environment: PrismaDatabaseEnvironment) => {
  const unpooledUrl = environment.DATABASE_URL_UNPOOLED?.trim();
  const databaseUrl = environment.DATABASE_URL?.trim();
  const url = unpooledUrl || databaseUrl;

  if (!url) {
    throw new Error(
      "Prisma requires a non-empty DATABASE_URL_UNPOOLED or DATABASE_URL"
    );
  }

  return url;
};
