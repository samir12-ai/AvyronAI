import { db } from '../server/db/index.ts';
import { audienceEvidence } from '../server/db/schema.ts';
import { inArray } from 'drizzle-orm';
async function main() { const ids = ['EV-56', 'EV-58', 'EV-144', 'EV-244', 'EV-254']; const res = await db.select().from(audienceEvidence).where(inArray(audienceEvidence.uid, ids)); res.forEach(r => console.log(r.uid + ': ' + r.rawContent)); process.exit(0); } main();