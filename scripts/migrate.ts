import { runMigrations } from "../src/database/client";
runMigrations().then(() => console.log("Migrations applied.")).catch((e) => { console.error(e); process.exit(1); });
