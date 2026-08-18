import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { cases, customers, stageDurations } from './schema.js';
import { createSeedData, stageDurationSeedData } from './seed-data.js';

const database = createDatabase();

try {
  const seedData = createSeedData();

  await database.db.transaction(async (tx) => {
    await tx
      .insert(stageDurations)
      .values([...stageDurationSeedData])
      .onConflictDoUpdate({
        target: stageDurations.stage,
        set: { standardDays: sql`excluded.standard_days` }
      });

    const customerIds = new Map<string, string>();
    for (const customer of seedData.customers) {
      const [existingCustomer] = await tx.select().from(customers).where(eq(customers.email, customer.email));
      const [seededCustomer] = existingCustomer
        ? await tx.update(customers).set(customer).where(eq(customers.id, existingCustomer.id)).returning({ id: customers.id })
        : await tx.insert(customers).values(customer).returning({ id: customers.id });

      customerIds.set(customer.email, seededCustomer.id);
    }

    for (const seedCase of seedData.cases) {
      const { customerEmail, ...caseValues } = seedCase;
      const customerId = customerIds.get(customerEmail);
      if (!customerId) {
        throw new Error(`Seed customer missing for ${seedCase.caseNumber}`);
      }

      await tx
        .insert(cases)
        .values({ ...caseValues, customerId })
        .onConflictDoUpdate({
          target: cases.caseNumber,
          set: { ...caseValues, customerId }
        });
    }
  });

  console.info(`Seeded ${seedData.customers.length} customers, ${seedData.cases.length} cases, and ${stageDurationSeedData.length} stage durations.`);
} catch (error) {
  console.error('Database seed failed. Run `pnpm db:migrate` after starting Postgres with `docker compose up -d`.', error);
  process.exitCode = 1;
} finally {
  await database.close();
}
