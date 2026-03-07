const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
    const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Participant';`);
    console.log("Columns in Participant:", res.rows);
}

main().catch(console.error).finally(() => pool.end());
