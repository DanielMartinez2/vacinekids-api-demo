import { prisma } from "../../config/database";
import type { Prisma } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";
import type {
  CreateAgeRangeInput,
  CreatePackageInput,
  CreateVaccineInput,
  UpdateAgeRangeInput,
  UpdatePackageInput,
  UpdateVaccineInput
} from "./catalog.schemas";

type ListOptions = {
  page: number;
  pageSize: number;
  search?: string;
  includeDeleted: boolean;
};

type VaccineListOptions = ListOptions & { ageRange?: string };
type PackageListOptions = ListOptions & { vaccineId?: string; ageRange?: string };

const activeFilter = (includeDeleted: boolean) => (includeDeleted ? {} : { deletedAt: null });

const pagination = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize)
});

const vaccineInclude = {
  faqs: { orderBy: { position: "asc" as const } },
  ageRanges: { include: { ageRange: true } }
};

const packageInclude = {
  faqs: { orderBy: { position: "asc" as const } },
  vaccines: { include: { vaccine: { include: vaccineInclude } } }
};

type VaccineWithCatalog = Prisma.VaccineGetPayload<{ include: typeof vaccineInclude }>;
type PackageWithCatalog = Prisma.PackageGetPayload<{ include: typeof packageInclude }>;

const serializeVaccine = (vaccine: VaccineWithCatalog) => ({
  id: vaccine.id,
  name: vaccine.name,
  description: vaccine.description,
  manufacturer: vaccine.manufacturer,
  price: vaccine.price.toFixed(2),
  ageRanges: vaccine.ageRanges
    .map(({ ageRange }) => ageRange)
    .filter((ageRange) => ageRange.deletedAt === null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ deletedAt: _deletedAt, ...ageRange }) => ageRange),
  faqs: vaccine.faqs,
  createdAt: vaccine.createdAt,
  updatedAt: vaccine.updatedAt,
  deletedAt: vaccine.deletedAt
});

const serializePackage = (packageItem: PackageWithCatalog) => ({
  id: packageItem.id,
  name: packageItem.name,
  description: packageItem.description,
  price: packageItem.price.toFixed(2),
  vaccines: packageItem.vaccines
    .filter(({ vaccine }) => vaccine.deletedAt === null)
    .map(({ quantity, vaccine }) => ({ quantity, vaccine: serializeVaccine(vaccine) })),
  faqs: packageItem.faqs,
  createdAt: packageItem.createdAt,
  updatedAt: packageItem.updatedAt,
  deletedAt: packageItem.deletedAt
});

const ensureAgeRangesExist = async (ids: string[]) => {
  const count = await prisma.ageRange.count({ where: { id: { in: ids }, deletedAt: null } });
  if (count !== ids.length) {
    throw new HttpError(422, "INVALID_AGE_RANGES", "One or more age ranges do not exist or are inactive");
  }
};

const ensureVaccinesExist = async (ids: string[]) => {
  const count = await prisma.vaccine.count({ where: { id: { in: ids }, deletedAt: null } });
  if (count !== ids.length) {
    throw new HttpError(422, "INVALID_VACCINES", "One or more vaccines do not exist or are inactive");
  }
};

const getVaccine = async (id: string) => {
  const vaccine = await prisma.vaccine.findFirst({ where: { id, deletedAt: null }, include: vaccineInclude });
  if (!vaccine) throw new HttpError(404, "VACCINE_NOT_FOUND", "Vaccine not found");
  return serializeVaccine(vaccine);
};

const getPackage = async (id: string) => {
  const packageItem = await prisma.package.findFirst({ where: { id, deletedAt: null }, include: packageInclude });
  if (!packageItem) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
  return serializePackage(packageItem);
};

const getAgeRange = async (id: string) => {
  const ageRange = await prisma.ageRange.findFirst({ where: { id, deletedAt: null } });
  if (!ageRange) throw new HttpError(404, "AGE_RANGE_NOT_FOUND", "Age range not found");
  return ageRange;
};

export const catalogService = {
  async listVaccines(options: VaccineListOptions) {
    const where = {
      ...activeFilter(options.includeDeleted),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" as const } },
              { description: { contains: options.search, mode: "insensitive" as const } },
              { manufacturer: { contains: options.search, mode: "insensitive" as const } }
            ]
          }
        : {}),
      ...(options.ageRange
        ? { ageRanges: { some: { ageRange: { slug: options.ageRange, deletedAt: null } } } }
        : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.vaccine.findMany({
        where,
        include: vaccineInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize
      }),
      prisma.vaccine.count({ where })
    ]);

    return { items: items.map(serializeVaccine), meta: pagination(options.page, options.pageSize, total) };
  },

  getVaccine,

  async createVaccine(input: CreateVaccineInput) {
    await ensureAgeRangesExist(input.ageRangeIds);
    const vaccine = await prisma.vaccine.create({
      data: {
        name: input.name,
        description: input.description,
        manufacturer: input.manufacturer,
        price: input.price,
        faqs: { create: input.faqs.map((faq, position) => ({ ...faq, position })) },
        ageRanges: { create: input.ageRangeIds.map((ageRangeId) => ({ ageRangeId })) }
      },
      include: vaccineInclude
    });
    return serializeVaccine(vaccine);
  },

  async updateVaccine(id: string, input: UpdateVaccineInput) {
    await getVaccine(id);
    if (input.ageRangeIds) await ensureAgeRangesExist(input.ageRangeIds);
    const vaccine = await prisma.vaccine.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.manufacturer !== undefined && { manufacturer: input.manufacturer }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.faqs !== undefined && {
          faqs: { deleteMany: {}, create: input.faqs.map((faq, position) => ({ ...faq, position })) }
        }),
        ...(input.ageRangeIds !== undefined && {
          ageRanges: { deleteMany: {}, create: input.ageRangeIds.map((ageRangeId) => ({ ageRangeId })) }
        })
      },
      include: vaccineInclude
    });
    return serializeVaccine(vaccine);
  },

  async deleteVaccine(id: string) {
    const result = await prisma.vaccine.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (result.count === 0) throw new HttpError(404, "VACCINE_NOT_FOUND", "Vaccine not found");
  },

  async listPackages(options: PackageListOptions) {
    const where = {
      ...activeFilter(options.includeDeleted),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" as const } },
              { description: { contains: options.search, mode: "insensitive" as const } }
            ]
          }
        : {}),
      ...(options.vaccineId ? { vaccines: { some: { vaccineId: options.vaccineId } } } : {}),
      ...(options.ageRange
        ? {
            AND: [
              {
                vaccines: {
                  some: {
                    vaccine: {
                      deletedAt: null,
                      ageRanges: {
                        some: {
                          ageRange: { slug: options.ageRange, deletedAt: null }
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.package.findMany({
        where,
        include: packageInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize
      }),
      prisma.package.count({ where })
    ]);

    return { items: items.map(serializePackage), meta: pagination(options.page, options.pageSize, total) };
  },

  getPackage,

  async createPackage(input: CreatePackageInput) {
    await ensureVaccinesExist(input.vaccines.map(({ vaccineId }) => vaccineId));
    const packageItem = await prisma.package.create({
      data: {
        name: input.name,
        description: input.description,
        price: input.price,
        faqs: { create: input.faqs.map((faq, position) => ({ ...faq, position })) },
        vaccines: { create: input.vaccines }
      },
      include: packageInclude
    });
    return serializePackage(packageItem);
  },

  async updatePackage(id: string, input: UpdatePackageInput) {
    await getPackage(id);
    if (input.vaccines) await ensureVaccinesExist(input.vaccines.map(({ vaccineId }) => vaccineId));
    const packageItem = await prisma.package.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.faqs !== undefined && {
          faqs: { deleteMany: {}, create: input.faqs.map((faq, position) => ({ ...faq, position })) }
        }),
        ...(input.vaccines !== undefined && {
          vaccines: { deleteMany: {}, create: input.vaccines }
        })
      },
      include: packageInclude
    });
    return serializePackage(packageItem);
  },

  async deletePackage(id: string) {
    const result = await prisma.package.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (result.count === 0) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
  },

  async listAgeRanges(options: ListOptions) {
    const where = {
      ...activeFilter(options.includeDeleted),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" as const } },
              { slug: { contains: options.search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };
    const [items, total] = await prisma.$transaction([
      prisma.ageRange.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize
      }),
      prisma.ageRange.count({ where })
    ]);
    return { items, meta: pagination(options.page, options.pageSize, total) };
  },

  getAgeRange,

  async createAgeRange(input: CreateAgeRangeInput) {
    return prisma.ageRange.create({ data: input });
  },

  async updateAgeRange(id: string, input: UpdateAgeRangeInput) {
    const current = await getAgeRange(id);
    const minAgeMonths = input.minAgeMonths === undefined ? current.minAgeMonths : input.minAgeMonths;
    const maxAgeMonths = input.maxAgeMonths === undefined ? current.maxAgeMonths : input.maxAgeMonths;
    if (minAgeMonths != null && maxAgeMonths != null && minAgeMonths > maxAgeMonths) {
      throw new HttpError(422, "INVALID_AGE_RANGE", "minAgeMonths cannot be greater than maxAgeMonths");
    }
    return prisma.ageRange.update({ where: { id }, data: input });
  },

  async deleteAgeRange(id: string) {
    const result = await prisma.ageRange.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (result.count === 0) throw new HttpError(404, "AGE_RANGE_NOT_FOUND", "Age range not found");
  }
};
