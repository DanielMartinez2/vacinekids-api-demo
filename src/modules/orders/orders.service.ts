import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";
import { unauthenticated } from "../auth/auth.service";
import {
  canonicalizeResolvedCheckout,
  checkoutFingerprint,
  requestHash,
  type ResolvedCheckout,
  type ResolvedComponent,
  type ResolvedOrderItem,
  type ResolvedRecipient
} from "./orders.canonical";
import {
  CHECKOUT_FINGERPRINT_VERSION,
  type CheckoutPreviewInput,
  type CreateOrderInput,
  type OrderListQuery
} from "./orders.schemas";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const orderDetailsInclude = {
  items: {
    orderBy: { position: "asc" as const },
    include: {
      recipients: { orderBy: { position: "asc" as const } },
      components: { orderBy: { position: "asc" as const } }
    }
  }
} as const;

type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderDetailsInclude }>;

const profileRequired = () =>
  new HttpError(409, "PROFILE_REQUIRED", "Complete o perfil antes de iniciar o checkout.");
const productUnavailable = () =>
  new HttpError(409, "PRODUCT_UNAVAILABLE", "Um ou mais produtos não estão disponíveis.");
const recipientNotFound = () =>
  new HttpError(404, "RECIPIENT_NOT_FOUND", "Destinatário não encontrado.");
const orderNotFound = () => new HttpError(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
const idempotencyReused = () =>
  new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "A chave de idempotência já foi utilizada com outra solicitação.");

const pagination = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize)
});

const serializeOrder = (order: OrderWithDetails) => ({
  id: order.id,
  number: order.number,
  status: order.status,
  currency: order.currency,
  totalAmount: order.totalAmount.toFixed(2),
  customer: {
    name: order.customerNameSnapshot,
    email: order.customerEmailSnapshot,
    phone: order.customerPhoneSnapshot
  },
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  cancelledAt: order.cancelledAt,
  items: order.items.map((item) => ({
    productType: item.productType,
    productId: item.productType === "VACCINE" ? item.vaccineId : item.packageId,
    name: item.productNameSnapshot,
    manufacturer: item.productManufacturerSnapshot,
    unitPrice: item.unitPrice.toFixed(2),
    quantity: item.quantity,
    lineTotal: item.lineTotal.toFixed(2),
    recipients: item.recipients.map((recipient) => ({
      type: recipient.recipientType,
      dependentId: recipient.dependentId,
      name: recipient.recipientNameSnapshot,
      birthDate: recipient.recipientBirthDateSnapshot?.toISOString().slice(0, 10) ?? null
    })),
    components: item.components.map((component) => ({
      vaccineId: component.vaccineId,
      name: component.vaccineNameSnapshot,
      manufacturer: component.vaccineManufacturerSnapshot,
      quantity: component.quantity
    }))
  }))
});

const serializePreview = (checkout: ResolvedCheckout) => ({
  items: checkout.items.map((item) => ({
    productType: item.productType,
    productId: item.productId,
    name: item.name,
    manufacturer: item.manufacturer,
    unitPrice: item.unitPrice.toFixed(2),
    quantity: item.quantity,
    lineTotal: item.lineTotal.toFixed(2),
    recipients: item.recipients.map((recipient) => ({
      type: recipient.type,
      dependentId: recipient.dependentId,
      name: recipient.name,
      birthDate: recipient.birthDate
    })),
    components: item.components.map((component) => ({
      vaccineId: component.vaccineId,
      name: component.name,
      manufacturer: component.manufacturer,
      quantity: component.quantity
    }))
  })),
  currency: checkout.currency,
  totalAmount: checkout.totalAmount.toFixed(2),
  checkoutFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION,
  checkoutFingerprint: checkoutFingerprint(checkout)
});

const resolveCheckout = async (
  db: DatabaseClient,
  userId: string,
  input: CheckoutPreviewInput
): Promise<{ checkout: ResolvedCheckout; customerProfileId: string }> => {
  const profile = await db.customerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      phone: true,
      user: { select: { email: true, role: true, status: true } }
    }
  });
  if (!profile) throw profileRequired();
  if (profile.user.status !== "ACTIVE") throw unauthenticated();
  if (profile.user.role !== "CUSTOMER") {
    throw new HttpError(403, "FORBIDDEN", "Permissão insuficiente.");
  }

  const vaccineIds = input.items.filter(({ productType }) => productType === "VACCINE").map(({ productId }) => productId);
  const packageIds = input.items.filter(({ productType }) => productType === "PACKAGE").map(({ productId }) => productId);
  const dependentIds = [...new Set(input.items.flatMap(({ recipients }) =>
    recipients.flatMap((recipient) => recipient.type === "DEPENDENT" ? [recipient.dependentId] : [])))];

  const [vaccines, packages, dependents] = await Promise.all([
    vaccineIds.length === 0 ? [] : db.vaccine.findMany({
      where: { id: { in: vaccineIds }, deletedAt: null },
      select: { id: true, name: true, manufacturer: true, price: true }
    }),
    packageIds.length === 0 ? [] : db.package.findMany({
      where: { id: { in: packageIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        price: true,
        vaccines: {
          select: {
            quantity: true,
            vaccine: { select: { id: true, name: true, manufacturer: true, deletedAt: true } }
          }
        }
      }
    }),
    dependentIds.length === 0 ? [] : db.dependent.findMany({
      where: { id: { in: dependentIds }, customerProfileId: profile.id, deletedAt: null },
      select: { id: true, name: true, birthDate: true }
    })
  ]);

  if (vaccines.length !== vaccineIds.length || packages.length !== packageIds.length) throw productUnavailable();
  if (dependents.length !== dependentIds.length) throw recipientNotFound();

  const vaccinesById = new Map(vaccines.map((vaccine) => [vaccine.id, vaccine]));
  const packagesById = new Map(packages.map((packageItem) => [packageItem.id, packageItem]));
  const dependentsById = new Map(dependents.map((dependent) => [dependent.id, dependent]));

  const items: ResolvedOrderItem[] = input.items.map((item) => {
    const recipients: ResolvedRecipient[] = item.recipients.map((recipient) => {
      if (recipient.type === "CUSTOMER") {
        return { type: "CUSTOMER", dependentId: null, name: profile.name, birthDate: null };
      }
      const dependent = dependentsById.get(recipient.dependentId);
      if (!dependent) throw recipientNotFound();
      return {
        type: "DEPENDENT",
        dependentId: dependent.id,
        name: dependent.name,
        birthDate: dependent.birthDate.toISOString().slice(0, 10)
      };
    });

    if (item.productType === "VACCINE") {
      const vaccine = vaccinesById.get(item.productId);
      if (!vaccine) throw productUnavailable();
      return {
        productType: "VACCINE",
        productId: vaccine.id,
        name: vaccine.name,
        manufacturer: vaccine.manufacturer,
        unitPrice: vaccine.price,
        quantity: recipients.length,
        lineTotal: vaccine.price.mul(recipients.length),
        recipients,
        components: []
      };
    }

    const packageItem = packagesById.get(item.productId);
    if (!packageItem || packageItem.vaccines.length === 0 || packageItem.vaccines.some(({ vaccine }) => vaccine.deletedAt !== null)) {
      throw productUnavailable();
    }
    const components: ResolvedComponent[] = packageItem.vaccines.map(({ quantity, vaccine }) => ({
      vaccineId: vaccine.id,
      name: vaccine.name,
      manufacturer: vaccine.manufacturer,
      quantity
    }));
    return {
      productType: "PACKAGE",
      productId: packageItem.id,
      name: packageItem.name,
      manufacturer: null,
      unitPrice: packageItem.price,
      quantity: recipients.length,
      lineTotal: packageItem.price.mul(recipients.length),
      recipients,
      components
    };
  });

  const totalAmount = items.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0));
  return {
    customerProfileId: profile.id,
    checkout: canonicalizeResolvedCheckout({
      customer: { name: profile.name, email: profile.user.email, phone: profile.phone },
      items,
      currency: "BRL",
      totalAmount
    })
  };
};

const uniqueConflictTarget = (error: unknown) => {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return null;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta as Record<string, unknown>
    : {};
  return JSON.stringify(meta.target ?? meta.constraint ?? meta).toLowerCase();
};

const conflictKind = (target: string) => {
  if (target.includes("customer_profile_id") && target.includes("idempotency_key")) return "IDEMPOTENCY";
  if (target.includes("orders_number") || target.includes("number")) return "NUMBER";
  return "UNKNOWN";
};

const defaultOrderNumber = () => `VK-${randomBytes(10).toString("hex").toUpperCase()}`;

export const createOrderService = (
  db: PrismaClient,
  clock = () => new Date(),
  orderNumber = defaultOrderNumber
) => {
  const findExisting = (customerProfileId: string, idempotencyKey: string) => db.order.findUnique({
    where: { customerProfileId_idempotencyKey: { customerProfileId, idempotencyKey } },
    include: orderDetailsInclude
  });

  const assertSameRequest = (order: OrderWithDetails, expectedHash: string) => {
    if (order.requestHash !== expectedHash) throw idempotencyReused();
    return order;
  };

  const findOwned = async (userId: string, id: string) => {
    const order = await db.order.findFirst({
      where: { id, customerProfile: { userId } },
      include: orderDetailsInclude
    });
    if (!order) throw orderNotFound();
    return order;
  };

  return {
    async preview(userId: string, input: CheckoutPreviewInput) {
      const { checkout } = await db.$transaction(
        (tx) => resolveCheckout(tx, userId, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      );
      return serializePreview(checkout);
    },

    async create(userId: string, idempotencyKey: string, input: CreateOrderInput) {
      const profile = await db.customerProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!profile) throw profileRequired();
      const expectedHash = requestHash(input);
      const existing = await findExisting(profile.id, idempotencyKey);
      if (existing) return { order: serializeOrder(assertSameRequest(existing, expectedHash)), replay: true };

      let lastUniqueError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await db.$transaction(async (tx) => {
            const transactionExisting = await tx.order.findUnique({
              where: { customerProfileId_idempotencyKey: { customerProfileId: profile.id, idempotencyKey } },
              include: orderDetailsInclude
            });
            if (transactionExisting) {
              return { order: assertSameRequest(transactionExisting, expectedHash), replay: true };
            }

            const { checkout, customerProfileId } = await resolveCheckout(tx, userId, input);
            const currentFingerprint = checkoutFingerprint(checkout);
            if (currentFingerprint !== input.checkoutFingerprint) {
              throw new HttpError(409, "CHECKOUT_CHANGED", "O checkout foi atualizado. Revise os dados antes de confirmar.");
            }

            const created = await tx.order.create({
              data: {
                number: orderNumber(),
                customerProfile: { connect: { id: customerProfileId } },
                currency: checkout.currency,
                totalAmount: checkout.totalAmount,
                customerNameSnapshot: checkout.customer.name,
                customerEmailSnapshot: checkout.customer.email,
                customerPhoneSnapshot: checkout.customer.phone,
                idempotencyKey,
                requestHash: expectedHash,
                checkoutFingerprint: currentFingerprint,
                checkoutFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION,
                items: {
                  create: checkout.items.map((item, itemIndex) => ({
                    position: itemIndex + 1,
                    productType: item.productType,
                    ...(item.productType === "VACCINE"
                      ? { vaccine: { connect: { id: item.productId } } }
                      : { package: { connect: { id: item.productId } } }),
                    productNameSnapshot: item.name,
                    productManufacturerSnapshot: item.manufacturer,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    lineTotal: item.lineTotal,
                    recipients: {
                      create: item.recipients.map((recipient, recipientIndex) => ({
                        recipientType: recipient.type,
                        ...(recipient.dependentId ? { dependent: { connect: { id: recipient.dependentId } } } : {}),
                        recipientNameSnapshot: recipient.name,
                        recipientBirthDateSnapshot: recipient.birthDate ? new Date(`${recipient.birthDate}T00:00:00.000Z`) : null,
                        position: recipientIndex + 1
                      }))
                    },
                    ...(item.components.length > 0 ? {
                      components: {
                        create: item.components.map((component, componentIndex) => ({
                          vaccine: { connect: { id: component.vaccineId } },
                          vaccineNameSnapshot: component.name,
                          vaccineManufacturerSnapshot: component.manufacturer,
                          quantity: component.quantity,
                          position: componentIndex + 1
                        }))
                      }
                    } : {})
                  }))
                }
              },
              include: orderDetailsInclude
            });
            return { order: created, replay: false };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

          return { order: serializeOrder(result.order), replay: result.replay };
        } catch (error) {
          const target = uniqueConflictTarget(error);
          if (target === null) throw error;
          lastUniqueError = error;
          const kind = conflictKind(target);
          if (kind !== "NUMBER") {
            const winner = await findExisting(profile.id, idempotencyKey);
            if (winner) return { order: serializeOrder(assertSameRequest(winner, expectedHash)), replay: true };
          }
          if (kind === "UNKNOWN") throw error;
        }
      }
      void lastUniqueError;
      throw new HttpError(503, "DEPENDENCY_UNAVAILABLE", "Serviço temporariamente indisponível.");
    },

    async list(userId: string, query: OrderListQuery) {
      const profile = await db.customerProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!profile) return { items: [], meta: pagination(query.page, query.pageSize, 0) };
      const where = { customerProfileId: profile.id };
      const [orders, total] = await db.$transaction([
        db.order.findMany({
          where,
          select: {
            id: true,
            number: true,
            status: true,
            currency: true,
            totalAmount: true,
            createdAt: true,
            _count: { select: { items: true } }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize
        }),
        db.order.count({ where })
      ]);
      return {
        items: orders.map(({ _count, totalAmount, ...order }) => ({
          ...order,
          totalAmount: totalAmount.toFixed(2),
          itemCount: _count.items
        })),
        meta: pagination(query.page, query.pageSize, total)
      };
    },

    async detail(userId: string, id: string) {
      return serializeOrder(await findOwned(userId, id));
    },

    async cancel(userId: string, id: string) {
      const cancelledAt = clock();
      const result = await db.order.updateMany({
        where: { id, status: "PENDING_PAYMENT", customerProfile: { userId } },
        data: { status: "CANCELLED", cancelledAt }
      });
      const order = await findOwned(userId, id);
      if (result.count === 0 && order.status !== "CANCELLED") {
        throw new HttpError(409, "ORDER_NOT_CANCELLABLE", "O pedido não pode ser cancelado neste estado.");
      }
      return serializeOrder(order);
    }
  };
};

export type OrderService = ReturnType<typeof createOrderService>;
