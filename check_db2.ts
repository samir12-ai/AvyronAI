import { db } from './server/db';
import { campaigns, evidenceRegistry, watchtowerSignals } from './shared/schema';
import { eq } from 'drizzle-orm';

async function run() {
  const c = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, 'campaign_1773576062201_6t0oxi')
  });
  console.log("CAMPAIGN:", JSON.stringify(c, null, 2));

  const allC = await db.query.campaigns.findMany();
  console.log("ALL CAMPAIGNS:", allC.map(camp => ({ id: camp.id, name: camp.name })));
  process.exit(0);
}
run();
