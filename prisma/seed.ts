import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to run the catalog seed");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

const ageRanges = [
  { slug: "bebe", name: "Bebê", minAgeMonths: 0, maxAgeMonths: 23, sortOrder: 10 },
  { slug: "crianca", name: "Criança", minAgeMonths: 24, maxAgeMonths: 143, sortOrder: 20 },
  { slug: "adolescente", name: "Adolescente", minAgeMonths: 144, maxAgeMonths: 215, sortOrder: 30 },
  { slug: "adulto", name: "Adulto", minAgeMonths: 216, maxAgeMonths: 719, sortOrder: 40 },
  { slug: "idoso", name: "Idoso", minAgeMonths: 720, maxAgeMonths: null, sortOrder: 50 }
];

const vaccines = [
  {
    key: "ciclo-bebe",
    name: "Ciclo Bebê Demo",
    manufacturer: "Instituto Aurora",
    description: "Vacina fictícia criada para demonstrar o catálogo da primeira infância.",
    price: 119.9,
    ageRangeSlugs: ["bebe"],
    faqs: [
      { question: "Este produto é real?", answer: "Não. Todos os produtos deste seed são fictícios." },
      { question: "Para que serve esta ficha?", answer: "Para demonstrar FAQs e faixas etárias na API." }
    ]
  },
  {
    key: "primeiros-passos",
    name: "Primeiros Passos Demo",
    manufacturer: "BioLume",
    description: "Item demonstrativo de catálogo destinado às faixas bebê e criança.",
    price: 134.5,
    ageRangeSlugs: ["bebe", "crianca"],
    faqs: []
  },
  {
    key: "escudo-infantil",
    name: "Escudo Infantil Demo",
    manufacturer: "Laboratório Horizonte",
    description: "Produto fictício para exercitar filtros do catálogo infantil.",
    price: 149.9,
    ageRangeSlugs: ["crianca"],
    faqs: [{ question: "Há estoque neste projeto?", answer: "Não. Estoque transacional ainda não foi implementado." }]
  },
  {
    key: "reforco-jovem",
    name: "Reforço Jovem Demo",
    manufacturer: "Instituto Aurora",
    description: "Vacina fictícia vinculada às faixas criança e adolescente.",
    price: 172,
    ageRangeSlugs: ["crianca", "adolescente"],
    faqs: []
  },
  {
    key: "protecao-adolescente",
    name: "Proteção Adolescente Demo",
    manufacturer: "Núcleo Vita",
    description: "Produto de demonstração para a navegação do catálogo adolescente.",
    price: 189.9,
    ageRangeSlugs: ["adolescente"],
    faqs: []
  },
  {
    key: "imunidade-familiar",
    name: "Imunidade Familiar Demo",
    manufacturer: "BioLume",
    description: "Vacina fictícia associada a diferentes faixas para testar relacionamentos.",
    price: 204.75,
    ageRangeSlugs: ["adolescente", "adulto"],
    faqs: [{ question: "Os preços são reais?", answer: "Não. Os valores são exclusivamente demonstrativos." }]
  },
  {
    key: "adulto-essencial",
    name: "Adulto Essencial Demo",
    manufacturer: "Laboratório Horizonte",
    description: "Item fictício do catálogo para a faixa adulta.",
    price: 218.4,
    ageRangeSlugs: ["adulto"],
    faqs: []
  },
  {
    key: "respira-demo",
    name: "Respira Demo",
    manufacturer: "Núcleo Vita",
    description: "Produto fictício amplo para demonstrar buscas por nome e fabricante.",
    price: 227.9,
    ageRangeSlugs: ["crianca", "adolescente", "adulto", "idoso"],
    faqs: []
  },
  {
    key: "longevidade-demo",
    name: "Longevidade Demo",
    manufacturer: "Instituto Aurora",
    description: "Vacina fictícia para demonstrar a faixa etária de idosos.",
    price: 246,
    ageRangeSlugs: ["idoso"],
    faqs: [{ question: "Há recomendação clínica?", answer: "Não. Esta API não oferece orientação médica." }]
  },
  {
    key: "cobertura-ampla",
    name: "Cobertura Ampla Demo",
    manufacturer: "BioLume",
    description: "Produto fictício usado em mais de um pacote demonstrativo.",
    price: 259.9,
    ageRangeSlugs: ["adulto", "idoso"],
    faqs: []
  }
];

const packages = [
  {
    name: "Pacote Primeira Infância Demo",
    description: "Composição fictícia para demonstrar pacotes voltados à primeira infância.",
    price: 369.9,
    vaccines: [
      { vaccineKey: "ciclo-bebe", quantity: 2 },
      { vaccineKey: "primeiros-passos", quantity: 1 }
    ],
    faqs: [{ question: "O pacote reserva doses?", answer: "Não. Reserva e estoque não fazem parte desta etapa." }]
  },
  {
    name: "Pacote Infantil Demo",
    description: "Pacote fictício com duas vacinas do catálogo infantil.",
    price: 299.9,
    vaccines: [
      { vaccineKey: "escudo-infantil", quantity: 1 },
      { vaccineKey: "reforco-jovem", quantity: 1 }
    ],
    faqs: []
  },
  {
    name: "Pacote Família Demo",
    description: "Composição demonstrativa com produtos associados a diferentes faixas.",
    price: 579.5,
    vaccines: [
      { vaccineKey: "imunidade-familiar", quantity: 1 },
      { vaccineKey: "respira-demo", quantity: 2 }
    ],
    faqs: [{ question: "Pode ser comprado?", answer: "Não. Pedidos e pagamentos ainda não estão implementados." }]
  },
  {
    name: "Pacote Maturidade Demo",
    description: "Pacote fictício para validar composições ligadas às faixas adulto e idoso.",
    price: 449.9,
    vaccines: [
      { vaccineKey: "longevidade-demo", quantity: 1 },
      { vaccineKey: "cobertura-ampla", quantity: 1 }
    ],
    faqs: []
  }
];

const run = async () => {
  await prisma.$transaction(async (tx) => {
    const ageRangeIds = new Map<string, string>();
    for (const ageRange of ageRanges) {
      const record = await tx.ageRange.upsert({
        where: { slug: ageRange.slug },
        update: { ...ageRange, deletedAt: null },
        create: ageRange
      });
      ageRangeIds.set(ageRange.slug, record.id);
    }

    const vaccineIds = new Map<string, string>();
    for (const vaccine of vaccines) {
      const { key, ageRangeSlugs, faqs, ...data } = vaccine;
      const record = await tx.vaccine.upsert({
        where: { name_manufacturer: { name: data.name, manufacturer: data.manufacturer } },
        update: { ...data, deletedAt: null },
        create: data
      });
      vaccineIds.set(key, record.id);

      await tx.vaccineFaq.deleteMany({ where: { vaccineId: record.id } });
      await tx.vaccineAgeRange.deleteMany({ where: { vaccineId: record.id } });
      if (faqs.length > 0) {
        await tx.vaccineFaq.createMany({
          data: faqs.map((faq, position) => ({ ...faq, position, vaccineId: record.id }))
        });
      }
      await tx.vaccineAgeRange.createMany({
        data: ageRangeSlugs.map((slug) => ({ vaccineId: record.id, ageRangeId: ageRangeIds.get(slug)! }))
      });
    }

    for (const packageItem of packages) {
      const { vaccines: packageVaccines, faqs, ...data } = packageItem;
      const record = await tx.package.upsert({
        where: { name: data.name },
        update: { ...data, deletedAt: null },
        create: data
      });

      await tx.packageFaq.deleteMany({ where: { packageId: record.id } });
      await tx.packageVaccine.deleteMany({ where: { packageId: record.id } });
      if (faqs.length > 0) {
        await tx.packageFaq.createMany({
          data: faqs.map((faq, position) => ({ ...faq, position, packageId: record.id }))
        });
      }
      await tx.packageVaccine.createMany({
        data: packageVaccines.map(({ vaccineKey, quantity }) => ({
          packageId: record.id,
          vaccineId: vaccineIds.get(vaccineKey)!,
          quantity
        }))
      });
    }
  });

  console.log(`Catalog seed completed: ${ageRanges.length} age ranges, ${vaccines.length} vaccines, ${packages.length} packages.`);
};

run()
  .catch((error) => {
    console.error("Catalog seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
